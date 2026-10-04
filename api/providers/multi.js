const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// ══════════════════════════════════════════════════════════════════════════
// LISTA DE SITIOS A PROBAR (en orden de prioridad)
// ══════════════════════════════════════════════════════════════════════════
const SITES = [
  // Los que ya sabemos que pueden funcionar
  { name: 'pelispedia.casa', base: 'https://pelispedia.casa', searchPath: '/?s=', detailPaths: ['/pelicula/', '/peliculas/', '/serie/'] },
  { name: 'pelisplushd.to', base: 'https://pelisplushd.to', searchPath: '/search?s=', detailPaths: ['/pelicula/', '/serie/'] },
  { name: 'repelis24.ing', base: 'https://repelis24.ing', searchPath: '/?s=', detailPaths: ['/pelicula/', '/serie/'] },
  { name: 'pelispedia',   base: 'https://pelispedia.casa',  searchPath: '/?s=',  detailPaths: ['/pelicula/', '/peliculas/', '/serie/'] },
  { name: 'pelisplushd',  base: 'https://pelisplushd.bz',   searchPath: '/search?s=', detailPaths: ['/pelicula/', '/serie/'] },
  { name: 'cuevana3',     base: 'https://cuevana3.ch',      searchPath: '/?s=',  detailPaths: ['/pelicula/'] },
  { name: 'gnula',        base: 'https://gnula.nu',         searchPath: '/?s=',  detailPaths: ['/pelicula/', '/serie/'] },
  { name: 'repelisplus',  base: 'https://repelisplus.lat',  searchPath: '/?s=',  detailPaths: ['/pelicula/', '/serie/'] },
  { name: 'cinecalidad',  base: 'https://cinecalidad.fi',   searchPath: '/?s=',  detailPaths: ['/pelicula/', '/serie/'] },
  
  // Los que nos diste para probar
  { name: 'lamovie.org', base: 'https://lamovie.org', searchPath: '/?s=', detailPaths: ['/pelicula/', '/serie/'] },
  { name: 'cinecalidad.am', base: 'https://cinecalidad.am', searchPath: '/?s=', detailPaths: ['/pelicula/', '/ver-pelicula/'] },
  { name: 'cinecalidad.my', base: 'https://www.cinecalidad.my', searchPath: '/?s=', detailPaths: ['/pelicula/', '/ver-pelicula/'] },
  { name: 'cinecalidad.shop', base: 'https://cinecalidad.shop', searchPath: '/?s=', detailPaths: ['/pelicula/', '/ver-pelicula/'] },
  { name: 'pelisgratishds.com', base: 'https://pelisgratishds.com', searchPath: '/?s=', detailPaths: ['/pelicula/', '/serie/'] },
  { name: 'entrepeliculasyseries.nz', base: 'https://entrepeliculasyseries.nz', searchPath: '/?s=', detailPaths: ['/pelicula/', '/serie/'] },
  { name: 'pelispedia.is', base: 'https://pelispedia.is', searchPath: '/?s=', detailPaths: ['/pelicula/', '/serie/'] },
  { name: 'pelisplay.mom', base: 'https://pelisplay.mom', searchPath: '/?s=', detailPaths: ['/pelicula/', '/serie/'] },
  { name: 'miradetodo.lol', base: 'https://miradetodo.lol', searchPath: '/?s=', detailPaths: ['/pelicula/', '/serie/'] },
  { name: 'pelisplay.cfd', base: 'https://pelisplay.cfd', searchPath: '/?s=', detailPaths: ['/pelicula/', '/serie/'] },
  { name: 'poseidonhd2.co', base: 'https://www.poseidonhd2.co', searchPath: '/?s=', detailPaths: ['/pelicula/', '/serie/'] },
  { name: 'pelis24.buzz', base: 'https://pelis24.buzz', searchPath: '/?s=', detailPaths: ['/pelicula/', '/serie/'] },
  { name: 'pelicinehd.com', base: 'https://pelicinehd.com', searchPath: '/?s=', detailPaths: ['/movies/', '/pelicula/'] },
  { name: 'pelisflixhd1.top', base: 'https://pelisflixhd1.top', searchPath: '/?s=', detailPaths: ['/pelicula/', '/serie/'] },
  { name: 'cineplus123.org', base: 'https://cineplus123.org', searchPath: '/?s=', detailPaths: ['/peliculas/', '/pelicula/'] },
];

function getHeaders(extra = {}) {
  return {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
    'Sec-Ch-Ua': '"Chromium";v="121", "Not A(Brand";v="99"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Upgrade-Insecure-Requests': '1',
    ...extra,
  };
}

function decodeHtmlEntities(str) {
  return String(str || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

function normalize(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

// ══════════════════════════════════════════════════════════════════════════
// Buscar en un sitio específico
// ══════════════════════════════════════════════════════════════════════════
async function searchSite(site, title, year) {
  const found = { latino: {}, subtitulado: {} };

  try {
    const searchUrl = `${site.base}${site.searchPath}${encodeURIComponent(title)}`;
    console.log(`[${site.name}] Buscando:`, searchUrl);

    const { data: searchHtml } = await axios.get(searchUrl, {
      timeout: 10000,
      httpsAgent,
      headers: getHeaders({ 'Referer': site.base + '/' }),
      maxRedirects: 5,
      validateStatus: s => s >= 200 && s < 400,
    });

    if (!searchHtml || searchHtml.length < 500) {
      console.log(`[${site.name}] HTML vacío o bloqueado`);
      return found;
    }

    const $ = cheerio.load(searchHtml);
    let detailUrl = null;
    const titleWords = normalize(title).split(' ').filter(w => w.length > 2);

    $('a').each((i, el) => {
      if (detailUrl) return;
      const href = $(el).attr('href') || '';
      const matchesPath = site.detailPaths.some(p => href.includes(p));
      if (!matchesPath) return;
      const text = normalize($(el).text());
      const matches = titleWords.filter(w => text.includes(w));
      if (matches.length >= Math.min(2, titleWords.length)) {
        detailUrl = href.startsWith('http') ? href : site.base + href;
      }
    });

    if (!detailUrl) {
      console.log(`[${site.name}] No encontró detalle`);
      return found;
    }

    console.log(`[${site.name}] Detalle:`, detailUrl);

    const { data: detailHtml } = await axios.get(detailUrl, {
      timeout: 10000,
      httpsAgent,
      headers: getHeaders({ 'Referer': searchUrl }),
      validateStatus: s => s >= 200 && s < 400,
    });

    const $d = cheerio.load(detailHtml);
    const decoded = decodeHtmlEntities(detailHtml);

    // Método 1: data-pp-embed
    $d('[data-pp-embed]').each((i, el) => {
      const raw = $d(el).attr('data-pp-embed');
      const lang = ($d(el).attr('data-pp-lang') || 'latino').toLowerCase();
      if (!raw) return;
      const dec = decodeHtmlEntities(raw);
      const m = dec.match(/src=["']([^"']+)["']/);
      if (!m) return;
      addServer(found, lang, m[1], site.base, site.name);
    });

    // Método 2: iframes directos
    $d('iframe, [data-src]').each((i, el) => {
      const src = $d(el).attr('src') || $d(el).attr('data-src');
      if (!src) return;
      addServer(found, 'latino', src, site.base, site.name);
    });

    // Método 3: regex sobre HTML completo
    const patterns = [
      /https?:\/\/(?:www\.)?(?:streamwish|hglink|flaswish|embedwish)\.[^\s"'<>]+/gi,
      /https?:\/\/(?:www\.)?(?:filelions|vidhide|minochinos|callistanise)\.[^\s"'<>]+/gi,
      /https?:\/\/(?:www\.)?vidmoly\.[^\s"'<>]+/gi,
    ];
    for (const re of patterns) {
      const matches = decoded.match(re);
      if (matches) matches.forEach(u => addServer(found, 'latino', u, site.base, site.name));
    }

    const total = Object.keys(found.latino).length + Object.keys(found.subtitulado).length;
    console.log(`[${site.name}] Total:`, total);
    return found;

  } catch (e) {
    console.log(`[${site.name}] Falló:`, e.message);
    return found;
  }
}

function addServer(found, lang, rawUrl, base, siteName) {
  if (!rawUrl) return;
  let u = rawUrl;
  if (u.startsWith('//')) u = 'https:' + u;
  if (u.startsWith('/')) u = base + u;
  if (!u.startsWith('http')) return;
  if (/doubleclick|google|youtube|histats|yandex|whatsapp|facebook/i.test(u)) return;

  const name = detectServer(u);
  if (!name) return;

  const targetLang = (lang === 'latino' || lang === 'español' || lang === 'castellano') ? 'latino' : 'subtitulado';
  if (!found[targetLang][name]) {
    found[targetLang][name] = u;
    console.log(`[${siteName}] OK ${targetLang}/${name}: ${u.slice(0, 70)}`);
  }
}

function detectServer(url) {
  const u = (url || '').toLowerCase();
  if (/streamwish|hglink|flaswish|embedwish/i.test(u)) return 'StreamWish';
  if (/vidhide|minochinos|callistanise|morencius|filelions/i.test(u)) return 'FileLions';
  if (/vidmoly/i.test(u)) return 'Vidmoly';
  return null;
}

// ══════════════════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL: prueba todos los sitios hasta que uno funcione
// ══════════════════════════════════════════════════════════════════════════
async function scrapeMulti(title, year, tmdbId, type) {
  const result = { latino: {}, subtitulado: {} };
  if (!title) return result;

  console.log('[multi] Iniciando búsqueda en', SITES.length, 'sitios');

  for (const site of SITES) {
    const siteResult = await searchSite(site, title, year);

    // Combinar resultados
    for (const lang of ['latino', 'subtitulado']) {
      for (const [name, url] of Object.entries(siteResult[lang])) {
        if (!result[lang][name]) {
          result[lang][name] = url;
        }
      }
    }

    // Si ya tenemos 2+ servidores en latino, parar
    if (Object.keys(result.latino).length >= 2) {
      console.log('[multi] Suficientes servidores, deteniendo búsqueda');
      break;
    }
  }

  console.log('[multi] RESULTADO FINAL:', Object.keys(result.latino));
  return result;
}

module.exports = {
  scrapeMulti,
  search: async (title, year, tmdbId, type) => scrapeMulti(title, year, tmdbId, type)
};

console.log('[multi] Provider cargado con', SITES.length, 'sitios');
