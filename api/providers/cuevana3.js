// api/providers/cuevana3.js
/**
 * Cuevana3.now — WordPress con reproductor multi-idioma
 *
 * Estrategia:
 *   1. Buscar por título en /?s=... (WordPress)
 *   2. Buscar por título en wp-json API (fallback)
 *   3. Cargar la página de detalle
 *   4. Extraer TODOS los iframes del contenedor `.TPlayerTb`
 *
 * Los iframes tienen ID OptE{X}{Y}:
 *   OptE1X → Latino (Dood/VOE/VidHide/StreamWish)
 *   OptE2X → Subtitulado
 *   OptE3X → Español (castellano)
 */

const axios = require('axios');
const cheerio = require('cheerio');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const BASE = 'https://www1.cuevana3.now';

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
  return 'Servidor';
}

// Mapeo de ID → idioma
const ID_LANG = {
  '1': 'latino',       // OptE1X → Latino
  '2': 'subtitulado',  // OptE2X → Subtitulado
  '3': 'castellano',   // OptE3X → Español (castellano)
};

// Normaliza texto para comparar
function normalize(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Extrae año del texto
function extractYear(text) {
  const m = String(text || '').match(/\b(19|20)\d{2}\b/);
  return m ? m[0] : '';
}

// ══════════════════════════════════════════════════════════════════
// Buscar URL de detalle por título
// ══════════════════════════════════════════════════════════════════
async function findDetailUrl(title, year) {
  const titleWords = normalize(title).split(' ').filter(w => w.length > 2);
  const yearStr = String(year || '');

  // ─── Estrategia 1: WordPress search (/?s=) ───────────────────
  try {
    const searchUrl = `${BASE}/?s=${encodeURIComponent(title)}`;
    console.log(`[cuevana3] Search: ${searchUrl}`);
    const { data: searchHtml } = await axios.get(searchUrl, {
      timeout: 10000,
      headers: getHeaders({ 'Referer': BASE + '/' }),
      validateStatus: s => s >= 200 && s < 400,
    });

    const $ = cheerio.load(searchHtml);
    const candidates = [];

    $('a').each((i, el) => {
      const href = $(el).attr('href') || '';
      // Cuevana3 usa /{id}/{slug} o /peliculas-online/{id}/{slug}/
      if (!/^\/\d+\//.test(href) && !href.includes('/peliculas-online/')) return;
      // Evitar categorías, tags, etc.
      if (/\/category\/|\/tag\/|\/actor\/|\/director\/|\/genero/.test(href)) return;

      const text = ($(el).text() + ' ' + ($(el).find('h1,h2,h3,.Title,.title').text() || '')).trim();
      if (text.length < 3) return;

      candidates.push({ href, text });
    });

    console.log(`[cuevana3] Candidatos: ${candidates.length}`);

    // Buscar mejor match
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
      const fullUrl = best.href.startsWith('http') ? best.href : BASE + best.href;
      console.log(`[cuevana3] Match (${bestScore}pts): ${best.text.slice(0, 60)} → ${fullUrl}`);
      return fullUrl;
    }
  } catch (e) {
    console.warn('[cuevana3] Error en /?s=:', e.message);
  }

  // ─── Estrategia 2: wp-json API ───────────────────────────────
  try {
    const apiUrl = `${BASE}/wp-json/wp/v2/search?search=${encodeURIComponent(title)}&per_page=10`;
    console.log(`[cuevana3] WP-API: ${apiUrl}`);
    const { data } = await axios.get(apiUrl, {
      timeout: 10000,
      headers: getHeaders(),
      validateStatus: s => s >= 200 && s < 400,
    });

    if (Array.isArray(data)) {
      for (const item of data) {
        if (!item.url) continue;
        const itemNorm = normalize(item.title || '');
        const wordsMatched = titleWords.filter(w => itemNorm.includes(w)).length;
        if (wordsMatched >= Math.min(2, titleWords.length)) {
          console.log(`[cuevana3] WP-API match: ${item.title} → ${item.url}`);
          return item.url;
        }
      }
    }
  } catch (e) {
    // WP-API puede estar deshabilitado, es normal
  }

  return null;
}

// ══════════════════════════════════════════════════════════════════
// Función principal
// ══════════════════════════════════════════════════════════════════
async function scrapeCuevana3(title, year, tmdbId, type = 'movie') {
  const found = {};
  if (!title) return found;
  console.log('[cuevana3] Buscando:', title, year || '');

  // 1) Encontrar URL de detalle
  const detailUrl = await findDetailUrl(title, year);

  if (!detailUrl) {
    console.log('[cuevana3] No encontró detalle');
    return found;
  }
  console.log('[cuevana3] Detalle:', detailUrl);

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
    console.warn('[cuevana3] Error detalle:', e.message);
    return found;
  }

  const $d = cheerio.load(detailHtml);

  // 3) Extraer TODOS los iframes
  $d('.TPlayerTb iframe, iframe.no-you, iframe[data-src]').each((i, el) => {
    const src = $d(el).attr('data-src') || $d(el).attr('src');
    if (!src) return;
    if (!src.startsWith('http')) return;
    if (src === 'about:blank') return;

    // Extraer ID del padre (OptE11, OptE12, etc.)
    const parentId = $d(el).parent().attr('id')
      || $d(el).closest('[id]').attr('id')
      || $d(el).closest('.TPlayerTb').attr('id')
      || '';

    const idMatch = parentId.match(/OptE(\d)(\d)/);
    let lang = 'latino';
    let hostIndex = i + 1;

    if (idMatch) {
      const langDigit = idMatch[1];
      hostIndex = parseInt(idMatch[2], 10);
      lang = ID_LANG[langDigit] || 'latino';
    }

    const hostName = detectServerName(src);
    if (hostName === 'Servidor') return;

    const key = hostName.toLowerCase();
    if (!found[lang]) found[lang] = {};

    let finalKey = key;
    if (found[lang][finalKey]) {
      finalKey = `${key}_${hostIndex}`;
    }

    if (!found[lang][finalKey]) {
      found[lang][finalKey] = src;
      console.log(`[cuevana3] ✅ ${lang}/${finalKey}: ${src.slice(0, 90)}`);
    }
  });

  const total = Object.values(found).reduce((a, s) => a + Object.keys(s).length, 0);
  console.log(`[cuevana3] Total: ${total}`);
  return found;
}

module.exports = {
  scrapeCuevana3,
  search: async (title, year, tmdbId, type) => scrapeCuevana3(title, year, tmdbId, type),
};

console.log('[cuevana3] Provider cargado');
