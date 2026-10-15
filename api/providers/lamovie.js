// api/providers/lamovie.js
/**
 * LaMovie.org — WordPress con React, iframe Vimeos server-side
 *
 * URL pattern: /peliculas/{slug}/
 * Iframe directo en HTML: <iframe src="https://vimeos.net/embed-XXX.html">
 *
 * Config del sitio:
 *   window.siteConfig.player.prior = ["vimeos", "goodstream", "voe"]
 *
 * Como Vimeos tiene extractor propio, estas URLs van con HLS control total.
 */

const axios = require('axios');
const cheerio = require('cheerio');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const BASE = 'https://lamovie.org';

function getHeaders(extra = {}) {
  return {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
    'Referer': BASE + '/',
    ...extra,
  };
}

function detectServerName(url) {
  const u = (url || '').toLowerCase();
  if (/vimeos/i.test(u)) return 'Vimeos';
  if (/voe\.sx|voe\.de|voe\.bar|voe\.net|voe\.to/i.test(u)) return 'VOE';
  if (/goodstream/i.test(u)) return 'GoodStream';
  if (/streamwish|embedwish|hglink|flaswish/i.test(u)) return 'StreamWish';
  if (/vidhide|morencius|minochinos|callistanise|filelions/i.test(u)) return 'VidHide';
  if (/filemoon|moonplayer|byse/i.test(u)) return 'FileMoon';
  if (/doodstream|dood\.la|dood\.sh/i.test(u)) return 'DoodStream';
  if (/mixdrop|mxdrop/i.test(u)) return 'MixDrop';
  if (/ok\.ru|okru/i.test(u)) return 'OkRu';
  if (/vidmoly/i.test(u)) return 'Vidmoly';
  return 'Servidor';
}

function isSeriesType(type) {
  return ['tv', 'series', 'serie', 'serials'].includes(String(type || '').toLowerCase());
}

function normalize(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ')
    .trim();
}

function addServer(found, lang, rawUrl, baseUrl) {
  if (!rawUrl) return;
  let u = String(rawUrl).trim();
  if (u.startsWith('//')) u = 'https:' + u;
  if (u.startsWith('/')) u = baseUrl + u;
  if (!u.startsWith('http')) return;
  if (/doubleclick|google|youtube|histats|yandex|facebook|cloudflare|googletagmanager|disqus|gravatar/i.test(u)) return;

  const name = detectServerName(u);
  if (name === 'Servidor') return;

  if (!found[lang]) found[lang] = {};
  const key = name.toLowerCase();
  if (!found[lang][key]) {
    found[lang][key] = u;
    console.log(`[lamovie] ✅ ${lang}/${key}: ${u.slice(0, 90)}`);
  }
}

// ══════════════════════════════════════════════════════════════════
// Buscar URL de detalle
// ══════════════════════════════════════════════════════════════════
async function findDetailUrl(title, year, type) {
  const isSeries = isSeriesType(type);
  const titleWords = normalize(title).split(' ').filter(w => w.length > 2);
  const yearStr = String(year || '');

  // Path según tipo
  const pathRegex = isSeries ? /\/(series|serie)\// : /\/peliculas\//;

  // ─── Estrategia 1: /?s= search ──────────────────────────────
  try {
    const searchUrl = `${BASE}/?s=${encodeURIComponent(title)}`;
    console.log(`[lamovie] Search: ${searchUrl}`);

    const { data: searchHtml } = await axios.get(searchUrl, {
      timeout: 10000,
      headers: getHeaders(),
      validateStatus: s => s >= 200 && s < 400,
    });

    const $ = cheerio.load(searchHtml);
    const candidates = [];

    $('a').each((i, el) => {
      const href = $(el).attr('href') || '';
      if (!pathRegex.test(href)) return;
      if (/\/category\/|\/tag\/|\/actor\/|\/director\/|\/genero/.test(href)) return;

      const text = ($(el).text() + ' ' + ($(el).find('h1,h2,h3,.title').text() || '')).trim();
      if (text.length < 3) return;
      candidates.push({ href, text });
    });

    console.log(`[lamovie] Candidatos: ${candidates.length}`);

    let best = null;
    let bestScore = 0;
    for (const c of candidates) {
      const candNorm = normalize(c.text);
      const wordsMatched = titleWords.filter(w => candNorm.includes(w)).length;
      const yearMatch = yearStr && c.text.includes(yearStr);
      const score = wordsMatched + (yearMatch ? 3 : 0);
      if (score > bestScore && wordsMatched >= Math.min(2, titleWords.length)) {
        bestScore = score;
        best = c;
      }
    }

    if (best) {
      const url = best.href.startsWith('http') ? best.href : BASE + best.href;
      console.log(`[lamovie] Match (${bestScore}pts): ${url}`);
      return url;
    }
  } catch (e) {
    console.warn('[lamovie] Error búsqueda:', e.message);
  }

  // ─── Estrategia 2: wp-json custom API ───────────────────────
  try {
    const apiUrl = `${BASE}/wp-json/wpf/v1/search?q=${encodeURIComponent(title)}`;
    const { data } = await axios.get(apiUrl, {
      timeout: 10000,
      headers: getHeaders(),
      validateStatus: s => s >= 200 && s < 400,
    });

    if (Array.isArray(data) && data.length > 0) {
      for (const item of data) {
        const itemNorm = normalize(item.title || item.name || '');
        const wordsMatched = titleWords.filter(w => itemNorm.includes(w)).length;
        if (wordsMatched >= Math.min(2, titleWords.length)) {
          const url = item.url || item.link || item.permalink;
          if (url) {
            console.log(`[lamovie] wp-json match: ${url}`);
            return url;
          }
        }
      }
    }
  } catch (e) {
    // WP-API puede no estar disponible
  }

  return null;
}

// ══════════════════════════════════════════════════════════════════
// Función principal — firma correcta (title, year, tmdbId, type, lang)
// ══════════════════════════════════════════════════════════════════
async function scrapeLamovie(title, year, tmdbId, type = 'movie', lang = 'latino') {
  const found = {};
  if (!title) return found;

  const isSeries = isSeriesType(type);
  console.log(`[lamovie] Buscando: "${title}" (${year}) [${isSeries ? 'serie' : 'película'}]`);

  // 1) Encontrar URL de detalle
  const detailUrl = await findDetailUrl(title, year, type);

  if (!detailUrl) {
    console.log('[lamovie] No encontró detalle');
    return found;
  }
  console.log('[lamovie] Detalle:', detailUrl);

  // 2) Cargar página de detalle
  let detailHtml = '';
  try {
    const { data } = await axios.get(detailUrl, {
      timeout: 12000,
      headers: getHeaders({ 'Referer': BASE + '/' }),
      validateStatus: s => s >= 200 && s < 400,
    });
    detailHtml = data;
  } catch (e) {
    console.warn('[lamovie] Error detalle:', e.message);
    return found;
  }

  const $d = cheerio.load(detailHtml);

  // 3) Extraer iframes — el primero suele ser Vimeos (prior = ["vimeos", ...])
  $d('iframe').each((i, el) => {
    const src = $d(el).attr('src') || $d(el).attr('data-src');
    if (!src) return;
    if (src === 'about:blank') return;
    if (!src.startsWith('http')) return;
    addServer(found, lang, src, BASE);
  });

  // 4) Fallback: buscar URLs de hosts conocidos en el HTML
  const patterns = [
    /https?:\/\/(?:www\.)?vimeos\.[^\s"'<>)]+/gi,
    /https?:\/\/(?:www\.)?(?:streamwish|embedwish|hglink)\.[^\s"'<>)]+/gi,
    /https?:\/\/(?:www\.)?(?:vidhide|filelions)\.[^\s"'<>)]+/gi,
    /https?:\/\/(?:www\.)?voe\.[a-z]+[^\s"'<>)]*/gi,
    /https?:\/\/(?:www\.)?goodstream\.[^\s"'<>)]+/gi,
    /https?:\/\/(?:www\.)?filemoon\.[^\s"'<>)]+/gi,
    /https?:\/\/(?:www\.)?doodstream\.[^\s"'<>)]+/gi,
  ];

  for (const re of patterns) {
    const matches = detailHtml.match(re);
    if (matches) matches.forEach(u => addServer(found, lang, u, BASE));
  }

  const total = Object.values(found).reduce((a, s) => a + Object.keys(s).length, 0);
  console.log(`[lamovie] Total: ${total}`);
  return found;
}

module.exports = {
  name: 'lamovie',
  scrapeLamovie,
  search: async (title, year, tmdbId, type, lang) => scrapeLamovie(title, year, tmdbId, type, lang),
};

console.log('[lamovie] Provider cargado');
