// api/providers/poseidonhd2.js
/**
 * PoseidonHD2.co — Sitio Next.js con __NEXT_DATA__
 *
 * URLs predecibles por TMDB ID:
 *   Películas: /pelicula/{tmdbId}/{slug}
 *   Series:    /serie/{tmdbId}/{slug}
 *
 * La página incluye <script id="__NEXT_DATA__"> con JSON que contiene:
 *   pageProps.thisMovie.videos = {
 *     latino:   [{cyberlocker, result, quality}, ...],
 *     spanish:  [...],
 *     english:  [...]
 *   }
 *
 * No hace falta scraping HTML. Solo parsear el JSON.
 */

const axios = require('axios');
const cheerio = require('cheerio');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const BASE = 'https://www.poseidonhd2.co';

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

// ══════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════
function isSeriesType(type) {
  return ['tv', 'series', 'serie', 'serials'].includes(String(type || '').toLowerCase());
}

function slugify(title) {
  return String(title || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

// Mapeo de idioma del sitio → idioma del registry
// El sitio usa: "latino", "spanish", "english"
const LANG_MAP = {
  latino: 'latino',
  spanish: 'castellano',   // "Español (castellano)"
  english: 'subtitulado',  // VOSE
};

// Mapeo de cyberlocker a nombre limpio
const CYBERLOCKER_LABEL = {
  streamwish: 'StreamWish',
  vidhide: 'VidHide',
  voesx: 'VOE',
  doodstream: 'DoodStream',
  filelions: 'FileLions',
  filemoon: 'FileMoon',
  vidmoly: 'Vidmoly',
};

// ══════════════════════════════════════════════════════════════════
// Extraer servidores del __NEXT_DATA__
// ══════════════════════════════════════════════════════════════════
function extractServersFromNextData(nextData, found) {
  if (!nextData || !nextData.props || !nextData.props.pageProps) return;

  const pageProps = nextData.props.pageProps;
  const movie = pageProps.thisMovie || pageProps.thisSerie || pageProps.thisShow || null;
  if (!movie) return;

  // Fuente 1: videos por idioma (películas)
  if (movie.videos && typeof movie.videos === 'object') {
    for (const [rawLang, servers] of Object.entries(movie.videos)) {
      const lang = LANG_MAP[rawLang.toLowerCase()] || rawLang.toLowerCase();
      if (!Array.isArray(servers)) continue;

      if (!found[lang]) found[lang] = {};

      for (const srv of servers) {
        if (!srv || !srv.result) continue;
        const locker = (srv.cyberlocker || 'servidor').toLowerCase();
        const label = CYBERLOCKER_LABEL[locker] || locker;

        let finalKey = label.toLowerCase();
        if (found[lang][finalKey]) {
          finalKey = `${finalKey}_${Object.keys(found[lang]).length + 1}`;
        }

        found[lang][finalKey] = srv.result;
        console.log(`[poseidonhd2] ✅ ${lang}/${finalKey}: ${srv.result.slice(0, 90)}`);
      }
    }
  }

  // Fuente 2: episodios de series (si existiera estructura similar)
  // Algunas series usan videos directos, otras usan episodes
  if (Array.isArray(movie.episodes)) {
    for (const ep of movie.episodes) {
      const epVideos = ep.videos || ep.sources;
      if (!epVideos) continue;

      for (const [rawLang, servers] of Object.entries(epVideos)) {
        const lang = LANG_MAP[rawLang.toLowerCase()] || rawLang.toLowerCase();
        if (!Array.isArray(servers)) continue;

        if (!found[lang]) found[lang] = {};

        for (const srv of servers) {
          if (!srv || !srv.result) continue;
          const locker = (srv.cyberlocker || 'servidor').toLowerCase();
          const label = CYBERLOCKER_LABEL[locker] || locker;

          const finalKey = `${label.toLowerCase()}_ep${ep.number || 0}`;
          if (!found[lang][finalKey]) {
            found[lang][finalKey] = srv.result;
            console.log(`[poseidonhd2] ✅ ${lang}/${finalKey}: ${srv.result.slice(0, 90)}`);
          }
        }
      }
    }
  }
}

// ══════════════════════════════════════════════════════════════════
// Intentar cargar la URL directa
// ══════════════════════════════════════════════════════════════════
async function tryDirectUrl(tmdbId, slug, type) {
  const cleanId = String(tmdbId).replace(/\D/g, '');
  if (!cleanId) return null;

  const isSeries = isSeriesType(type);
  const basePath = isSeries ? 'serie' : 'pelicula';

  const candidates = [
    `${BASE}/${basePath}/${cleanId}/${slug}`,
    `${BASE}/${basePath}/${cleanId}/${slug}/`,
    // Fallback con slug diferente
    `${BASE}/${basePath}/${cleanId}`,
  ];

  for (const url of candidates) {
    try {
      const { data: html } = await axios.get(url, {
        timeout: 10000,
        headers: getHeaders({ 'Referer': BASE + '/' }),
        validateStatus: s => s >= 200 && s < 400,
        maxRedirects: 5,
      });
      if (html && html.includes('__NEXT_DATA__')) {
        console.log(`[poseidonhd2] URL directa OK: ${url}`);
        return { url, html };
      }
    } catch (_) { /* siguiente */ }
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════
// Buscar por búsqueda del sitio
// ══════════════════════════════════════════════════════════════════
async function trySearchUrl(title, year, type) {
  const isSeries = isSeriesType(type);
  const basePath = isSeries ? 'serie' : 'pelicula';

  try {
    const searchUrl = `${BASE}/buscar?q=${encodeURIComponent(title)}`;
    console.log(`[poseidonhd2] Search: ${searchUrl}`);

    const { data: html } = await axios.get(searchUrl, {
      timeout: 10000,
      headers: getHeaders({ 'Referer': BASE + '/' }),
      validateStatus: s => s >= 200 && s < 400,
    });

    // Buscar links a /pelicula/ o /serie/
    const $ = cheerio.load(html);
    const normalize = s => (s || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

    const titleWords = normalize(title).split(' ').filter(w => w.length > 2);
    const yearStr = String(year || '');
    const pathRegex = isSeries ? /\/serie\// : /\/pelicula\//;

    let bestUrl = null;
    let bestScore = 0;

    $('a').each((i, el) => {
      const href = $(el).attr('href') || '';
      if (!pathRegex.test(href)) return;

      const text = normalize($(el).text());
      const wordsMatched = titleWords.filter(w => text.includes(w)).length;
      const yearMatch = yearStr && ($(el).text().includes(yearStr) || href.includes(yearStr));
      const score = wordsMatched + (yearMatch ? 3 : 0);

      if (score > bestScore && wordsMatched >= Math.min(2, titleWords.length)) {
        bestScore = score;
        bestUrl = href.startsWith('http') ? href : BASE + href;
      }
    });

    if (bestUrl) {
      console.log(`[poseidonhd2] Search match (${bestScore}pts): ${bestUrl}`);
      const { data: html } = await axios.get(bestUrl, {
        timeout: 12000,
        headers: getHeaders({ 'Referer': searchUrl }),
        validateStatus: s => s >= 200 && s < 400,
      });
      if (html && html.includes('__NEXT_DATA__')) {
        return { url: bestUrl, html };
      }
    }
  } catch (e) {
    console.warn('[poseidonhd2] Error búsqueda:', e.message);
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════
// Función principal — firma correcta (title, year, tmdbId, type, lang)
// ══════════════════════════════════════════════════════════════════
async function scrapePoseidonhd2(title, year, tmdbId, type = 'movie', lang = 'latino') {
  const found = {};
  if (!title) return found;

  const isSeries = isSeriesType(type);
  console.log(`[poseidonhd2] Buscando: "${title}" (${year}) TMDB=${tmdbId} [${isSeries ? 'serie' : 'película'}]`);

  const slug = slugify(title);

  // 1) Intentar URL directa (más rápido)
  let result = null;
  if (tmdbId) {
    result = await tryDirectUrl(tmdbId, slug, type);
  }

  // 2) Fallback: búsqueda del sitio
  if (!result) {
    result = await trySearchUrl(title, year, type);
  }

  if (!result) {
    console.log('[poseidonhd2] No encontró detalle');
    return found;
  }

  // 3) Extraer __NEXT_DATA__ del HTML
  const $d = cheerio.load(result.html);
  const nextDataScript = $d('script#__NEXT_DATA__').html();

  if (!nextDataScript) {
    console.log('[poseidonhd2] No encontró __NEXT_DATA__');
    return found;
  }

  let nextData;
  try {
    nextData = JSON.parse(nextDataScript);
  } catch (e) {
    console.warn('[poseidonhd2] Error parseando __NEXT_DATA__:', e.message);
    return found;
  }

  // 4) Extraer servidores del JSON
  extractServersFromNextData(nextData, found);

  const total = Object.values(found).reduce((a, s) => a + Object.keys(s).length, 0);
  console.log(`[poseidonhd2] Total: ${total}`);
  return found;
}

module.exports = {
  name: 'poseidonhd2',
  scrapePoseidonhd2,
  search: async (title, year, tmdbId, type, lang) => scrapePoseidonhd2(title, year, tmdbId, type, lang),
};

console.log('[poseidonhd2] Provider cargado');
