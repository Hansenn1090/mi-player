// api/providers/cuevana3sc.js
'use strict';

/**
 * Cuevana3.sc — WordPress + base64 embed
 *
 * Rutas:
 *   Películas: /peliculas-online/<id>/<slug>/   o /peliculas-online/<slug>/
 *   Series:    /series-online/<id>/<slug>/      o /series-online/<slug>/
 *   Episodios: /ver-el-episodio/<id>/<slug>/
 *
 * Player:
 *   <iframe src="/embed-page?showEmbed=<BASE64>">
 *   El base64 decodifica a la URL real del host (vimeos.net, etc.)
 *
 * El SSR muestra SOLO el server del primer idioma activo.
 */

const axios = require('axios');
const cheerio = require('cheerio');

const BASE = 'https://cuevana3.sc';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function getHeaders(extra = {}) {
  return {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
    'Referer': BASE + '/',
    ...extra,
  };
}

function normalize(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function isSeriesType(type) {
  return ['tv', 'series', 'serie', 'serials'].includes(String(type || '').toLowerCase());
}

async function fetchHtml(url, referer) {
  const { data } = await axios.get(url, {
    timeout: 15000,
    headers: getHeaders(referer ? { Referer: referer } : {}),
    responseType: 'text',
    transformResponse: [(d) => d],
    validateStatus: (s) => s >= 200 && s < 400,
  });
  return data;
}

// ══════════════════════════════════════════════════════════════════
// Base64 decode del parámetro showEmbed
// ══════════════════════════════════════════════════════════════════
function decodeShowEmbed(b64) {
  if (!b64) return null;
  try {
    // Normalizar URL-safe base64
    const fixed = b64.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(fixed, 'base64').toString('utf8');
    // Validar que sea URL
    if (/^https?:\/\//i.test(decoded)) return decoded;
    return null;
  } catch {
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════
// Detección de servidor
// ══════════════════════════════════════════════════════════════════
function detectServerName(url) {
  const u = (url || '').toLowerCase();
  if (/vimeos|vimeo/.test(u)) return 'vimeos';
  if (/voe\.(sx|de|bar|net|to)/.test(u)) return 'voe';
  if (/streamwish|embedwish|hglink|flaswish|wishfast/.test(u)) return 'streamwish';
  if (/vidhide|filelions|morencius|minochinos|callistanise|hgcloud/.test(u)) return 'vidhide';
  if (/filemoon|moonplayer|byse/.test(u)) return 'filemoon';
  if (/doodstream|dood\.(la|sh|so|pm|to)|d000d/.test(u)) return 'doodstream';
  if (/uqload/.test(u)) return 'uqload';
  if (/streamtape|stape/.test(u)) return 'streamtape';
  if (/mixdrop|mxdrop/.test(u)) return 'mixdrop';
  if (/ok\.ru|okru/.test(u)) return 'okru';
  if (/vidmoly/.test(u)) return 'vidmoly';
  try {
    const host = new URL(u).hostname.replace(/^www\./, '').split('.')[0];
    return host || null;
  } catch {
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════
// Detección del idioma activo (primer tab del nav de lenguajes)
// ══════════════════════════════════════════════════════════════════
function detectActiveLang($d) {
  // Buscar el primer <li> del nav de lenguajes
  const $firstLi = $d('ul.TPlayerNv > li.open_submenu, ul.tab_language_movie > li').first();
  const flagSrc = $firstLi.find('img').attr('src') || '';
  const text = $firstLi.find('div').first().text().toLowerCase();

  if (/latin_spanish|latino/.test(flagSrc) || /latino/.test(text)) return 'latino';
  if (/spanish/.test(flagSrc) && !/latin/.test(flagSrc)) return 'castellano';
  if (/english/.test(flagSrc)) return 'subtitulado';

  // Fallback: inferir del texto
  if (/latino/.test(text)) return 'latino';
  if (/castellano|español/.test(text)) return 'castellano';
  if (/english|subtitulado/.test(text)) return 'subtitulado';

  return 'latino';
}

// ══════════════════════════════════════════════════════════════════
// Búsqueda del detalle
// ══════════════════════════════════════════════════════════════════
async function findDetailUrl(title, year, type) {
  const isSeries = isSeriesType(type);
  const titleWords = normalize(title).split(' ').filter((w) => w.length > 2);
  const yearStr = String(year || '');
  const pathPrefix = isSeries ? '/series-online/' : '/peliculas-online/';

  const searchUrl = `${BASE}/?s=${encodeURIComponent(title)}`;
  console.log(`[cuevana3sc] Search: ${searchUrl}`);

  let html;
  try {
    html = await fetchHtml(searchUrl);
  } catch (e) {
    console.warn('[cuevana3sc] Error búsqueda:', e.message);
    return null;
  }

  if (process.env.CUEVANA_DEBUG) {
    require('fs').writeFileSync('/tmp/cuevana3sc-search.html', html);
    console.log(`[cuevana3sc] HTML ${html.length}b | CF:${/cloudflare|just a moment/i.test(html)}`);
  }

  const $ = cheerio.load(html);
  const candidates = [];

  // Buscar todos los enlaces a /peliculas-online/ o /series-online/
  $(`a[href^="${pathPrefix}"]`).each((i, el) => {
    const href = $(el).attr('href') || '';
    if (!href || href === pathPrefix) return;
    // Descartar links a categorías
    if (/\/(ultimas|estrenos|tendencias|genero|director|release|elenco)/.test(href)) return;

    // Título: intentar varios selectores
    const $parent = $(el).closest('div.TPost, li.TPostMv, article');
    const titleText = $parent.find('h2.Title').first().text().trim()
                   || $parent.find('div.Title').first().text().trim()
                   || $(el).find('img').attr('alt')
                   || $(el).text().trim();

    const yearText = $parent.find('span.Year, span.Date').first().text().trim();

    if (!titleText || titleText.length < 2) return;

    // Deduplicar
    if (candidates.some(c => c.href === href)) return;

    candidates.push({
      href,
      title: titleText,
      year: yearText,
      slug: href.split('/').filter(Boolean).pop() || '',
    });
  });

  console.log(`[cuevana3sc] Candidatos: ${candidates.length}`);

  let best = null, bestScore = 0;
  for (const c of candidates) {
    const candNorm = normalize(c.title);
    const slugNorm = normalize(c.slug.replace(/-/g, ' '));
    const wordsMatched = Math.max(
      titleWords.filter((w) => candNorm.includes(w)).length,
      titleWords.filter((w) => slugNorm.includes(w)).length
    );
    const yearMatch = yearStr && (c.title.includes(yearStr) || c.year.includes(yearStr) || c.href.includes(yearStr));
    const score = wordsMatched + (yearMatch ? 3 : 0);

    if (wordsMatched < Math.min(2, titleWords.length)) continue;
    if (score > bestScore) { bestScore = score; best = c; }
  }

  if (best) {
    const fullUrl = best.href.startsWith('http') ? best.href : BASE + best.href;
    console.log(`[cuevana3sc] Match (${bestScore}pts): "${best.title}" (${best.year}) → ${fullUrl}`);
    return fullUrl;
  }

  console.log('[cuevana3sc] Sin match');
  return null;
}

// ══════════════════════════════════════════════════════════════════
// Extracción de servers desde el iframe embed-page
// ══════════════════════════════════════════════════════════════════
function extractServers($d, pageUrl, langFallback) {
  const found = {};
  const activeLang = detectActiveLang($d) || langFallback || 'latino';

  console.log(`[cuevana3sc] Idioma activo detectado: ${activeLang}`);

  // Buscar TODOS los iframes con embed-page?showEmbed=
  $d('iframe[src*="embed-page"], iframe[src*="showEmbed="]').each((i, el) => {
    try {
      let src = $d(el).attr('src') || '';
      if (!src) return;

      // Extraer el parámetro showEmbed
      const m = src.match(/[?&]showEmbed=([^&"'\s]+)/);
      if (!m) {
        // Quizás el iframe ya viene con la URL directa
        if (/^https?:\/\//.test(src) && !src.includes('embed-page')) {
          addServer(found, activeLang, src, pageUrl);
        }
        return;
      }

      const realUrl = decodeShowEmbed(m[1]);
      if (!realUrl) {
        console.warn(`[cuevana3sc] Base64 inválido en iframe ${i}: ${m[1].slice(0, 40)}...`);
        return;
      }

      console.log(`[cuevana3sc] Decodificado: ${realUrl}`);
      addServer(found, activeLang, realUrl, pageUrl);
    } catch (e) {
      console.warn(`[cuevana3sc] Error iframe ${i}:`, e.message);
    }
  });

  // Fallback: si no hay iframe, buscar en <ul class="sub-tab-lang"> los servers listados
  if (Object.keys(found).length === 0) {
    console.log('[cuevana3sc] Sin iframe con showEmbed, intentando desde tabs...');
    $d('ul.sub-tab-lang li[data-tplayernv]').each((i, el) => {
      const $li = $d(el);
      const text = $li.find('span').first().text().trim();
      // Ejemplo: "1. vimeos - Dual 1080p"
      const m = text.match(/^\d+\.\s*([a-z0-9]+)/i);
      if (m) {
        // Solo tenemos el nombre del server, no la URL
        // No podemos reproducir sin la URL real, así que solo log
        console.log(`[cuevana3sc] (sin URL) server listado: ${m[1]}`);
      }
    });
  }

  return found;
}

function addServer(found, lang, url, referer) {
  const serverName = detectServerName(url) || 'unknown';
  if (!found[lang]) found[lang] = {};

  let key = serverName.toLowerCase();
  let n = 2, finalKey = key;
  while (found[lang][finalKey]) finalKey = `${key}_${n++}`;

  found[lang][finalKey] = {
    url,
    referer,
    server: serverName,
  };
  console.log(`[cuevana3sc] ✅ ${lang}/${finalKey}: ${url.slice(0, 110)}`);
}

// ══════════════════════════════════════════════════════════════════
// Principal
// ══════════════════════════════════════════════════════════════════
async function scrapeCuevana3Sc(title, year, tmdbId, type = 'movie', lang = 'latino') {
  const found = {};
  if (!title) return found;

  const isSeries = isSeriesType(type);
  console.log(`[cuevana3sc] Buscando: "${title}" (${year}) [${isSeries ? 'serie' : 'película'}]`);

  const detailUrl = await findDetailUrl(title, year, type);
  if (!detailUrl) { console.log('[cuevana3sc] No encontró detalle'); return found; }
  console.log('[cuevana3sc] Detalle:', detailUrl);

  let html;
  try {
    html = await fetchHtml(detailUrl);
  } catch (e) {
    console.warn('[cuevana3sc] Error detalle:', e.message);
    return found;
  }

  const $d = cheerio.load(html);
  Object.assign(found, extractServers($d, detailUrl, lang));

  // Si es serie y no hay servidores, cargar primer episodio
  if (isSeries && Object.keys(found).length === 0) {
    const epHref = $d('a[href*="/ver-el-episodio/"]').first().attr('href');
    if (epHref) {
      const epUrl = epHref.startsWith('http') ? epHref : BASE + epHref;
      console.log(`[cuevana3sc] Cargando primer episodio: ${epUrl}`);
      try {
        const epHtml = await fetchHtml(epUrl, detailUrl);
        const $ep = cheerio.load(epHtml);
        Object.assign(found, extractServers($ep, epUrl, lang));
      } catch (e) {
        console.warn('[cuevana3sc] Error episodio:', e.message);
      }
    }
  }

  const total = Object.values(found).reduce((a, s) => a + Object.keys(s).length, 0);
  console.log(`[cuevana3sc] Total: ${total}`);
  return found;
}

module.exports = {
  name: 'cuevana3sc',
  scrapeCuevana3Sc,
  search: async (title, year, tmdbId, type, lang) =>
    scrapeCuevana3Sc(title, year, tmdbId, type, lang),
};
