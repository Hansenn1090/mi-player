// api/providers/pelispediais.js
/**
 * PelisPedia.is — Sitio WordPress con reproductor multi-opción
 *
 * Soporta películas y series:
 *   Películas: /pelicula/{slug}/
 *   Series:    /serie/{slug}/  o  /series/{slug}/
 *
 * Cada título tiene 3 iframes con trembed:
 *   trembed=0 → LATINO
 *   trembed=1 → CASTELLANO
 *   trembed=2 → VOSE (subtitulado)
 *
 * Los iframes son embebibles directamente y redirigen internamente
 * al hosting real (Fastream, StreamWish, etc.) sin Cloudflare.
 */

const axios = require('axios');
const cheerio = require('cheerio');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const BASE = 'https://pelispedia.is';

function getHeaders(extra = {}) {
  return {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
    'Referer': BASE + '/',
    ...extra,
  };
}

// Mapa de índice trembed → idioma
const LANG_MAP = {
  '0': 'latino',
  '1': 'castellano',
  '2': 'subtitulado',
};

// ══════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════
function isSeriesType(type) {
  return ['tv', 'series', 'serie', 'serials'].includes(String(type || '').toLowerCase());
}

function normalize(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ══════════════════════════════════════════════════════════════════
// Buscar URL de detalle
// ══════════════════════════════════════════════════════════════════
async function findDetailUrl(title, year, type) {
  const isSeries = isSeriesType(type);
  const titleWords = normalize(title).split(' ').filter(w => w.length > 2);
  const yearStr = String(year || '');

  // Paths válidos según tipo
  const pathMatchers = isSeries
    ? [/\/serie\//, /\/series\//, /\/tv\//]
    : [/\/pelicula\//, /\/peliculas\//, /\/movie\//];

  // ─── Estrategia 1: wp-json API (más fiable) ────────────────
  try {
    const apiUrl = `${BASE}/wp-json/wp/v2/search?search=${encodeURIComponent(title)}&per_page=15`;
    console.log(`[pelispediais] WP-API: ${apiUrl}`);

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

        // Filtrar por tipo
        const urlPath = item.url.replace(BASE, '');
        const matchesType = pathMatchers.some(re => re.test(urlPath));
        if (!matchesType) continue;

        const itemNorm = normalize(item.title || '');
        const wordsMatched = titleWords.filter(w => itemNorm.includes(w)).length;
        const yearMatch = yearStr && (item.url.includes(yearStr) || (item.title || '').includes(yearStr));
        const score = wordsMatched + (yearMatch ? 3 : 0);

        if (score > bestScore && wordsMatched >= Math.min(2, titleWords.length)) {
          bestScore = score;
          best = item;
        }
      }

      if (best) {
        console.log(`[pelispediais] WP-API match (${bestScore}pts): ${best.title} → ${best.url}`);
        return best.url;
      }
    }
  } catch (e) {
    console.warn('[pelispediais] WP-API falló:', e.message);
  }

  // ─── Estrategia 2: /?s= search ─────────────────────────────
  try {
    const searchUrl = `${BASE}/?s=${encodeURIComponent(title)}`;
    console.log(`[pelispediais] Search: ${searchUrl}`);

    const { data: searchHtml } = await axios.get(searchUrl, {
      timeout: 10000,
      headers: getHeaders(),
      validateStatus: s => s >= 200 && s < 400,
    });

    const $ = cheerio.load(searchHtml);
    const candidates = [];

    $('a').each((i, el) => {
      const href = $(el).attr('href') || '';
      // Ignorar categorías, tags
      if (/\/category\/|\/tag\/|\/actor\/|\/director\/|\/genero/.test(href)) return;

      // Verificar que coincide con el tipo
      const matchesType = pathMatchers.some(re => re.test(href));
      if (!matchesType) return;

      const text = ($(el).text() + ' ' + ($(el).find('h1,h2,h3,.Title,.title,.entry-title').text() || '')).trim();
      if (text.length < 3) return;

      candidates.push({ href, text });
    });

    console.log(`[pelispediais] Candidatos: ${candidates.length}`);

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
      console.log(`[pelispediais] Match (${bestScore}pts): ${best.text.slice(0, 60)} → ${fullUrl}`);
      return fullUrl;
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
    console.warn('[pelispediais] Error /?s=:', e.message);
  }

  return null;
}

// ══════════════════════════════════════════════════════════════════
// Función principal — firma correcta (title, year, tmdbId, type, lang)
// ══════════════════════════════════════════════════════════════════
async function scrapePelispediaIS(title, year, tmdbId, type = 'movie', lang = 'latino') {
  const found = {};
  if (!title) return found;

  const isSeries = isSeriesType(type);
  console.log(`[pelispediais] Buscando: "${title}" (${year}) [${isSeries ? 'serie' : 'película'}]`);

  // 1) Encontrar URL de detalle
  const detailUrl = await findDetailUrl(title, year, type);

  if (!detailUrl) {
    console.log('[pelispediais] No encontró detalle');
    return found;
  }
  console.log('[pelispediais] Detalle:', detailUrl);

  // 2) Cargar página de detalle
  let detailHtml = '';
  try {
    const { data } = await axios.get(detailUrl, {
      timeout: 12000,
      headers: getHeaders(),
      validateStatus: s => s >= 200 && s < 400,
    });
    detailHtml = data;
  } catch (e) {
    console.warn('[pelispediais] Error detalle:', e.message);
    return found;
  }

  const $d = cheerio.load(detailHtml);

  // 3) Extraer los iframes de trembed
  // Están dentro de <div id="options-N" class="video"> con iframe
  $d('iframe').each((i, el) => {
    const src = $d(el).attr('src') || $d(el).attr('data-src');
    if (!src) return;

    // Solo procesar iframes con trembed
    if (!src.includes('trembed=')) return;

    // Extraer índice trembed
    const match = src.match(/trembed=(\d+)/);
    if (!match) return;

    const langIndex = match[1];
    const detectedLang = LANG_MAP[langIndex] || lang || 'latino';

    // Normalizar URL
    let embedUrl = src;
    if (embedUrl.startsWith('//')) embedUrl = 'https:' + embedUrl;
    if (embedUrl.startsWith('/')) embedUrl = BASE + embedUrl;
    if (!embedUrl.startsWith('http')) return;

    // Nombre del servidor (opción 1, 2, 3)
    const serverName = `opcion${langIndex}`;

    if (!found[detectedLang]) found[detectedLang] = {};
    if (!found[detectedLang][serverName]) {
      found[detectedLang][serverName] = embedUrl;
      console.log(`[pelispediais] ✅ ${detectedLang}/${serverName}: ${embedUrl}`);
    }
  });

  const total = Object.values(found).reduce((a, s) => a + Object.keys(s).length, 0);
  console.log(`[pelispediais] Total: ${total}`);
  return found;
}

module.exports = {
  name: 'pelispediais',
  scrapePelispediaIS,
  search: async (title, year, tmdbId, type, lang) => scrapePelispediaIS(title, year, tmdbId, type, lang),
};

console.log('[pelispediais] Provider cargado');
