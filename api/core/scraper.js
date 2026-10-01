const axios = require('axios');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function scrapeAll(info, type = 'movie') {
  const servers = { latino: {}, subtitulado: {} };
  const sources = {};

  const tmdbId = (info && info.tmdbId) || '';
  const title = (info && info.title) || '';

  console.log('[scraper] TMDB', tmdbId, '—', title);
  if (!tmdbId) return { servers, sources };

  // 🥇 PELISPLUSHD — Trae VOE, StreamWish, VidHide, FileMoon automáticamente
  if (title) {
    try {
      const pelisplusServers = await scrapePelisPlusHD(title);
      Object.assign(servers.latino, pelisplusServers);
      sources.pelisplushd = { ok: true, count: Object.keys(pelisplusServers).length };
      console.log('[scraper] PelisPlusHD:', Object.keys(pelisplusServers).length, 'servidores');
    } catch (e) {
      console.warn('[scraper] PelisPlusHD falló:', e.message);
    }
  }

  // 🥈 VIMEOS — Fallback siempre
  servers.latino['Vimeos'] = `https://vimeos.unlimplay.com/?id=${tmdbId}`;
  servers.subtitulado['Vimeos EN'] = `https://vimeos.unlimplay.com/?id=${tmdbId}`;

  console.log('[scraper] Total latino:', Object.keys(servers.latino).length);
  return { servers, sources };
}

async function scrapePelisPlusHD(title) {
  const found = {};
  const bases = ['https://pelisplushd.bz', 'https://pelisplushd.la'];

  for (const base of bases) {
    try {
      const { data: searchHtml } = await axios.get(
        `${base}/search?s=${encodeURIComponent(title)}`,
        { timeout: 8000, headers: { 'User-Agent': UA, 'Referer': base + '/' }, validateStatus: s => s >= 200 && s < 400 }
      );

      const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = searchHtml.match(new RegExp(`href="(${escaped}\\/pelicula\\/[^"]+)"`, 'i'));
      if (!match) continue;

      const { data: detailHtml } = await axios.get(match[1], {
        timeout: 8000, headers: { 'User-Agent': UA, 'Referer': base }, validateStatus: s => s >= 200 && s < 400
      });

      const iframeRegex = /<iframe[^>]+src="([^"]+)"/gi;
      let m, count = 0;
      while ((m = iframeRegex.exec(detailHtml)) !== null) {
        let url = m[1];
        if (url.startsWith('//')) url = 'https:' + url;
        if (url.startsWith('/')) url = base + url;
        if (!url.startsWith('http')) continue;
        if (/youtube|googleads|doubleclick|histats|yandex|tagivi|mamshirt/i.test(url)) continue;
        const name = detectName(url) + (count > 0 ? ' ' + (++count) : '');
        if (!found[name]) found[name] = url;
      }
      if (Object.keys(found).length > 0) break;
    } catch (e) {}
  }
  return found;
}

function detectName(url) {
  const u = (url || '').toLowerCase();
  if (/voe\.sx|voe\.de|voe\.bar/i.test(u)) return 'VOE';
  if (/streamwish|embedwish|hglink|filelions|vidhide|morencius/i.test(u)) return 'StreamWish';
  if (/filemoon|moonplayer|byse/i.test(u)) return 'FileMoon';
  if (/dood/i.test(u)) return 'DoodStream';
  if (/vimeos/i.test(u)) return 'Vimeos';
  if (/uqload/i.test(u)) return 'Uqload';
  if (/streamtape/i.test(u)) return 'StreamTape';
  if (/mixdrop/i.test(u)) return 'MixDrop';
  return 'Servidor';
}

module.exports = { scrapeAll };
console.log('[scraper] v9 cargado — PelisPlusHD + Vimeos (sin UnlimPlay)');
