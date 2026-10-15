// api/providers/cuevana3.js
/**
 * Cuevana3 — WordPress con reproductor multi-idioma
 *
 * Extrae TODOS los iframes del contenedor `.TPlayerTb`
 * Cada iframe tiene un ID que indica idioma y host:
 *   OptE11, OptE12, OptE13, OptE14 → Latino (Dood/VOE/VidHide/StreamWish)
 *   OptE21, OptE22, OptE23, OptE24 → Subtitulado
 *   OptE31, OptE32, OptE33, OptE34 → Español (castellano)
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

// Detección de nombre de servidor por URL
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

// Mapeo de ID → prioridad de host (para reordenar)
const HOST_ORDER = ['doodstream', 'voe', 'vidhide', 'streamwish'];

async function scrapeCuevana3(title, year, tmdbId, type = 'movie') {
  const found = {};
  if (!title) return found;
  console.log('[cuevana3] Buscando:', title, year || '');

  let detailUrl = null;

  // Si tenemos TMDB ID, intentar construir la URL directamente
  // (Cuevana3 usa /{tmdb_id}/{slug})
  if (tmdbId) {
    const cleanId = String(tmdbId).replace(/\D/g, '');
    const slug = title.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '-').trim();

    const possibleUrls = [
      `${BASE}/${cleanId}/${slug}`,
      `${BASE}/${cleanId}/${slug}/`,
    ];

    for (const u of possibleUrls) {
      try {
        const r = await axios.head(u, { headers: getHeaders(), timeout: 5000, validateStatus: s => s < 400, maxRedirects: 5 });
        if (r.status < 400) { detailUrl = u; break; }
      } catch (_) {}
    }
  }

  // Fallback: buscar por título
  if (!detailUrl) {
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
        // Cuevana3 usa /{id}/{slug}
        if (!/^\/\d+\//.test(href)) return;
        const text = normalize($(el).text());
        const matches = titleWords.filter(w => text.includes(w));
        if (matches.length >= Math.min(2, titleWords.length)) {
          if (!yearStr || href.includes(yearStr) || $(el).text().includes(yearStr) || !yearStr) {
            detailUrl = href.startsWith('http') ? href : BASE + href;
          }
        }
      });
    } catch (e) {
      console.warn('[cuevana3] Error búsqueda:', e.message);
      return found;
    }
  }

  if (!detailUrl) {
    console.log('[cuevana3] No encontró detalle');
    return found;
  }
  console.log('[cuevana3] Detalle:', detailUrl);

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

  // Extraer TODOS los iframes del contenedor .TPlayerTb
  $d('.TPlayerTb iframe, iframe.no-you').each((i, el) => {
    const src = $d(el).attr('data-src') || $d(el).attr('src');
    if (!src) return;
    if (!src.startsWith('http')) return;

    // Extraer el ID del contenedor padre (OptE11, OptE12, etc.)
    const parentId = $d(el).parent().attr('id') || $d(el).closest('.TPlayerTb').attr('id') || '';
    const idMatch = parentId.match(/OptE(\d)(\d)/);
    let lang = 'latino';
    let hostIndex = 0;

    if (idMatch) {
      const langDigit = idMatch[1];
      hostIndex = parseInt(idMatch[2], 10);
      lang = ID_LANG[langDigit] || 'latino';
    }

    // Nombre del host
    const hostName = detectServerName(src);
    if (hostName === 'Servidor') return; // Ignorar hosts desconocidos

    // Clave única: host_lang_idx para evitar colisiones entre idiomas
    const key = `${hostName.toLowerCase()}`;

    if (!found[lang]) found[lang] = {};
    // Si ya existe ese host en ese idioma, agregar índice
    let finalKey = key;
    if (found[lang][finalKey]) {
      finalKey = `${key}_${hostIndex}`;
    }
    if (!found[lang][finalKey]) {
      found[lang][finalKey] = src;
      console.log(`[cuevana3] ✅ ${lang}/${finalKey}: ${src.slice(0, 80)}`);
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
