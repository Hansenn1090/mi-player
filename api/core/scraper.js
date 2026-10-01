// ══════════════════════════════════════════════════════════════════════════
// scraper.js — Servidores ordenados por calidad (mejor primero)
// ══════════════════════════════════════════════════════════════════════════

const axios = require('axios');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function scrapeAll(info, type = 'movie') {
  const servers = { latino: {}, subtitulado: {} };
  const sources = {};

  const tmdbId = (info && info.tmdbId) || '';
  const title = (info && info.title) || '';

  console.log('[scraper] Servidores para TMDB', tmdbId, '—', title);

  if (!tmdbId) {
    return { servers, sources };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ORDEN DE PRIORIDAD (el player carga el PRIMERO que tenga HLS/MP4)
  // ═══════════════════════════════════════════════════════════════════════
  //
  //  🥇 PelixPlay  → MP4 directo, SIN ads (mejor opción)
  //  🥈 Vimeos     → HLS via proxy, casi sin ads
  //  🥉 PelisPlusHD→ Múltiples servidores (requiere scraping)
  //  🏴 Xpass      → HLS con 27s de ads (último recurso)
  //
  // ═══════════════════════════════════════════════════════════════════════

  // 🥇 PELIXPLAY (MP4 directo, sin ads)
  servers.latino['PelixPlay'] = `https://pelixplay.app/embed/embed-final.html?id=${tmdbId}`;
  servers.subtitulado['PelixPlay EN'] = `https://pelixplay.app/embed/embed-final.html?id=${tmdbId}`;

  // 🥈 VIMEOS (HLS via proxy)
  servers.latino['Vimeos'] = `https://vimeos.unlimplay.com/?id=${tmdbId}`;

  // 🥉 PELISPLUSHD (scraping del sitio)
  if (title) {
    try {
      const pelisplusServers = await scrapePelisPlusHD(title, type);
      Object.assign(servers.latino, pelisplusServers);
      sources.pelisplushd = { ok: true, count: Object.keys(pelisplusServers).length };
      console.log('[scraper] PelisPlusHD:', Object.keys(pelisplusServers).length, 'servidores');
    } catch (e) {
      console.warn('[scraper] PelisPlusHD falló:', e.message);
      sources.pelisplushd = { ok: false, error: e.message };
    }
  }

  // 🏴 XPASS (último, tiene ads que filtramos en el extractor)
  servers.latino['Xpass'] = `https://play.xpass.top/e/${type}/${tmdbId}`;
  servers.subtitulado['Xpass EN'] = `https://play.xpass.top/e/${type}/${tmdbId}`;

  console.log('[scraper] Total latino:', Object.keys(servers.latino).length);
  console.log('[scraper] Total subtitulado:', Object.keys(servers.subtitulado).length);

  return { servers, sources };
}

/**
 * Scrapea PelisPlusHD buscando los servidores de una película
 */
async function scrapePelisPlusHD(title, type) {
  const found = {};
  const bases = [
    'https://pelisplushd.la',
    'https://pelisplushd.to',
    'https://pelisplushd.bz',
  ];

  const slug = title.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  for (const base of bases) {
    try {
      const searchUrl = `${base}/search?s=${encodeURIComponent(title)}`;
      const { data: searchHtml } = await axios.get(searchUrl, {
        timeout: 8000,
        headers: { 'User-Agent': UA, 'Referer': base + '/' },
        validateStatus: s => s >= 200 && s < 400,
      });

      // Buscar link de la película
      const regex = new RegExp(`href="(${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/pelicula\\/[^"]+)"`, 'i');
      const match = searchHtml.match(regex);
      if (!match) continue;

      const detailUrl = match[1];
      const { data: detailHtml } = await axios.get(detailUrl, {
        timeout: 8000,
        headers: { 'User-Agent': UA, 'Referer': base },
        validateStatus: s => s >= 200 && s < 400,
      });

      // Buscar iframes de servidores
      const iframeRegex = /<iframe[^>]+src="([^"]+)"/gi;
      let m;
      let count = 0;
      while ((m = iframeRegex.exec(detailHtml)) !== null) {
        let url = m[1];
        if (url.startsWith('//')) url = 'https:' + url;
        if (url.startsWith('/')) url = base + url;
        if (!url.startsWith('http')) continue;

        // Nombre del servidor
        let name = 'Servidor';
        if (/voe\.sx/i.test(url)) name = 'VOE';
        else if (/streamwish|embedwish|hglink/i.test(url)) name = 'StreamWish';
        else if (/vidhide|morencius/i.test(url)) name = 'VidHide';
        else if (/filemoon|moonplayer/i.test(url)) name = 'FileMoon';
        else if (/dood/i.test(url)) name = 'DoodStream';
        else if (/fembed/i.test(url)) name = 'Fembed';
        else if (/vimeos/i.test(url)) name = 'Vimeos';
        else if (/xpass/i.test(url)) name = 'Xpass';
        else name = 'Servidor ' + (++count);

        if (!found[name]) {
          found[name] = url;
        }
      }

      if (Object.keys(found).length > 0) {
        console.log('[scraper] PelisPlusHD (' + base + '):', Object.keys(found).length);
        break;
      }
    } catch (e) {
      console.warn('[scraper] PelisPlusHD', base, 'error:', e.message);
    }
  }

  return found;
}

module.exports = { scrapeAll };

console.log('[scraper] Cargado con prioridad: PelixPlay → Vimeos → PelisPlusHD → Xpass');
