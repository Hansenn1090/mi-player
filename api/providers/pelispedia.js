const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const BASE = 'https://pelispedia.casa';

function getHeaders(extra = {}) {
  return {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    'Sec-Ch-Ua': '"Chromium";v="121", "Not A(Brand";v="99"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    ...extra,
  };
}

// Decodifica entities HTML (&lt;iframe src=&quot;...&quot;&gt;)
function decodeHtmlEntities(str) {
  return String(str || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

async function scrapePelispedia(title, year, tmdbId, type) {
  const found = { latino: {}, subtitulado: {} };
  if (!title) return found;

  console.log('[pelispedia] Buscando:', title, year || '');

  try {
    const searchUrl = `${BASE}/?s=${encodeURIComponent(title)}`;
    const { data: searchHtml } = await axios.get(searchUrl, {
      timeout: 15000,
      httpsAgent,
      headers: getHeaders({ 'Referer': BASE + '/' }),
      maxRedirects: 5,
      validateStatus: s => s >= 200 && s < 400,
    });

    const $ = cheerio.load(searchHtml);
    let detailUrl = null;

    const normalize = s => (s || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

    const titleWords = normalize(title).split(' ').filter(w => w.length > 2);

    $('a').each((i, el) => {
      if (detailUrl) return;
      const href = $(el).attr('href') || '';
      if (!href.includes('/pelicula/') && !href.includes('/serie/')) return;
      const text = normalize($(el).text());
      const matches = titleWords.filter(w => text.includes(w));
      if (matches.length >= Math.min(2, titleWords.length)) {
        detailUrl = href.startsWith('http') ? href : BASE + href;
      }
    });

    if (!detailUrl) {
      console.log('[pelispedia] No se encontró detalle');
      return found;
    }

    console.log('[pelispedia] Detalle final:', detailUrl);

    const { data: detailHtml } = await axios.get(detailUrl, {
      timeout: 15000,
      httpsAgent,
      headers: getHeaders({ 'Referer': searchUrl }),
      validateStatus: s => s >= 200 && s < 400,
    });

    const $d = cheerio.load(detailHtml);

    // ═══════════════════════════════════════════════════════════════════
    // MÉTODO 1: Buscar data-pp-embed y decodificar entities HTML
    // ═══════════════════════════════════════════════════════════════════
    $d('[data-pp-embed]').each((i, el) => {
      const raw = $d(el).attr('data-pp-embed');
      const lang = ($d(el).attr('data-pp-lang') || 'latino').toLowerCase();
      if (!raw) return;

      const decoded = decodeHtmlEntities(raw);
      const srcMatch = decoded.match(/src=["']([^"']+)["']/);
      if (!srcMatch) return;

      let embedUrl = srcMatch[1];
      if (embedUrl.startsWith('//')) embedUrl = 'https:' + embedUrl;
      if (embedUrl.startsWith('/')) embedUrl = BASE + embedUrl;
      if (!embedUrl.startsWith('http')) return;
      if (/doubleclick|google|youtube|histats|yandex/i.test(embedUrl)) return;

      const name = detectServerName(embedUrl);
      if (!name) return;

      const targetLang = (lang === 'latino' || lang === 'español') ? 'latino' : 'subtitulado';
      if (!found[targetLang][name]) {
        found[targetLang][name] = embedUrl;
        console.log(`[pelispedia] OK ${targetLang}/${name}: ${embedUrl.slice(0, 80)}`);
      }
    });

    // ═══════════════════════════════════════════════════════════════════
    // MÉTODO 2: Buscar iframes directos
    // ═══════════════════════════════════════════════════════════════════
    $d('iframe').each((i, el) => {
      let src = $d(el).attr('src') || $d(el).attr('data-src');
      if (!src) return;
      if (src.startsWith('//')) src = 'https:' + src;
      if (src.startsWith('/')) src = BASE + src;
      if (!src.startsWith('http')) return;
      if (/doubleclick|google|youtube|histats/i.test(src)) return;

      const name = detectServerName(src);
      if (!name) return;
      if (!found.latino[name]) {
        found.latino[name] = src;
        console.log(`[pelispedia] OK (iframe) ${name}: ${src.slice(0, 80)}`);
      }
    });

    // ═══════════════════════════════════════════════════════════════════
    // MÉTODO 3: Buscar patrones de URLs de servidores conocidos en el HTML crudo
    // ═══════════════════════════════════════════════════════════════════
    const decoded = decodeHtmlEntities(detailHtml);
    const patterns = [
      /https?:\/\/(?:www\.)?(?:streamwish|hglink|flaswish|embedwish)\.[^\s"'<>]+/gi,
      /https?:\/\/(?:www\.)?(?:filelions|vidhide|minochinos|callistanise|morencius)\.[^\s"'<>]+/gi,
      /https?:\/\/(?:www\.)?vidmoly\.[^\s"'<>]+/gi,
    ];
    for (const re of patterns) {
      const matches = decoded.match(re);
      if (matches) {
        for (const url of matches) {
          const name = detectServerName(url);
          if (name && !found.latino[name]) {
            found.latino[name] = url;
            console.log(`[pelispedia] OK (regex) ${name}: ${url.slice(0, 80)}`);
          }
        }
      }
    }

    console.log('[pelispedia] Total encontrados:', Object.keys(found.latino).length);
    return found;
  } catch (e) {
    console.warn(`[pelispedia] Falló:`, e.message);
    return found;
  }
}

function detectServerName(url) {
  const u = (url || '').toLowerCase();
  if (/streamwish|hglink|flaswish|embedwish/i.test(u)) return 'StreamWish';
  if (/vidhide|minochinos|callistanise|morencius|filelions/i.test(u)) return 'FileLions';
  if (/vidmoly/i.test(u)) return 'Vidmoly';
  return null;
}

module.exports = {
  scrapePelispedia,
  search: async (title, year, tmdbId, type) => scrapePelispedia(title, year, tmdbId, type)
};

console.log('[pelispedia] Provider cargado (3 metodos de extraccion)');
