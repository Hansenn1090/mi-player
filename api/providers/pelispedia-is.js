// api/providers/pelispedia-is.js
/**
 * PelisPedia.is — Sitio WordPress con reproductor multi-opción
 *
 * Cada película tiene 3 iframes:
 *   OPCIÓN 1 → trembed=0 → LATINO
 *   OPCIÓN 2 → trembed=1 → CASTELLANO
 *   OPCIÓN 3 → trembed=2 → VOSE (subtitulado)
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

async function scrapePelispediaIS(title, year, tmdbId, type = 'movie') {
  const found = {};
  if (!title) return found;
  console.log('[pelispedia.is] Buscando:', title, year || '');

  // ─── 1) Buscar por título ──────────────────────────────────
  let detailUrl = null;

  try {
    const searchUrl = `${BASE}/?s=${encodeURIComponent(title)}`;
    const { data: searchHtml } = await axios.get(searchUrl, {
      timeout: 10000,
      headers: getHeaders(),
      validateStatus: s => s >= 200 && s < 400,
    });

    const $ = cheerio.load(searchHtml);
    const normalize = s => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
    const titleWords = normalize(title).split(' ').filter(w => w.length > 2);
    const yearStr = String(year || '');

    $('a').each((i, el) => {
      if (detailUrl) return;
      const href = $(el).attr('href') || '';
      if (!href.includes('/pelicula/')) return;
      const text = normalize($(el).text());
      const matches = titleWords.filter(w => text.includes(w));
      if (matches.length >= Math.min(2, titleWords.length)) {
        if (!yearStr || href.includes(yearStr) || $(el).text().includes(yearStr) || !yearStr) {
          detailUrl = href.startsWith('http') ? href : BASE + href;
        }
      }
    });
  } catch (e) {
    console.warn('[pelispedia.is] Error búsqueda:', e.message);
    return found;
  }

  if (!detailUrl) {
    console.log('[pelispedia.is] No encontró detalle');
    return found;
  }
  console.log('[pelispedia.is] Detalle:', detailUrl);

  // ─── 2) Cargar página de detalle ───────────────────────────
  let detailHtml = '';
  try {
    const { data } = await axios.get(detailUrl, {
      timeout: 12000,
      headers: getHeaders(),
      validateStatus: s => s >= 200 && s < 400,
    });
    detailHtml = data;
  } catch (e) {
    console.warn('[pelispedia.is] Error detalle:', e.message);
    return found;
  }

  const $d = cheerio.load(detailHtml);

  // ─── 3) Extraer los iframes de trembed ─────────────────────
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
    const lang = LANG_MAP[langIndex] || 'latino';

    // Normalizar URL
    let embedUrl = src;
    if (embedUrl.startsWith('//')) embedUrl = 'https:' + embedUrl;
    if (embedUrl.startsWith('/')) embedUrl = BASE + embedUrl;
    if (!embedUrl.startsWith('http')) return;

    // Nombre del servidor (opción 1, 2, 3)
    const serverName = `opcion${langIndex}`;

    if (!found[lang]) found[lang] = {};
    if (!found[lang][serverName]) {
      found[lang][serverName] = embedUrl;
      console.log(`[pelispedia.is] ✅ ${lang}/${serverName}: ${embedUrl}`);
    }
  });

  const total = Object.values(found).reduce((a, s) => a + Object.keys(s).length, 0);
  console.log(`[pelispedia.is] Total: ${total}`);
  return found;
}

module.exports = {
  scrapePelispediaIS,
  search: async (title, year, tmdbId, type) => scrapePelispediaIS(title, year, tmdbId, type),
};

console.log('[pelispedia.is] Provider cargado');
