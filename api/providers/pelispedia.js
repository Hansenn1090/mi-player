const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

// ⚠️ Ignorar errores de certificado SSL local (solo para evitar el bloqueo desde Render)
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// Solo usar el dominio que funcionaba antes (.casa)
const BASE = 'https://pelispedia.casa';

async function scrapePelispedia(title, year, tmdbId, type) {
  const found = { latino: {}, subtitulado: {} };
  if (!title) return found;

  console.log('[pelispedia] Buscando:', title, year || '');

  try {
    const searchUrl = `${BASE}/?s=${encodeURIComponent(title)}`;
    const { data: searchHtml } = await axios.get(searchUrl, {
      timeout: 15000,
      httpsAgent,
      headers: {
        'User-Agent': UA,
        'Referer': BASE + '/',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      },
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

    console.log('[pelispedia] Detalle:', detailUrl);

    const { data: detailHtml } = await axios.get(detailUrl, {
      timeout: 15000,
      httpsAgent,
      headers: {
        'User-Agent': UA,
        'Referer': BASE + '/',
        'Accept': 'text/html,application/xhtml+xml,*/*',
      },
      validateStatus: s => s >= 200 && s < 400,
    });

    const $d = cheerio.load(detailHtml);

    $d('iframe, [data-src]').each((i, el) => {
      const src = $d(el).attr('src') || $d(el).attr('data-src');
      if (!src) return;
      let embedUrl = src;
      if (embedUrl.startsWith('//')) embedUrl = 'https:' + embedUrl;
      if (embedUrl.startsWith('/')) embedUrl = BASE + embedUrl;
      if (!embedUrl.startsWith('http')) return;
      if (/doubleclick|google|youtube|histats|yandex|tagivi/i.test(embedUrl)) return;

      const name = detectServerName(embedUrl);
      if (!name) return;
      if (!found.latino[name]) {
        found.latino[name] = embedUrl;
        console.log(`[pelispedia] OK ${name}: ${embedUrl.slice(0, 80)}`);
      }
    });

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

console.log('[pelispedia] Provider cargado (ligero, sin Puppeteer)');
