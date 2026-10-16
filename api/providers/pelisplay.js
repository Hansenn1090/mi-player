// api/providers/pelisplay.js
'use strict';

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

function detectServerName(url) {
  const u = (url || '').toLowerCase();
  if (/nupload\.my\/watch/i.test(u)) return 'Nupload';
  if (/nupload\.my\/iframe/i.test(u)) {
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

function extractInnerUrl(url) {
  const m = url.match(/nupload\.my\/iframe\/?\?url=([^&]+)/i);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch (_) {
    return null;
  }
}

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
// FIX 1: timeout global por intento + solo 1 búsqueda efectiva
// ══════════════════════════════════════════════════════════════════
async function findDetailUrl(title, year, type) {
  const isSeries = isSeriesType(type);
  const titleWords = normalize(title).split(' ').filter(w => w.length > 2);
  const yearStr = String(year || '');

  const pathMatchers = isSeries
    ? [/\/serie\//, /\/series\//, /\/tv\//]
    : [/\/pelicula\//, /\/peliculas\//, /\/movie\//];

  // ← FIX: probar primero la URL que SÍ funciona en este sitio
  const searchUrls = [
    `${BASE}/busqueda?q=${encodeURIComponent(title)}`,   // funciona
    `${BASE}/buscar?q=${encodeURIComponent(title)}`,     // también puede funcionar
  ];

  for (const searchUrl of searchUrls) {
    try {
      console.log(`[pelisplay] Search: ${searchUrl}`);
      // ← FIX: timeout reducido a 5s para que si falla sea rápido
      const { data: searchHtml } = await axios.get(searchUrl, {
        timeout: 5000,
        headers: getHeaders(),
        maxContentLength: 5 * 1024 * 1024,   // 5MB máximo
        validateStatus: s => s >= 200 && s < 400,
      });

      if (!searchHtml || searchHtml.length < 500) continue;

      const $ = cheerio.load(searchHtml);
      const candidates = [];

      $('a').each((i, el) => {
        const href = $(el).attr('href') || '';
        if (/\/category\/|\/tag\/|\/actor\/|\/director\/|\/genero|\/busqueda|\/search/.test(href)) return;

        const matchesType = pathMatchers.some(re => re.test(href));
        if (!matchesType) return;

        const text = ($(el).text() + ' ' + ($(el).find('h1,h2,h3,.Title,.title,.item-detail').text() || '')).trim();
        if (text.length < 3) return;

        candidates.push({ href, text });
      });

      if (candidates.length === 0) continue;

      console.log(`[pelisplay] Candidatos (${searchUrl}): ${candidates.length}`);

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
        console.log(`[pelisplay] Match (${bestScore}pts): ${best.text.slice(0, 60)} → ${fullUrl}`);
        return fullUrl;
      }

      // Fallback: primera palabra
      if (candidates.length > 0 && titleWords.length > 0) {
        for (const c of candidates) {
          if (normalize(c.text).includes(titleWords[0])) {
            const fullUrl = c.href.startsWith('http') ? c.href : BASE + c.href;
            console.log(`[pelisplay] Fallback: ${fullUrl}`);
            return fullUrl;
          }
        }
      }
    } catch (e) {
      console.warn(`[pelisplay] Error en ${searchUrl}:`, e.message);
    }
  }

  return null;
}

// ══════════════════════════════════════════════════════════════════
// FIX 2: reduce timeout detalle, añade Referer autorreferente
// ══════════════════════════════════════════════════════════════════
async function scrapePelisplay(title, year, tmdbId, type = 'movie', lang = 'latino') {
  const found = {};
  if (!title) return found;

  const isSeries = isSeriesType(type);
  console.log(`[pelisplay] Buscando: "${title}" (${year}) [${isSeries ? 'serie' : 'película'}]`);

  const detailUrl = await findDetailUrl(title, year, type);

  if (!detailUrl) {
    console.log('[pelisplay] No encontró detalle');
    return found;
  }
  console.log('[pelisplay] Detalle:', detailUrl);

  let detailHtml = '';
  try {
    // ← FIX: timeout más corto (6s) para no agotar el presupuesto del registry
    const { data } = await axios.get(detailUrl, {
      timeout: 6000,
      headers: getHeaders({ Referer: detailUrl }),
      maxContentLength: 8 * 1024 * 1024,   // 8MB máximo
      validateStatus: s => s >= 200 && s < 400,
    });
    detailHtml = data;
  } catch (e) {
    console.warn('[pelisplay] Error detalle:', e.message);
    return found;
  }

  const $d = cheerio.load(detailHtml);

  // Recorrer los tabs de idioma
  $d('li.tab-video-item').each((i, tabEl) => {
    const tabText = $d(tabEl).find('.tab-item-name').text().toLowerCase();
    let detectedLang = 'latino';
    if (/castellano|español|espanol/.test(tabText)) detectedLang = 'castellano';
    else if (/subtitulado|subtitle/.test(tabText)) detectedLang = 'subtitulado';
    else if (/latino/.test(tabText)) detectedLang = 'latino';

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

      const innerUrl = extractInnerUrl(decoded);
      const finalUrl = innerUrl || decoded;

      const hostName = detectServerName(finalUrl);
      const key = `${hostName.toLowerCase()}_${j + 1}`;

      if (!found[detectedLang]) found[detectedLang] = {};
      if (!found[detectedLang][key]) {
        // ← FIX: formato objeto consistente con el resto de providers
        found[detectedLang][key] = {
          url: finalUrl,
          referer: detailUrl,
          server: hostName,
        };
        console.log(`[pelisplay] ✅ ${detectedLang}/${key}: ${finalUrl.slice(0, 90)}`);
      }
    });
  });

  // Fallback: buscar base64 en todo el HTML
  if (Object.keys(found).length === 0) {
    const b64Regex = /data-server="([A-Za-z0-9+/=]{20,})"/g;
    let m;
    while ((m = b64Regex.exec(detailHtml)) !== null) {
      try {
        const decoded = Buffer.from(m[1], 'base64').toString('utf-8');
        if (!decoded.startsWith('http')) continue;

        const innerUrl = extractInnerUrl(decoded);
        const finalUrl = innerUrl || decoded;
        const hostName = detectServerName(finalUrl);

        if (!found[lang]) found[lang] = {};
        const key = `${hostName.toLowerCase()}_fallback`;
        if (!found[lang][key]) {
          found[lang][key] = {
            url: finalUrl,
            referer: detailUrl,
            server: hostName,
          };
          console.log(`[pelisplay] ✅ ${lang}/${key} (fallback): ${finalUrl.slice(0, 90)}`);
        }
      } catch (e) { /* skip */ }
    }
  }

  const total = Object.values(found).reduce((a, s) => a + Object.keys(s).length, 0);
  console.log(`[pelisplay] Total: ${total}`);
  return found;
}

module.exports = {
  name: 'pelisplay',
  scrapePelisplay,
  search: async (title, year, tmdbId, type, lang) =>
    scrapePelisplay(title, year, tmdbId, type, lang),
};
