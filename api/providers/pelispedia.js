// api/providers/pelispledia.js
const axios = require('axios');
const cheerio = require('cheerio');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const BASE = 'https://pelispedia.casa';

// ══════════════════════════════════════════════════════════════════════════
// Headers de navegador real
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
// Detección extendida de hosts
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
  if (/streamhide|guccihide|streamhide\.to|streamhide\.com/i.test(u)) return 'StreamHide';
  if (/netu|waaw|hqq/i.test(u)) return 'Netu';
  if (/fastream/i.test(u)) return 'Fastream';
  if (/mp4upload/i.test(u)) return 'Mp4Upload';
  if (/streamsb|sbfull/i.test(u)) return 'StreamSB';
  if (/streamlare/i.test(u)) return 'StreamLare';
  if (/vinovo|vinovo\.to|vinovo\.com/i.test(u)) return 'Vinovo';
  if (/embedgram|embedgram\.com/i.test(u)) return 'EmbedGram';
  if (/myspace/i.test(u)) return 'MySpace';
  if (/vidspeed|vidspeed\.net/i.test(u)) return 'VidSpeed';
  if (/nupload\.io/i.test(u)) return 'Nupload';
  if (/bysekoze|bysesukior/i.test(u)) return 'Bysekoze';
  if (/player\.vimeo\.com/i.test(u)) return 'Vimeo';
  return 'Servidor';
}

// ══════════════════════════════════════════════════════════════════════════
// Regex para URLs sueltas en el HTML
// ══════════════════════════════════════════════════════════════════════════
const URL_PATTERNS = [
  // Hosts prioritarios
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
  // Hosts genéricos (último recurso)
  /https?:\/\/(?:www\.)?filelion\.[^\s"'<>)]+/gi,
  /https?:\/\/embed\.[^\s"'<>]+\.(?:com|to|net|sx|de)\/[^\s"'<>)]+/gi,
];

// ══════════════════════════════════════════════════════════════════════════
// Extrae servidores de una página de detalle
// ══════════════════════════════════════════════════════════════════════════
function extractServersFromHtml(html, $d, found, baseUrl) {
  // ─── Método 1: data-pp-embed ───────────────────────────────
  $d('[data-pp-embed]').each((i, el) => {
    const embedRaw = $d(el).attr('data-pp-embed');
    const lang = ($d(el).attr('data-pp-lang') || 'latino').toLowerCase();
    if (!embedRaw) return;
    const decoded = embedRaw
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&');
    const srcMatch = decoded.match(/src=["']([^"']+)["']/);
    if (!srcMatch) return;
    addServer(found, lang, srcMatch[1], baseUrl);
  });

  // ─── Método 2: iframes directos ────────────────────────────
  $d('iframe').each((i, el) => {
    let src = $d(el).attr('src') || $d(el).attr('data-src') || $d(el).attr('data-litespeed-src');
    if (!src) return;
    addServer(found, 'latino', src, baseUrl);
  });

  // ─── Método 3: regex sobre HTML completo (busca en scripts) ─
  for (const re of URL_PATTERNS) {
    const matches = html.match(re);
    if (matches) {
      matches.forEach(u => addServer(found, 'latino', u, baseUrl));
    }
  }
}

function addServer(found, lang, rawUrl, baseUrl) {
  if (!rawUrl) return;
  let u = String(rawUrl).trim();
  if (u.startsWith('//')) u = 'https:' + u;
  if (u.startsWith('/')) u = baseUrl + u;
  if (!u.startsWith('http')) return;
  // Ignorar dominios basura
  if (/doubleclick|google|youtube|histats|yandex|whatsapp|facebook|cloudflare|googletagmanager|disqus|gravatar/i.test(u)) return;
  // Ignorar URLs que no son de embed
  if (/\.(jpg|jpeg|png|gif|webp|svg|css|js)(\?|$)/i.test(u)) return;

  const name = detectServerName(u);
  if (name === 'Servidor') return;

  const targetLang = (lang === 'latino' || lang === 'español' || lang === 'castellano' || lang === 'esp') ? 'latino' : 'subtitulado';
  if (!found[targetLang]) found[targetLang] = {};
  if (!found[targetLang][name]) {
    found[targetLang][name] = u;
    console.log(`[pelispedia] ✅ ${targetLang}/${name}: ${u.slice(0, 80)}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// Función principal
// ══════════════════════════════════════════════════════════════════════════
async function scrapePelispedia(title, year, type = 'movie') {
  const found = {};
  if (!title) return found;
  console.log('[pelispedia] Buscando:', title, year || '');

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
    const candidates = [];
    const linkSel = type === 'tv'
      ? 'a[href*="/series/"], a[href*="/serie/"]'
      : 'a[href*="/peliculas/"], a[href*="/pelicula/"]';

    $(linkSel).each((i, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      const text = ($(el).text() + ' ' + ($(el).find('h2, h3, .pp-card__title, .entry-title').text() || '')).toLowerCase();
      candidates.push({ href, text });
    });

    const normalize = s => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
    const titleNorm = normalize(title);
    const titleWords = titleNorm.split(' ').filter(w => w.length > 2);
    const yearStr = String(year || '');

    for (const c of candidates) {
      const candNorm = normalize(c.text);
      const matches = titleWords.filter(w => candNorm.includes(w));
      if (matches.length >= Math.min(2, titleWords.length)) {
        if (!yearStr || c.text.includes(yearStr) || c.href.includes(yearStr)) {
          detailUrl = c.href; break;
        }
      }
    }
    if (!detailUrl && candidates.length > 0 && titleWords.length > 0) {
      for (const c of candidates) {
        if (normalize(c.text).includes(titleWords[0])) { detailUrl = c.href; break; }
      }
    }
    if (detailUrl && detailUrl.startsWith('/')) detailUrl = BASE + detailUrl;
    if (!detailUrl) { console.log('[pelispedia] No encontrada'); return found; }
    console.log('[pelispedia] Detalle:', detailUrl);
  } catch (e) {
    console.warn('[pelispedia] Error búsqueda:', e.message);
    return found;
  }

  let detailHtml = '';
  try {
    const { data } = await axios.get(detailUrl, {
      timeout: 12000,
      headers: getHeaders({ 'Referer': searchUrl }),
      validateStatus: s => s >= 200 && s < 400,
    });
    detailHtml = data;
  } catch (e) {
    console.warn('[pelispedia] Error detalle:', e.message);
    return found;
  }

  const $d = cheerio.load(detailHtml);
  extractServersFromHtml(detailHtml, $d, found, BASE);

  const total = Object.values(found).reduce((a, s) => a + Object.keys(s).length, 0);
  console.log(`[pelispedia] Total: ${total}`);
  return found;
}

module.exports = { scrapePelispedia };
console.log('[pelispedia] Provider cargado');
