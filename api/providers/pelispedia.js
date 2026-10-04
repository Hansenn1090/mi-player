// ══════════════════════════════════════════════════════════════════════════
// providers/pelispedia.js — Scraper de Pelispedia.casa
// ══════════════════════════════════════════════════════════════════════════

const axios = require('axios');
const cheerio = require('cheerio');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const BASE = 'https://pelispedia.casa';

async function scrapePelispedia(title, year, type = 'movie') {
  const found = {};
  if (!title) return found;

  console.log('[pelispedia] Buscando:', title, year || '');

  // ═════════════════════════════════════════════════════════════════════
  // PASO 1 — Buscar la película en el sitio
  // ═════════════════════════════════════════════════════════════════════
  const searchUrl = `${BASE}/?s=${encodeURIComponent(title)}`;
  let detailUrl = null;

  try {
    const { data: searchHtml } = await axios.get(searchUrl, {
      timeout: 12000,
      headers: {
        'User-Agent': UA,
        'Referer': BASE + '/',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      },
      validateStatus: s => s >= 200 && s < 400,
      maxRedirects: 5,
    });

    const $ = cheerio.load(searchHtml);
    const candidates = [];

    const linkSel = type === 'tv'
      ? 'a[href*="/series/"]'
      : 'a[href*="/peliculas/"]';

    $(linkSel).each((i, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      const text = ($(el).text() + ' ' + ($(el).find('h2, h3, .pp-card__title, .entry-title').text() || '')).toLowerCase();
      candidates.push({ href, text });
    });

    const normalize = s => (s || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ').trim();

    const titleNorm = normalize(title);
    const titleWords = titleNorm.split(' ').filter(w => w.length > 2);
    const yearStr = String(year || '');

    for (const c of candidates) {
      const candNorm = normalize(c.text);
      const matches = titleWords.filter(w => candNorm.includes(w));

      if (matches.length >= Math.min(2, titleWords.length)) {
        if (!yearStr || c.text.includes(yearStr) || c.href.includes(yearStr)) {
          detailUrl = c.href;
          break;
        }
      }
    }

    if (!detailUrl && candidates.length > 0 && titleWords.length > 0) {
      for (const c of candidates) {
        if (normalize(c.text).includes(titleWords[0])) {
          detailUrl = c.href;
          break;
        }
      }
    }

    if (detailUrl && detailUrl.startsWith('/')) {
      detailUrl = BASE + detailUrl;
    }

    if (!detailUrl) {
      console.log('[pelispedia] No se encontró página de detalle');
      return found;
    }

    console.log('[pelispedia] Detalle:', detailUrl);

  } catch (e) {
    console.warn('[pelispedia] Error buscando:', e.message);
    return found;
  }

  // ═════════════════════════════════════════════════════════════════════
  // PASO 2 — Cargar la página de detalle
  // ═════════════════════════════════════════════════════════════════════
  let detailHtml = '';
  try {
    const { data } = await axios.get(detailUrl, {
      timeout: 12000,
      headers: {
        'User-Agent': UA,
        'Referer': BASE + '/',
        'Accept-Language': 'es-ES,es;q=0.9',
      },
      validateStatus: s => s >= 200 && s < 400,
    });
    detailHtml = data;
  } catch (e) {
    console.warn('[pelispedia] Error en detalle:', e.message);
    return found;
  }

  const $d = cheerio.load(detailHtml);

  // ═════════════════════════════════════════════════════════════════════
  // PASO 3 — Extraer TODOS los servidores de [data-pp-embed]
  // ═════════════════════════════════════════════════════════════════════
  $d('[data-pp-embed]').each((i, el) => {
    const embedRaw = $d(el).attr('data-pp-embed');
    const lang = ($d(el).attr('data-pp-lang') || 'latino').toLowerCase();

    if (!embedRaw) return;

    const decoded = embedRaw
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&amp;/g, '&');

    const srcMatch = decoded.match(/src=["']([^"']+)["']/);
    if (!srcMatch) return;

    let embedUrl = srcMatch[1];

    if (embedUrl.startsWith('//')) embedUrl = 'https:' + embedUrl;
    if (embedUrl.startsWith('/')) embedUrl = BASE + embedUrl;

    if (!embedUrl.startsWith('http')) return;

    if (/doubleclick|googlesyndication|google-analytics|youtube/i.test(embedUrl)) return;

    const name = detectServerName(embedUrl);

    if (!found[lang]) found[lang] = {};
    if (!found[lang][name]) {
      found[lang][name] = embedUrl;
      console.log(`[pelispedia] ✅ ${lang}/${name}: ${embedUrl.slice(0, 80)}`);
    }
  });

  // ═════════════════════════════════════════════════════════════════════
  // PASO 4 — Fallback: buscar iframes directos
  // ═════════════════════════════════════════════════════════════════════
  if (Object.keys(found).length === 0) {
    console.log('[pelispedia] Buscando iframes directos...');
    $d('.pp-player__frame iframe, .pp-player iframe, iframe[src*="embed"]').each((i, el) => {
      let src = $d(el).attr('src');
      if (!src) return;
      if (src.startsWith('//')) src = 'https:' + src;
      if (src.startsWith('/')) src = BASE + src;
      if (!src.startsWith('http')) return;
      if (/doubleclick|google|youtube/i.test(src)) return;

      const name = detectServerName(src);
      if (!found.latino) found.latino = {};
      if (!found.latino[name]) {
        found.latino[name] = src;
        console.log(`[pelispedia] ✅ iframe ${name}: ${src.slice(0, 80)}`);
      }
    });
  }

  const total = Object.values(found).reduce((a, s) => a + Object.keys(s).length, 0);
  console.log('[pelispedia] Total:', total, 'servidores');
  return found;
}

/**
 * Detecta el nombre del servidor por URL
 */
function detectServerName(url) {
  const u = (url || '').toLowerCase();
  if (/voe\.sx|voe\.de|voe\.bar|voe\.net/i.test(u)) return 'VOE';
  if (/vimeos/i.test(u)) return 'Vimeos';
  if (/streamwish|embedwish|hglink|filelions/i.test(u)) return 'StreamWish';
  if (/vidhide|morencius|minochinos/i.test(u)) return 'VidHide';
  if (/filemoon|moonplayer|byse/i.test(u)) return 'FileMoon';
  if (/dood/i.test(u)) return 'DoodStream';
  if (/fembed/i.test(u)) return 'Fembed';
  if (/xpass/i.test(u)) return 'Xpass';
  if (/uqload/i.test(u)) return 'Uqload';
  if (/streamtape/i.test(u)) return 'StreamTape';
  if (/mixdrop/i.test(u)) return 'MixDrop';
  if (/ok\.ru/i.test(u)) return 'OkRu';
  if (/vidmoly/i.test(u)) return 'Vidmoly';
  if (/vidspeed/i.test(u)) return 'VidSpeed';
  if (/mp4upload/i.test(u)) return 'Mp4Upload';
  if (/netu|waaw/i.test(u)) return 'Netu';
  return 'Servidor';
}

// ══════════════════════════════════════════════════════════════════════════
// EXPORTS — Con alias "search" para que el registry lo encuentre
// ══════════════════════════════════════════════════════════════════════════
module.exports = {
  scrapePelispedia,
  search: async (title, year, tmdbId, type) => scrapePelispedia(title, year, type || 'movie')
};

console.log('[pelispedia] Provider cargado');
