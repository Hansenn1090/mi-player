// api/providers/pelisplay.js
/**
 * Pelisplay.mom — Sitio con iframes codificados en base64
 *
 * Cada botón de opción tiene un atributo data-server con base64:
 *   <li data-server="aHR0cHM6Ly9udXBsb2FkLm15L3dhdGNoL...">
 *
 * Al decodificar:
 *   - https://nupload.my/watch/...
 *   - https://nupload.my/iframe/?url=https%3A%2F%2Fvoe.sx%2Fe%2F...
 *
 * Idioma: se detecta por el contenedor padre (Latino/Castellano/Subtitulado)
 */

const axios = require('axios');
const cheerio = require('cheerio');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const BASE = 'https://pelisplay.mom';

function getHeaders(extra = {}) {
  return {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
    'Referer': BASE + '/',
    ...extra,
  };
}

// Detección de host
function detectServerName(url) {
  const u = (url || '').toLowerCase();
  if (/nupload\.my\/watch/i.test(u)) return 'Nupload';
  if (/nupload\.my\/iframe/i.test(u)) {
    // Extraer el url= del query string
    const m = u.match(/url=([^&]+)/);
    if (m) {
      try {
        const innerUrl = decodeURIComponent(m[1]);
        if (/voe\.sx|voe\.de|voe\.bar/i.test(innerUrl)) return 'VOE';
        if (/streamwish/i.test(innerUrl)) return 'StreamWish';
        if (/vidhide/i.test(innerUrl)) return 'VidHide';
        if (/filemoon/i.test(innerUrl)) return 'FileMoon';
        if (/doodstream/i.test(innerUrl)) return 'DoodStream';
      } catch (_) {}
    }
    return 'Nupload_iframe';
  }
  if (/voe\.sx|voe\.de/i.test(u)) return 'VOE';
  if (/vimeos/i.test(u)) return 'Vimeos';
  if (/streamwish|hglink/i.test(u)) return 'StreamWish';
  if (/vidhide|filelions/i.test(u)) return 'VidHide';
  if (/filemoon/i.test(u)) return 'FileMoon';
  if (/doodstream|dood\./i.test(u)) return 'DoodStream';
  if (/mixdrop|mxdrop/i.test(u)) return 'MixDrop';
  if (/ok\.ru|okru/i.test(u)) return 'OkRu';
  if (/vidmoly/i.test(u)) return 'Vidmoly';
  return 'Servidor';
}

// Si es nupload.my/iframe?url=X, extraer X directamente
function extractInnerUrl(url) {
  const m = url.match(/nupload\.my\/iframe\/?\?url=([^&]+)/i);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch (_) {
    return null;
  }
}

async function scrapePelisplay(title, year, tmdbId, type = 'movie') {
  const found = {};
  if (!title) return found;
  console.log('[pelisplay] Buscando:', title, year || '');

  let detailUrl = null;

  // 1) Buscar por título
  try {
    const searchUrl = `${BASE}/busqueda?q=${encodeURIComponent(title)}`;
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
    console.warn('[pelisplay] Error búsqueda:', e.message);
    return found;
  }

  if (!detailUrl) {
    console.log('[pelisplay] No encontró detalle');
    return found;
  }
  console.log('[pelisplay] Detalle:', detailUrl);

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
    console.warn('[pelisplay] Error detalle:', e.message);
    return found;
  }

  const $d = cheerio.load(detailHtml);

  // 3) Recorrer los tabs de idioma y sus opciones
  // Estructura:
  // <li class="tab-video-item">
  //   <div> ... "Latino" ... </div>
  //   <ul>
  //     <li data-server="BASE64">Opción 1</li>
  //     <li data-server="BASE64">Opción 2</li>
  //   </ul>
  // </li>

  $d('li.tab-video-item').each((i, tabEl) => {
    // Detectar idioma por el texto del tab
    const tabText = $d(tabEl).find('.tab-item-name').text().toLowerCase();
    let lang = 'latino';
    if (/castellano|español|espanol/.test(tabText)) lang = 'castellano';
    else if (/subtitulado|subtitle/.test(tabText)) lang = 'subtitulado';
    else if (/latino/.test(tabText)) lang = 'latino';

    // Iterar las opciones dentro de este tab
    $d(tabEl).find('li[data-server]').each((j, optEl) => {
      const b64 = $d(optEl).attr('data-server');
      if (!b64) return;

      let decoded;
      try {
        decoded = Buffer.from(b64, 'base64').toString('utf-8');
      } catch (e) {
        return;
      }

      if (!decoded || !decoded.startsWith('http')) return;

      // Si es nupload.my/iframe?url=X → extraer X (el host real, ej: voe.sx)
      const innerUrl = extractInnerUrl(decoded);
      const finalUrl = innerUrl || decoded;

      const hostName = detectServerName(finalUrl);
      const key = `${hostName.toLowerCase()}_${j + 1}`;

      if (!found[lang]) found[lang] = {};
      if (!found[lang][key]) {
        found[lang][key] = finalUrl;
        console.log(`[pelisplay] ✅ ${lang}/${key}: ${finalUrl.slice(0, 90)}`);
      }
    });
  });

  const total = Object.values(found).reduce((a, s) => a + Object.keys(s).length, 0);
  console.log(`[pelisplay] Total: ${total}`);
  return found;
}

module.exports = {
  scrapePelisplay,
  search: async (title, year, tmdbId, type) => scrapePelisplay(title, year, tmdbId, type),
};

console.log('[pelisplay] Provider cargado');
