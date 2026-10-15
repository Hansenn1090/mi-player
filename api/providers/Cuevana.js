// api/providers/cuevana.js
/**
 * Cuevana3.sc — WordPress con reproductor multi-idioma
 *
 * Soporta películas y series:
 *   Películas: /peliculas-online/{post_id}/{slug}/
 *   Series:    /series-online/{post_id}/{slug}/
 *
 * El número (120290) NO es el TMDB ID — es el ID interno de WordPress.
 * Por eso SIEMPRE buscamos por título (no construimos URL con TMDB ID).
 *
 * Los iframes usan showEmbed=BASE64 que decodifica a la URL real:
 *   https://cuevana3.sc/embed-page?showEmbed=aHR0cHM6Ly92aW1lb3MubmV0L2VtYmVk...
 *   → https://vimeos.net/embed-2nulhg4mnuz7.html
 */

const axios = require('axios');
const cheerio = require('cheerio');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const BASE = 'https://cuevana3.sc';

function getHeaders(extra = {}) {
  return {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Upgrade-Insecure-Requests': '1',
    ...extra,
  };
}

function detectServerName(url) {
  const u = (url || '').toLowerCase();
  if (/voe\.sx|voe\.de|voe\.bar|voe\.net|voe\.to/i.test(u)) return 'VOE';
  if (/vimeos/i.test(u)) return 'Vimeos';
  if (/streamwish|embedwish|hglink|flaswish|wishfast/i.test(u)) return 'StreamWish';
  if (/vidhide|morencius|minochinos|callistanise|hgcloud|filelions/i.test(u)) return 'VidHide';
  if (/filemoon|moonplayer|byse/i.test(u)) return 'FileMoon';
  if (/doodstream|dood\.la|dood\.sh|d000d/i.test(u)) return 'DoodStream';
  if (/fembed/i.test(u)) return 'Fembed';
  if (/uqload/i.test(u)) return 'Uqload';
  if (/streamtape|stape/i.test(u)) return 'StreamTape';
  if (/mixdrop|mxdrop/i.test(u)) return 'MixDrop';
  if (/ok\.ru|okru/i.test(u)) return 'OkRu';
  if (/vidmoly/i.test(u)) return 'Vidmoly';
  if (/powvideo/i.test(u)) return 'Powvideo';
  if (/streamplay/i.test(u)) return 'Streamplay';
  if (/netu|waaw|hqq/i.test(u)) return 'Netu';
  if (/fastream/i.test(u)) return 'Fastream';
  if (/streamsb|sbfull/i.test(u)) return 'StreamSB';
  if (/vidspeed/i.test(u)) return 'VidSpeed';
  return 'Servidor';
}

const URL_PATTERNS = [
  /https?:\/\/(?:www\.)?vimeos\.[^\s"'<>)]+/gi,
  /https?:\/\/(?:www\.)?(?:streamwish|embedwish|hglink|flaswish)\.[^\s"'<>)]+/gi,
  /https?:\/\/(?:www\.)?(?:vidhide|filelions|minochinos|callistanise)\.[^\s"'<>)]+/gi,
  /https?:\/\/(?:www\.)?(?:filemoon|moonplayer)\.[^\s"'<>)]+/gi,
  /https?:\/\/(?:www\.)?(?:doodstream|dood\.[a-z]+)\/[^\s"'<>)]+/gi,
  /https?:\/\/(?:www\.)?(?:mixdrop|mxdrop)\.[^\s"'<>)]+/gi,
  /https?:\/\/(?:www\.)?voe\.[a-z]+[^\s"'<>)]*/gi,
  /https?:\/\/(?:www\.)?vidmoly\.[^\s"'<>)]+/gi,
  /https?:\/\/(?:www\.)?(?:ok\.ru|okru)\/[^\s"'<>)]+/gi,
  /https?:\/\/(?:www\.)?streamtape\.[^\s"'<>)]+/gi,
  /https?:\/\/(?:www\.)?uqload\.[^\s"'<>)]+/gi,
  /https?:\/\/(?:www\.)?powvideo\.[^\s"'<>)]+/gi,
  /https?:\/\/(?:www\.)?streamplay\.[^\s"'<>)]+/gi,
];

// ══════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════
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
  if (/\.(jpg|jpeg|png|gif|webp|svg|css|js)(\?|$)/i.test(u)) return;
  const name = detectServerName(u);
  if (name === 'Servidor') return;
  const targetLang = (lang === 'latino' || lang === 'español' || lang === 'castellano' || lang === 'esp') ? 'latino' : 'subtitulado';
  if (!found[targetLang]) found[targetLang] = {};
  if (!found[targetLang][name]) {
    found[targetLang][name] = u;
    console.log(`[cuevana] ✅ ${targetLang}/${name}: ${u.slice(0, 80)}`);
  }
}

// ══════════════════════════════════════════════════════════════════
// Encontrar URL de detalle
// ══════════════════════════════════════════════════════════════════
async function findDetailUrl(title, year, tmdbId, type) {
  const isSeries = isSeriesType(type);
  const titleWords = normalize(title).split(' ').filter(w => w.length > 2);
  const yearStr = String(year || '');
  const pathPrefix = isSeries ? '/series-online/' : '/peliculas-online/';

  // ─── Estrategia 1: wp-json API (más fiable) ────────────────
  try {
    const apiUrl = `${BASE}/wp-json/wp/v2/search?search=${encodeURIComponent(title)}&per_page=10&type=post`;
    console.log(`[cuevana] WP-API: ${apiUrl}`);

    const { data } = await axios.get(apiUrl, {
      timeout: 10000,
      headers: getHeaders(),
      validateStatus: s => s >= 200 && s < 400,
    });

    if (Array.isArray(data) && data.length > 0) {
      let best = null;
      let bestScore = 0;

      for (const item of data) {
        if (!item.url) continue;
        const itemNorm = normalize(item.title || '');
        const wordsMatched = titleWords.filter(w => itemNorm.includes(w)).length;
        const yearMatch = yearStr && (item.url.includes(yearStr) || item.title.includes(yearStr));
        const score = wordsMatched + (yearMatch ? 3 : 0);

        if (score > bestScore && wordsMatched >= Math.min(2, titleWords.length)) {
          bestScore = score;
          best = item;
        }
      }

      if (best) {
        console.log(`[cuevana] WP-API match (${bestScore}pts): ${best.title} → ${best.url}`);
        return best.url;
      }
    }
  } catch (e) {
    console.warn('[cuevana] WP-API falló:', e.message);
  }

  // ─── Estrategia 2: /?s= search ─────────────────────────────
  try {
    const searchUrl = `${BASE}/?s=${encodeURIComponent(title)}`;
    const { data: searchHtml } = await axios.get(searchUrl, {
      timeout: 10000,
      headers: getHeaders({ 'Referer': BASE + '/' }),
      validateStatus: s => s >= 200 && s < 400,
    });

    const $ = cheerio.load(searchHtml);
    const candidates = [];

    $('a').each((i, el) => {
      const href = $(el).attr('href') || '';
      if (!href.includes(pathPrefix)) return;
      // Ignorar categorías, tags
      if (/\/category\/|\/tag\/|\/actor\/|\/director\/|\/genero/.test(href)) return;

      const text = ($(el).text() + ' ' + ($(el).find('h1,h2,h3,.Title,.title').text() || '')).toLowerCase();
      if (text.length < 3) return;

      candidates.push({ href, text });
    });

    console.log(`[cuevana] Candidatos /?s=: ${candidates.length}`);

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
      console.log(`[cuevana] /?s= match (${bestScore}pts): ${best.text.slice(0, 60)} → ${best.href}`);
      return best.href.startsWith('http') ? best.href : BASE + best.href;
    }

    // Fallback: primera palabra
    if (candidates.length > 0 && titleWords.length > 0) {
      for (const c of candidates) {
        if (normalize(c.text).includes(titleWords[0])) {
          return c.href.startsWith('http') ? c.href : BASE + c.href;
        }
      }
    }
  } catch (e) {
    console.warn('[cuevana] Error /?s=:', e.message);
  }

  return null;
}

// ══════════════════════════════════════════════════════════════════
// Función principal — firma correcta (title, year, tmdbId, type, lang)
// ══════════════════════════════════════════════════════════════════
async function scrapeCuevana(title, year, tmdbId, type = 'movie', lang = 'latino') {
  const found = {};
  if (!title) return found;

  const isSeries = isSeriesType(type);
  console.log(`[cuevana] Buscando: "${title}" (${year}) [${isSeries ? 'serie' : 'película'}]`);

  // 1) Encontrar URL de detalle
  const detailUrl = await findDetailUrl(title, year, tmdbId, type);

  if (!detailUrl) {
    console.log('[cuevana] No encontró detalle');
    return found;
  }
  console.log('[cuevana] Detalle:', detailUrl);

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
    console.warn('[cuevana] Error detalle:', e.message);
    return found;
  }

  const $d = cheerio.load(detailHtml);

  // ─── MÉTODO 1: iframes con base64 (showEmbed) ──────────────
  $d('iframe[src*="embed-page"], iframe[src*="showEmbed"], iframe[data-src*="showEmbed"]').each((i, el) => {
    const src = $d(el).attr('src') || $d(el).attr('data-src');
    if (!src) return;
    const m = src.match(/showEmbed=([A-Za-z0-9+/=]+)/);
    if (!m) return;
    try {
      const decoded = Buffer.from(m[1], 'base64').toString('utf-8');
      if (!decoded.startsWith('http')) return;
      console.log(`[cuevana] 🔓 Base64: ${decoded}`);
      addServer(found, lang, decoded, BASE);
    } catch (e) { /* skip */ }
  });

  // ─── MÉTODO 2: buscar base64 en TODO el HTML (por si está en JS) ─
  const base64Regex = /showEmbed=([A-Za-z0-9+/=]{20,})/g;
  let b64Match;
  while ((b64Match = base64Regex.exec(detailHtml)) !== null) {
    try {
      const decoded = Buffer.from(b64Match[1], 'base64').toString('utf-8');
      if (!decoded.startsWith('http')) continue;
      console.log(`[cuevana] 🔓 Base64 (regex): ${decoded}`);
      addServer(found, lang, decoded, BASE);
    } catch (e) { /* skip */ }
  }

  // ─── MÉTODO 3: iframes directos ────────────────────────────
  $d('iframe').each((i, el) => {
    const src = $d(el).attr('src') || $d(el).attr('data-src') || $d(el).attr('data-litespeed-src');
    if (!src) return;
    if (src.includes('showEmbed')) return; // Ya procesados
    if (src === 'about:blank') return;
    addServer(found, lang, src, BASE);
  });

  // ─── MÉTODO 4: data-pp-embed ───────────────────────────────
  $d('[data-pp-embed]').each((i, el) => {
    const embedRaw = $d(el).attr('data-pp-embed');
    const langAttr = ($d(el).attr('data-pp-lang') || lang).toLowerCase();
    if (!embedRaw) return;
    const decoded = embedRaw.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&');
    const m = decoded.match(/src=["']([^"']+)["']/);
    if (!m) return;
    addServer(found, langAttr, m[1], BASE);
  });

  // ─── MÉTODO 5: regex en HTML completo ──────────────────────
  for (const re of URL_PATTERNS) {
    const matches = detailHtml.match(re);
    if (matches) matches.forEach(u => addServer(found, lang, u, BASE));
  }

  const total = Object.values(found).reduce((a, s) => a + Object.keys(s).length, 0);
  console.log(`[cuevana] Total: ${total}`);
  return found;
}

module.exports = {
  name: 'cuevana',
  scrapeCuevana,
  search: async (title, year, tmdbId, type, lang) => scrapeCuevana(title, year, tmdbId, type, lang),
};

console.log('[cuevana] Provider cargado');
