const axios = require('axios');
const cheerio = require('cheerio');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
const BASE = 'https://cineplus123.com';

async function scrapeCineplus123(title, year, tmdbId, type) {
  const found = {};
  if (!title) return found;
  console.log('[cineplus123] Buscando:', title, year || '');

  try {
    const searchUrl = `${BASE}/?s=${encodeURIComponent(title)}`;
    const { data: searchHtml } = await axios.get(searchUrl, {
      timeout: 12000,
      headers: { 'User-Agent': UA, 'Referer': BASE + '/' },
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
      if (!href.includes('/pelicula/') && !href.includes('/ver/')) return;
      const text = normalize($(el).text());
      const matches = titleWords.filter(w => text.includes(w));
      if (matches.length >= Math.min(2, titleWords.length)) {
        detailUrl = href.startsWith('http') ? href : BASE + href;
      }
    });

    if (!detailUrl) return found;

    const { data: detailHtml } = await axios.get(detailUrl, {
      timeout: 12000,
      headers: { 'User-Agent': UA, 'Referer': BASE + '/' },
      validateStatus: s => s >= 200 && s < 400,
    });

    const $d = cheerio.load(detailHtml);

    $d('iframe').each((i, el) => {
      const src = $d(el).attr('src') || $d(el).attr('data-src');
      if (!src) return;
      let embedUrl = src;
      if (embedUrl.startsWith('//')) embedUrl = 'https:' + embedUrl;
      if (embedUrl.startsWith('/')) embedUrl = BASE + embedUrl;
      if (!embedUrl.startsWith('http')) return;
      if (/doubleclick|google|youtube/i.test(embedUrl)) return;

      const name = detectServerName(embedUrl);
      if (!found.latino) found.latino = {};
      if (!found.latino[name]) found.latino[name] = embedUrl;
    });

    return found;
  } catch (e) {
    console.warn('[cineplus123] Error:', e.message);
    return found;
  }
}

function detectServerName(url) {
  const u = (url || '').toLowerCase();
  if (/streamwish|hglink|filelions/i.test(u)) return 'StreamWish';
  if (/vidhide|minochinos|callistanise/i.test(u)) return 'FileLions';
  if (/vidmoly/i.test(u)) return 'Vidmoly';
  if (/voe\.sx|voe\.de/i.test(u)) return 'VOE';
  return 'Servidor';
}

module.exports = {
  scrapeCineplus123,
  search: async (title, year, tmdbId, type) => scrapeCineplus123(title, year, tmdbId, type)
};

console.log('[cineplus123] Provider cargado');
