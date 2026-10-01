// ══════════════════════════════════════════════════════════════════════════
// scraper.js — v4
//   Orden: Pelisplay → Vimeos → PelisPlusHD → Xpass
// ══════════════════════════════════════════════════════════════════════════

const axios = require('axios');
const cheerio = require('cheerio');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function scrapeAll(info, type = 'movie') {
  const servers = { latino: {}, subtitulado: {} };
  const sources = {};

  const tmdbId = (info && info.tmdbId) || '';
  const title = (info && info.title) || '';
  const year = (info && info.year) || '';

  console.log('[scraper] Servidores para TMDB', tmdbId, '—', title, year);
  if (!tmdbId) return { servers, sources };

  // ═════════════════════════════════════════════════════════════════════
  // ORDEN DE PRIORIDAD
  //  🥇 Pelisplay   → DooPlay (múltiples servidores VOE/StreamWish/etc.)
  //  🥈 Vimeos      → HLS proxy
  //  🥉 PelisPlusHD → múltiples servidores externos
  //  🏴 Xpass       → HLS con filtro de ads
  // ═════════════════════════════════════════════════════════════════════

  // 🥇 PELISPLAY
  if (title) {
    try {
      const pelisplayServers = await scrapePelisplay(title, year, type);
      Object.assign(servers.latino, pelisplayServers);
      sources.pelisplay = { ok: true, count: Object.keys(pelisplayServers).length };
      console.log('[scraper] Pelisplay:', Object.keys(pelisplayServers).length, 'servidores');
    } catch (e) {
      console.warn('[scraper] Pelisplay falló:', e.message);
      sources.pelisplay = { ok: false, error: e.message };
    }
  }

  // 🥈 VIMEOS
  servers.latino['Vimeos'] = `https://vimeos.unlimplay.com/?id=${tmdbId}`;

  // 🥉 PELISPLUSHD
  if (title) {
    try {
      const pelisplusServers = await scrapePelisPlusHD(title, type);
      Object.assign(servers.latino, pelisplusServers);
      sources.pelisplushd = { ok: true, count: Object.keys(pelisplusServers).length };
    } catch (e) {
      sources.pelisplushd = { ok: false, error: e.message };
    }
  }

  // 🏴 XPASS (último — tiene ads que filtramos)
  servers.latino['Xpass'] = `https://play.xpass.top/e/${type}/${tmdbId}`;
  servers.subtitulado['Xpass EN'] = `https://play.xpass.top/e/${type}/${tmdbId}`;

  console.log('[scraper] Total latino:', Object.keys(servers.latino).length);
  console.log('[scraper] Total subtitulado:', Object.keys(servers.subtitulado).length);

  return { servers, sources };
}

// ══════════════════════════════════════════════════════════════════════════
// PELISPLAY (DooPlay — usa AJAX)
// ══════════════════════════════════════════════════════════════════════════
async function scrapePelisplay(title, year, type) {
  const found = {};
  const base = 'https://pelisplay.lol';

  const slug = title.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  console.log('[scraper] Pelisplay buscando:', title);

  // 1. Buscar la película
  let detailUrl = null;
  try {
    // Intento 1: búsqueda directa por slug (DooPlay suele aceptarlo)
    const tryUrls = [
      `${base}/peliculas/`,
      `${base}/?s=${encodeURIComponent(title)}`,
    ];

    for (const searchUrl of tryUrls) {
      try {
        const { data: html } = await axios.get(searchUrl, {
          timeout: 8000,
          headers: { 'User-Agent': UA, 'Referer': base + '/' },
          validateStatus: s => s >= 200 && s < 400,
        });

        // Buscar links de /peliculas/xxx.html
        const regex = /href="(\/peliculas\/[^"]+\.html)"/gi;
        let m;
        const links = [];
        while ((m = regex.exec(html)) !== null) {
          links.push(base + m[1]);
        }

        // Buscar el que mejor coincida con el título
        for (const link of links) {
          const linkSlug = link.toLowerCase();
          // Coincidencia por primeras palabras del slug
          const words = slug.split('-').slice(0, 3);
          if (words.every(w => linkSlug.includes(w))) {
            detailUrl = link;
            break;
          }
        }
        if (detailUrl) break;
      } catch (e) {}
    }
  } catch (e) {
    console.warn('[scraper] Pelisplay búsqueda error:', e.message);
    return found;
  }

  if (!detailUrl) {
    console.log('[scraper] Pelisplay: no encontrada');
    return found;
  }

  console.log('[scraper] Pelisplay detalle:', detailUrl);

  // 2. Obtener la página de detalle
  let detailHtml = '';
  try {
    const { data } = await axios.get(detailUrl, {
      timeout: 8000,
      headers: { 'User-Agent': UA, 'Referer': base + '/' },
      validateStatus: s => s >= 200 && s < 400,
    });
    detailHtml = data;
  } catch (e) {
    console.warn('[scraper] Pelisplay detalle error:', e.message);
    return found;
  }

  const $ = cheerio.load(detailHtml);

  // 3. Buscar iframes directos
  $('iframe[src]').each((i, el) => {
    let url = $(el).attr('src');
    if (!url) return;
    if (url.startsWith('//')) url = 'https:' + url;
    if (url.startsWith('/')) url = base + url;
    if (!url.startsWith('http')) return;
    if (/youtube|googleads|doubleclick|histats|yandex|dtscout/i.test(url)) return;

    const name = detectServerName(url);
    if (!found[name]) found[name] = url;
  });

  // 4. Buscar botones DooPlay (data-post + data-nume) y resolver vía AJAX
  const playerOptions = [];
  $('li.dooplay_player_option, li[data-post][data-nume]').each((i, el) => {
    const $el = $(el);
    const postId = $el.attr('data-post');
    const nume = $el.attr('data-nume');
    const dtype = $el.attr('data-type') || 'movie';
    if (postId && nume) {
      playerOptions.push({ postId, nume, dtype });
    }
  });

  console.log('[scraper] Pelisplay playerOptions:', playerOptions.length);

  // 5. Resolver cada botón vía AJAX
  for (const opt of playerOptions) {
    for (const action of ['doo_player_ajax', 'dooplay_player_ajax']) {
      try {
        const params = new URLSearchParams({
          action,
          post: opt.postId,
          nume: opt.nume,
          type: opt.dtype,
        }).toString();

        const { data } = await axios.post(
          `${base}/wp-admin/admin-ajax.php`,
          params,
          {
            timeout: 8000,
            headers: {
              'User-Agent': UA,
              'Referer': detailUrl,
              'X-Requested-With': 'XMLHttpRequest',
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            validateStatus: s => s >= 200 && s < 400,
          }
        );

        let embedUrl = null;
        if (data && data.embed_url) embedUrl = data.embed_url;
        else if (data && data.url) embedUrl = data.url;
        else if (typeof data === 'string' && /^https?:/.test(data.trim())) embedUrl = data.trim();
        else if (typeof data === 'string') {
          const m = data.match(/https?:\/\/[^\s"'<>]+/);
          if (m) embedUrl = m[0];
        }

        if (embedUrl) {
          const name = detectServerName(embedUrl);
          if (!found[name]) {
            found[name] = embedUrl;
            console.log('[scraper] Pelisplay', name, ':', embedUrl.slice(0, 60));
          }
          break;
        }
      } catch (e) {}
    }
  }

  return found;
}

// ══════════════════════════════════════════════════════════════════════════
// PELISPLUSHD
// ══════════════════════════════════════════════════════════════════════════
async function scrapePelisPlusHD(title, type) {
  const found = {};
  const bases = ['https://pelisplushd.bz', 'https://pelisplushd.la'];

  for (const base of bases) {
    try {
      const searchUrl = `${base}/search?s=${encodeURIComponent(title)}`;
      const { data: searchHtml } = await axios.get(searchUrl, {
        timeout: 8000,
        headers: { 'User-Agent': UA, 'Referer': base + '/' },
        validateStatus: s => s >= 200 && s < 400,
      });

      const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`href="(${escaped}\\/pelicula\\/[^"]+)"`, 'i');
      const match = searchHtml.match(regex);
      if (!match) continue;

      const detailUrl = match[1];
      const { data: detailHtml } = await axios.get(detailUrl, {
        timeout: 8000,
        headers: { 'User-Agent': UA, 'Referer': base },
        validateStatus: s => s >= 200 && s < 400,
      });

      const iframeRegex = /<iframe[^>]+src="([^"]+)"/gi;
      let m;
      let count = 0;
      while ((m = iframeRegex.exec(detailHtml)) !== null) {
        let url = m[1];
        if (url.startsWith('//')) url = 'https:' + url;
        if (url.startsWith('/')) url = base + url;
        if (!url.startsWith('http')) continue;
        if (/youtube|googleads|doubleclick|histats|yandex/i.test(url)) continue;

        let name = detectServerName(url);
        if (name === 'Servidor') name = 'Servidor ' + (++count);

        if (!found[name]) found[name] = url;
      }

      if (Object.keys(found).length > 0) break;
    } catch (e) {}
  }

  return found;
}

// ══════════════════════════════════════════════════════════════════════════
// HELPER — Detecta nombre de servidor por URL
// ══════════════════════════════════════════════════════════════════════════
function detectServerName(url) {
  const u = (url || '').toLowerCase();
  if (/voe\.sx/i.test(u)) return 'VOE';
  if (/streamwish|embedwish|hglink/i.test(u)) return 'StreamWish';
  if (/vidhide|morencius/i.test(u)) return 'VidHide';
  if (/filemoon|moonplayer/i.test(u)) return 'FileMoon';
  if (/dood/i.test(u)) return 'DoodStream';
  if (/fembed/i.test(u)) return 'Fembed';
  if (/vimeos/i.test(u)) return 'Vimeos';
  if (/xpass/i.test(u)) return 'Xpass';
  if (/streamtape/i.test(u)) return 'StreamTape';
  if (/mixdrop/i.test(u)) return 'MixDrop';
  if (/ok\.ru/i.test(u)) return 'OkRu';
  if (/uqload/i.test(u)) return 'Uqload';
  if (/vidspeed/i.test(u)) return 'VidSpeed';
  if (/vidmoly/i.test(u)) return 'Vidmoly';
  if (/mp4upload/i.test(u)) return 'Mp4Upload';
  return 'Servidor';
}

module.exports = { scrapeAll };

console.log('[scraper] v4 cargado — Pelisplay → Vimeos → PelisPlusHD → Xpass');
