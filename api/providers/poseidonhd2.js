// api/providers/poseidonhd2.js
const axios = require('axios');
const cheerio = require('cheerio');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const BASE = 'https://poseidonhd2.co';

// ══════════════════════════════════════════════════════════════════════════
// Headers navegador real
// ══════════════════════════════════════════════════════════════════════════
function getHeaders(extra = {}) {
  return {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
    'Sec-Ch-Ua': '"Chromium";v="131", "Not_A Brand";v="24"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Upgrade-Insecure-Requests': '1',
    ...extra,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// Detección EXTENDIDA de hosts (misma que pelispedia)
// ══════════════════════════════════════════════════════════════════════════
function detectServerName(url) {
  const u = (url || '').toLowerCase();
  if (/voe\.sx|voe\.de|voe\.bar|voe\.net|voe\.to/i.test(u)) return 'VOE';
  if (/vimeos/i.test(u)) return 'Vimeos';
  if (/streamwish|embedwish|hglink|flaswish|wishfast|awish/i.test(u)) return 'StreamWish';
  if (/vidhide|morencius|minochinos|callistanise|vidhidepro|hgcloud/i.test(u)) return 'VidHide';
  if (/filelions|filelion/i.test(u)) return 'FileLions';
  if (/filemoon|moonplayer|byse/i.test(u)) return 'FileMoon';
  if (/doodstream|dood\.la|dood\.sh|d000d/i.test(u)) return 'DoodStream';
  if (/fembed|fembed-hd/i.test(u)) return 'Fembed';
  if (/xpass/i.test(u)) return 'Xpass';
  if (/uqload/i.test(u)) return 'Uqload';
  if (/streamtape|stape/i.test(u)) return 'StreamTape';
  if (/mixdrop|mxdrop/i.test(u)) return 'MixDrop';
  if (/ok\.ru|okru/i.test(u)) return 'OkRu';
  if (/vidmoly/i.test(u)) return 'Vidmoly';
  if (/powvideo/i.test(u)) return 'Powvideo';
  if (/streamplay/i.test(u)) return 'Streamplay';
  if (/streamhide|guccihide/i.test(u)) return 'StreamHide';
  if (/netu|waaw|hqq/i.test(u)) return 'Netu';
  if (/fastream/i.test(u)) return 'Fastream';
  if (/mp4upload/i.test(u)) return 'Mp4Upload';
  if (/streamsb|sbfull/i.test(u)) return 'StreamSB';
  if (/streamlare/i.test(u)) return 'StreamLare';
  if (/vinovo/i.test(u)) return 'Vinovo';
  if (/embedgram/i.test(u)) return 'EmbedGram';
  if (/vidspeed/i.test(u)) return 'VidSpeed';
  if (/nupload\.io/i.test(u)) return 'Nupload';
  if (/player\.vimeo\.com/i.test(u)) return 'Vimeo';
  return 'Servidor';
}

// ══════════════════════════════════════════════════════════════════════════
// Regex URLs sueltas
// ══════════════════════════════════════════════════════════════════════════
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
  /https?:\/\/(?:www\.)?streamsb\.[^\s"'<>)]+/gi,
  /https?:\/\/(?:www\.)?powvideo\.[^\s"'<>)]+/gi,
  /https?:\/\/(?:www\.)?streamplay\.[^\s"'<>)]+/gi,
];

// ══════════════════════════════════════════════════════════════════════════
// Agregar servidor (con normalización)
// ══════════════════════════════════════════════════════════════════════════
function addServer(found, lang, rawUrl, baseUrl) {
  if (!rawUrl) return;
  let u = String(rawUrl).trim();
  if (u.startsWith('//')) u = 'https:' + u;
  if (u.startsWith('/')) u = baseUrl + u;
  if (!u.startsWith('http')) return;
  if (/doubleclick|google|youtube|histats|yandex|whatsapp|facebook|cloudflare|googletagmanager|disqus|gravatar/i.test(u)) return;
  if (/\.(jpg|jpeg|png|gif|webp|svg|css|js)(\?|$)/i.test(u)) return;

  const name = detectServerName(u);
  if (name === 'Servidor') return;

  const targetLang = (lang === 'latino' || lang === 'español' || lang === 'castellano' || lang === 'esp') ? 'latino' : 'subtitulado';
  if (!found[targetLang]) found[targetLang] = {};
  if (!found[targetLang][name]) {
    found[targetLang][name] = u;
    console.log(`[poseidonhd2] ✅ ${targetLang}/${name}: ${u.slice(0, 80)}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// Función principal
// ══════════════════════════════════════════════════════════════════════════
async function scrapePoseidonhd2(title, year, tmdbId, type) {
  const found = {};
  if (!title) return found;
  console.log('[poseidonhd2] Buscando:', title, year || '');

  const searchUrl = `${BASE}/?s=${encodeURIComponent(title)}`;
  let detailUrl = null;

  try {
    const { data: searchHtml } = await axios.get(searchUrl, {
      timeout: 10000,
      headers: getHeaders({ 'Referer': BASE + '/' }),
      validateStatus: s => s >= 200 && s < 400,
      maxRedirects: 5,
    });

    const $ = cheerio.load(searchHtml);

    const normalize = s => (s || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

    const titleWords = normalize(title).split(' ').filter(w => w.length > 2);
    const yearStr = String(year || '');

    $('a').each((i, el) => {
      if (detailUrl) return;
      const href = $(el).attr('href') || '';
      if (!href.includes('/pelicula/') && !href.includes('/serie/')) return;
      const text = normalize($(el).text());
      const matches = titleWords.filter(w => text.includes(w));
      if (matches.length >= Math.min(2, titleWords.length)) {
        if (!yearStr || href.includes(yearStr) || $(el).text().includes(yearStr) || !yearStr) {
          detailUrl = href.startsWith('http') ? href : BASE + href;
        }
      }
    });

    if (!detailUrl) {
      console.log('[poseidonhd2] No encontró detalle');
      return found;
    }

    console.log('[poseidonhd2] Detalle:', detailUrl);

    const { data: detailHtml } = await axios.get(detailUrl, {
      timeout: 12000,
      headers: getHeaders({ 'Referer': searchUrl }),
      validateStatus: s => s >= 200 && s < 400,
    });

    const $d = cheerio.load(detailHtml);

    // ─── Método 1: iframes directos ────────────────────────────
    $d('iframe').each((i, el) => {
      const src = $d(el).attr('src') || $d(el).attr('data-src') || $d(el).attr('data-litespeed-src');
      if (!src) return;
      addServer(found, 'latino', src, BASE);
    });

    // ─── Método 2: data-pp-embed (por si lo usan) ──────────────
    $d('[data-pp-embed]').each((i, el) => {
      const embedRaw = $d(el).attr('data-pp-embed');
      const lang = ($d(el).attr('data-pp-lang') || 'latino').toLowerCase();
      if (!embedRaw) return;
      const decoded = embedRaw
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&');
      const srcMatch = decoded.match(/src=["']([^"']+)["']/);
      if (!srcMatch) return;
      addServer(found, lang, srcMatch[1], BASE);
    });

    // ─── Método 3: regex sobre HTML completo (para scripts) ────
    for (const re of URL_PATTERNS) {
      const matches = detailHtml.match(re);
      if (matches) matches.forEach(u => addServer(found, 'latino', u, BASE));
    }

    const total = Object.values(found).reduce((a, s) => a + Object.keys(s).length, 0);
    console.log(`[poseidonhd2] Total: ${total}`);
    return found;
  } catch (e) {
    console.warn('[poseidonhd2] Error:', e.message);
    return found;
  }
}

module.exports = {
  scrapePoseidonhd2,
  search: async (title, year, tmdbId, type) => scrapePoseidonhd2(title, year, tmdbId, type)
};

console.log('[poseidonhd2] Provider cargado');
