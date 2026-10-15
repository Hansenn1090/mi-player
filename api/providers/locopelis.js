// api/providers/locopelis.js
const axios = require('axios');
const cheerio = require('cheerio');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const BASE = 'https://www.locopelis.com';

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
  if (/streamwish|embedwish|hglink|flaswish/i.test(u)) return 'StreamWish';
  if (/vidhide|morencius|minochinos|callistanise|filelions/i.test(u)) return 'FileLions';
  if (/filemoon|moonplayer|byse/i.test(u)) return 'FileMoon';
  if (/doodstream|dood\.la|dood\.sh/i.test(u)) return 'DoodStream';
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

const URL_PATTERNS = [
  /https?:\/\/(?:www\.)?vimeos\.[^\s"'<>)]+/gi,
  /https?:\/\/(?:www\.)?(?:streamwish|embedwish|hglink|flaswish)\.[^\s"'<>)]+/gi,
  /https?:\/\/(?:www\.)?(?:vidhide|filelions|minochinos|callistanise)\.[^\s"'<>)]+/gi,
  /https?:\/\/(?:www\.)?(?:filemoon|moonplayer)\.[^\s"'<>)]+/gi,
  /https?:\/\/(?:www\.)?(?:doodstream|dood\.[a-z]+)\/[^\s"'<>)]+/gi,
  /https?:\/\/(?:www\.)?(?:mixdrop|mxdrop)\.[^\s"'<>)]+/gi,
  /https?:\/\/(?:www\.)?voe\.[a-z]+[^\s"'<>)]*/gi,
  /https?:\/\/(?:www\.)?vidmoly\.[^\s"'<>)]+/gi,
];

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
    console.log(`[locopelis] ✅ ${targetLang}/${name}: ${u.slice(0, 80)}`);
  }
}

async function scrapeLocoPelis(title, year, tmdbId, type = 'movie') {
  const found = {};
  if (!title) return found;
  console.log('[locopelis] Buscando:', title, year || '');

  let detailUrl = null;

  // Búsqueda por título
  try {
    const searchUrl = `${BASE}/?s=${encodeURIComponent(title)}`;
    const { data: searchHtml } = await axios.get(searchUrl, {
      timeout: 10000,
      headers: getHeaders({ 'Referer': BASE + '/' }),
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
    console.warn('[locopelis] Error búsqueda:', e.message);
  }

  if (!detailUrl) {
    console.log('[locopelis] No encontró detalle');
    return found;
  }
  console.log('[locopelis] Detalle:', detailUrl);

  let detailHtml = '';
  try {
    const { data } = await axios.get(detailUrl, {
      timeout: 12000,
      headers: getHeaders({ 'Referer': BASE + '/' }),
      validateStatus: s => s >= 200 && s < 400,
    });
    detailHtml = data;
  } catch (e) {
    console.warn('[locopelis] Error detalle:', e.message);
    return found;
  }

  const $d = cheerio.load(detailHtml);

  // Método 1: iframes
  $d('iframe').each((i, el) => {
    const src = $d(el).attr('src') || $d(el).attr('data-src') || $d(el).attr('data-litespeed-src');
    if (!src) return;
    addServer(found, 'latino', src, BASE);
  });

  // Método 2: data-pp-embed
  $d('[data-pp-embed]').each((i, el) => {
    const embedRaw = $d(el).attr('data-pp-embed');
    const lang = ($d(el).attr('data-pp-lang') || 'latino').toLowerCase();
    if (!embedRaw) return;
    const decoded = embedRaw.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&');
    const m = decoded.match(/src=["']([^"']+)["']/);
    if (!m) return;
    addServer(found, lang, m[1], BASE);
  });

  // Método 3: regex en HTML completo
  for (const re of URL_PATTERNS) {
    const matches = detailHtml.match(re);
    if (matches) matches.forEach(u => addServer(found, 'latino', u, BASE));
  }

  const total = Object.values(found).reduce((a, s) => a + Object.keys(s).length, 0);
  console.log(`[locopelis] Total: ${total}`);
  return found;
}

module.exports = {
  scrapeLocoPelis,
  search: async (title, year, tmdbId, type) => scrapeLocoPelis(title, year, tmdbId, type),
};

console.log('[locopelis] Provider cargado');
