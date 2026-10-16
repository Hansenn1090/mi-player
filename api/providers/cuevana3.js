// api/providers/cuevana3.js
'use strict';

const axios = require('axios');
const cheerio = require('cheerio');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const BASE = 'https://www1.cuevana3.now';

const ID_LANG = { '1': 'latino', '2': 'subtitulado', '3': 'castellano' };

function getHeaders(extra = {}) {
  return {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
    'Upgrade-Insecure-Requests': '1',
    ...extra,
  };
}

function fixMojibake(s) {
  if (!s || typeof s !== 'string') return s;
  if (!/Ã[\x80-\xBF]|Â[\x80-\xBF]|â€/.test(s)) return s;
  try {
    const fixed = Buffer.from(s, 'latin1').toString('utf8');
    if (fixed.includes('\uFFFD')) return s;
    return fixed;
  } catch { return s; }
}

function normalize(s) {
  return fixMojibake(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isSeriesType(type) {
  return ['tv', 'series', 'serie', 'serials'].includes(String(type || '').toLowerCase());
}

function detectServerName(url) {
  const u = (url || '').toLowerCase();
  if (/voe\.(sx|de|bar|net|to)/i.test(u)) return 'VOE';
  if (/player\.vimeo|vimeo\.com|vimeos/i.test(u)) return 'Vimeo';
  if (/streamwish|embedwish|hglink|flaswish|wishfast/i.test(u)) return 'StreamWish';
  if (/vidhide|morencius|minochinos|callistanise|hgcloud|filelions/i.test(u)) return 'VidHide';
  if (/filemoon|moonplayer|byse/i.test(u)) return 'FileMoon';
  // Doodstream: acepta todos los dominios (incluyendo el actual doodstream.com)
  if (/doodstream|dood\.(la|sh|so|pm|to|wf)|d000d/i.test(u)) return 'DoodStream';
  if (/fembed/i.test(u)) return 'Fembed';
  if (/uqload|ugload/i.test(u)) return 'Uqload';
  if (/streamtape|stape/i.test(u)) return 'StreamTape';
  if (/mixdrop|mxdrop/i.test(u)) return 'MixDrop';
  if (/ok\.ru|okru/i.test(u)) return 'OkRu';
  if (/vidmoly/i.test(u)) return 'Vidmoly';
  try {
    const host = new URL(u).hostname.replace(/^www\./, '').split('.')[0];
    return host || null;
  } catch { return null; }
}

function normalizeUrl(url) {
  if (!url) return url;
  let u = String(url).trim();
  if (u.startsWith('//')) u = 'https:' + u;
  // Solo arreglar el typo de uqload. NO reescribir doodstream.com:
  // cada mirror tiene su propia base de datos de videos.
  u = u.replace(/\/\/ugload\./i, '//uqload.');
  return u;
}

async function fetchHtml(url, referer) {
  const { data } = await axios.get(url, {
    timeout: 12000,
    headers: getHeaders({ Referer: referer || BASE + '/' }),
    responseType: 'text',
    transformResponse: [(d) => d],
    validateStatus: (s) => s >= 200 && s < 400,
  });
  return data;
}

async function findDetailUrl(title, year, type) {
  const isSeries = isSeriesType(type);
  const titleWords = normalize(title).split(' ').filter((w) => w.length > 2);
  const yearStr = String(year || '');
  const urlPattern = isSeries ? /^\/serie\/[^\/]+$/ : /^\/\d+\/[^\/]+$/;

  const searchUrl = `${BASE}/?s=${encodeURIComponent(title)}`;
  console.log(`[cuevana3] Search: ${searchUrl}`);

  let searchHtml;
  try {
    searchHtml = await fetchHtml(searchUrl);
  } catch (e) {
    console.warn('[cuevana3] Error búsqueda:', e.message);
    return null;
  }

  const $ = cheerio.load(searchHtml);
  const candidates = [];

  $('div.TPost a[href]').each((i, el) => {
    const href = $(el).attr('href') || '';
    if (/\/category\/|\/tag\/|\/actor\/|\/director\/|\/genero/.test(href)) return;
    if (!urlPattern.test(href)) return;

    const titleText = $(el).find('h2.Title').first().text().trim()
                   || $(el).find('div.Title').first().text().trim()
                   || $(el).text().trim();

    const $card = $(el).closest('div.TPost');
    const yearText = $card.find('span.Year').first().text().trim()
                  || $card.find('span.Date').first().text().trim()
                  || '';

    candidates.push({
      href,
      title: titleText,
      year: yearText,
      slug: href.split('/').filter(Boolean).pop() || '',
    });
  });

  console.log(`[cuevana3] Candidatos: ${candidates.length}`);

  let best = null;
  let bestScore = 0;

  for (const c of candidates) {
    const candNorm = normalize(c.title);
    const slugNorm = normalize(c.slug.replace(/-/g, ' '));
    const wordsInTitle = titleWords.filter((w) => candNorm.includes(w)).length;
    const wordsInSlug = titleWords.filter((w) => slugNorm.includes(w)).length;
    const wordsMatched = Math.max(wordsInTitle, wordsInSlug);

    const yearMatch = yearStr && c.year && c.year.includes(yearStr);
    const score = wordsMatched + (yearMatch ? 3 : 0);

    if (wordsMatched < Math.min(2, titleWords.length)) continue;
    if (score > bestScore) { bestScore = score; best = c; }
  }

  if (best) {
    const fullUrl = best.href.startsWith('http') ? best.href : BASE + best.href;
    console.log(`[cuevana3] Match (${bestScore}pts): "${best.title}" (${best.year}) → ${fullUrl}`);
    return fullUrl;
  }

  console.log('[cuevana3] Sin match');
  return null;
}

function extractServers($d, pageUrl, langFallback) {
  const found = {};

  $d('.TPlayerTb iframe, iframe.no-you, iframe[data-src]').each((i, el) => {
    try {
      let src = $d(el).attr('data-src') || $d(el).attr('src');
      if (!src || !src.startsWith('http') || src === 'about:blank') return;
      src = normalizeUrl(src);

      // ─── Filtro 1: descartar URLs sin ID de video ───
      // Ej: https://dood.to/e/  (sin ID) → no reproducible
      if (/\/(e|v|d|f)\/?$/i.test(src)) {
        console.warn(`[cuevana3] URL sin ID descartada: ${src}`);
        return;
      }

      // ─── Filtro 2: YouTube suele ser el trailer, no la película ───
      if (/youtube\.com|youtu\.be/i.test(src)) {
        console.log(`[cuevana3] YouTube ignorado (trailer): ${src.slice(0, 60)}`);
        return;
      }

      const $optWrap = $d(el).closest('[id^="OptE"]');
      const parentId = $optWrap.attr('id') || '';
      const idMatch = parentId.match(/OptE(\d)(\d)/);

      let detectedLang = langFallback || 'latino';
      let hostIndex = i + 1;
      if (idMatch) {
        detectedLang = ID_LANG[idMatch[1]] || 'latino';
        hostIndex = parseInt(idMatch[2], 10);
      }

      const hostName = detectServerName(src);
      if (!hostName) return;

      if (!found[detectedLang]) found[detectedLang] = {};

      let key = hostName.toLowerCase();
      let n = 2, finalKey = key;
      while (found[detectedLang][finalKey]) finalKey = `${key}_${n++}`;

      found[detectedLang][finalKey] = {
        url: src,
        referer: pageUrl,
        server: hostName,
      };
      console.log(`[cuevana3] ✅ ${detectedLang}/${finalKey}: ${src.slice(0, 90)}`);
    } catch (e) {
      console.warn(`[cuevana3] iframe ${i} falló:`, e.message);
    }
  });

  return found;
}

function extractEpisodeLinks($d) {
  const eps = [];
  $d('a[href*="/episodio/"]').each((i, el) => {
    const href = $d(el).attr('href') || '';
    if (!/^\/episodio\/[^\/]+$/.test(href)) return;
    const full = href.startsWith('http') ? href : BASE + href;
    if (!eps.includes(full)) eps.push(full);
  });
  return eps;
}

async function scrapeCuevana3(title, year, tmdbId, type = 'movie', lang = 'latino') {
  const found = {};
  if (!title) return found;

  const isSeries = isSeriesType(type);
  console.log(`[cuevana3] Buscando: "${title}" (${year}) [${isSeries ? 'serie' : 'película'}]`);

  const detailUrl = await findDetailUrl(title, year, type);
  if (!detailUrl) { console.log('[cuevana3] No encontró detalle'); return found; }
  console.log('[cuevana3] Detalle:', detailUrl);

  let detailHtml;
  try {
    detailHtml = await fetchHtml(detailUrl);
  } catch (e) {
    console.warn('[cuevana3] Error detalle:', e.message);
    return found;
  }

  const $d = cheerio.load(detailHtml);
  Object.assign(found, extractServers($d, detailUrl, lang));

  if (isSeries && Object.keys(found).length === 0) {
    const episodes = extractEpisodeLinks($d);
    console.log(`[cuevana3] Episodios: ${episodes.length}`);
    if (episodes.length > 0) {
      const epUrl = episodes[0];
      try {
        console.log(`[cuevana3] Cargando episodio: ${epUrl}`);
        const epHtml = await fetchHtml(epUrl, detailUrl);
        const $ep = cheerio.load(epHtml);
        Object.assign(found, extractServers($ep, epUrl, lang));
      } catch (e) {
        console.warn('[cuevana3] Error episodio:', e.message);
      }
    }
  }

  const total = Object.values(found).reduce((a, s) => a + Object.keys(s).length, 0);
  console.log(`[cuevana3] Total: ${total}`);
  return found;
}

module.exports = {
  name: 'cuevana3',
  scrapeCuevana3,
  search: async (title, year, tmdbId, type, lang) =>
    scrapeCuevana3(title, year, tmdbId, type, lang),
};
