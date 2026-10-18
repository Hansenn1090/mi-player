// api/providers/cuevana3gs.js
'use strict';

const axios = require('axios');
const cheerio = require('cheerio');

const BASE = 'https://cuevana3.gs';
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

function detectServerName(url) {
  try {
    const u = new URL(url);
    const s = u.searchParams.get('server');
    if (s) return s.toLowerCase();
  } catch { /* noop */ }

  const l = (url || '').toLowerCase();
  if (/vimeo/.test(l)) return 'vimeo';
  if (/voe\./.test(l)) return 'voe';
  if (/streamwish|embedwish/.test(l)) return 'streamwish';
  if (/vidhide|filelions/.test(l)) return 'vidhide';
  if (/filemoon|moonplayer/.test(l)) return 'filemoon';
  if (/doodstream|dood\./.test(l)) return 'doodstream';
  if (/uqload/.test(l)) return 'uqload';
  if (/goodstream/.test(l)) return 'goodstream';
  return null;
}

async function findDetailUrl(title, year, type) {
  const isSeries = isSeriesType(type);
  const titleWords = normalize(title).split(' ').filter((w) => w.length > 2);
  const yearStr = String(year || '');
  const pathPrefix = isSeries ? '/series/' : '/peliculas/';

  const searchUrl = `${BASE}/?s=${encodeURIComponent(title)}`;
  console.log(`[cuevana3gs] Search: ${searchUrl}`);

  let html;
  try {
    html = await fetchHtml(searchUrl);
  } catch (e) {
    console.warn('[cuevana3gs] Error búsqueda:', e.message);
    return null;
  }

  if (process.env.CUEVANA_DEBUG) {
    require('fs').writeFileSync('/tmp/cuevana3gs-search.html', html);
    console.log(`[cuevana3gs] HTML ${html.length}b | CF:${/cloudflare|just a moment/i.test(html)}`);
  }

  const $ = cheerio.load(html);
  const candidates = [];

  // FIX: Acepta URLs relativas y absolutas
  $(`a[href*="${pathPrefix}"]`).each((i, el) => {
    let href = $(el).attr('href') || '';
    
    // Normalizar a ruta relativa si viene absoluta
    if (href.startsWith('http')) {
      try { href = new URL(href).pathname; } catch(e) { return; }
    }
    
    if (!href.startsWith(pathPrefix)) return;
    const rest = href.slice(pathPrefix.length).replace(/\/$/, '');
    if (!rest || rest.includes('/')) return;

    // FIX: Extracción de título más robusta
    const imgAlt = $(el).find('img').attr('alt') || '';
    const hTag = $(el).find('h2, h3').first().text().trim();
    const parentTitle = $(el).parent().find('.Title').first().text().trim();
    const titleText = imgAlt || hTag || parentTitle || $(el).text().trim();
    
    if (!titleText) return;

    candidates.push({ href, title: titleText });
  });

  console.log(`[cuevana3gs] Candidatos: ${candidates.length}`);

  let best = null, bestScore = 0;
  for (const c of candidates) {
    const candNorm = normalize(c.title);
    const slugNorm = normalize(c.href.replace(/-/g, ' '));
    const wordsMatched = Math.max(
      titleWords.filter((w) => candNorm.includes(w)).length,
      titleWords.filter((w) => slugNorm.includes(w)).length
    );
    const yearMatch = yearStr && (c.title.includes(yearStr) || c.href.includes(yearStr));
    const score = wordsMatched + (yearMatch ? 3 : 0);

    if (wordsMatched < Math.min(2, titleWords.length)) continue;
    if (score > bestScore) { bestScore = score; best = c; }
  }

  if (best) {
    const fullUrl = best.href.startsWith('http') ? best.href : BASE + best.href;
    console.log(`[cuevana3gs] Match (${bestScore}): "${best.title}" → ${fullUrl}`);
    return fullUrl;
  }

  console.log('[cuevana3gs] Sin match');
  return null;
}

function extractServers($d, pageUrl, langFallback) {
  const found = {};

  let activeLang = langFallback || 'latino';
  const langSpan = $d('span.uppercase').first().text().trim().toLowerCase();
  if (/castellano|español/.test(langSpan)) activeLang = 'castellano';
  else if (/subtitulado/.test(langSpan)) activeLang = 'subtitulado';
  else if (/latino/.test(langSpan)) activeLang = 'latino';

  $d('iframe').each((i, el) => {
    try {
      let src = $d(el).attr('src') || $d(el).attr('data-src');
      if (!src) return;
      if (src.startsWith('//')) src = 'https:' + src;
      if (!src.startsWith('http')) return;
      if (src === 'about:blank') return;

      if (!/\/player\.php\?/.test(src) && !detectServerName(src)) return;
      if (/histats|cloudflare|google|doubleclick|adsanalytics/i.test(src)) return;

      const serverName = detectServerName(src) || 'unknown';

      if (!found[activeLang]) found[activeLang] = {};

      let key = serverName.toLowerCase();
      let n = 2, finalKey = key;
      while (found[activeLang][finalKey]) finalKey = `${key}_${n++}`;

      found[activeLang][finalKey] = {
        url: src,
        referer: pageUrl,
        server: serverName,
      };
      console.log(`[cuevana3gs] ✅ ${activeLang}/${finalKey}: ${src.slice(0, 110)}`);
    } catch (e) {
      console.warn(`[cuevana3gs] iframe ${i} falló:`, e.message);
    }
  });

  return found;
}

async function scrapeCuevana3Gs(title, year, tmdbId, type = 'movie', lang = 'latino') {
  const found = {};
  if (!title) return found;

  const isSeries = isSeriesType(type);
  console.log(`[cuevana3gs] Buscando: "${title}" (${year}) [${isSeries ? 'serie' : 'película'}]`);

  const detailUrl = await findDetailUrl(title, year, type);
  if (!detailUrl) { console.log('[cuevana3gs] No encontró detalle'); return found; }
  console.log('[cuevana3gs] Detalle:', detailUrl);

  let html;
  try {
    html = await fetchHtml(detailUrl);
  } catch (e) {
    console.warn('[cuevana3gs] Error detalle:', e.message);
    return found;
  }

  const $d = cheerio.load(html);
  Object.assign(found, extractServers($d, detailUrl, lang));

  if (isSeries && Object.keys(found).length === 0) {
    const epHref = $d('a[href*="/episodio/"]').first().attr('href');
    if (epHref) {
      const epUrl = epHref.startsWith('http') ? epHref : BASE + epHref;
      console.log(`[cuevana3gs] Cargando primer episodio: ${epUrl}`);
      try {
        const epHtml = await fetchHtml(epUrl, detailUrl);
        const $ep = cheerio.load(epHtml);
        Object.assign(found, extractServers($ep, epUrl, lang));
      } catch (e) {
        console.warn('[cuevana3gs] Error episodio:', e.message);
      }
    }
  }

  const total = Object.values(found).reduce((a, s) => a + Object.keys(s).length, 0);
  console.log(`[cuevana3gs] Total: ${total}`);
  return found;
}

module.exports = {
  name: 'cuevana3gs',
  scrapeCuevana3Gs,
  search: async (title, year, tmdbId, type, lang) =>
    scrapeCuevana3Gs(title, year, tmdbId, type, lang),
};

console.log('[cuevana3gs] Provider cargado');
