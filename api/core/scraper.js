// ══════════════════════════════════════════════════════════════════════════
// scraper.js — v12
//   Prioridad: Pelispedia → PelisPlusHD → Xpass
// ══════════════════════════════════════════════════════════════════════════

const axios = require('axios');
const { scrapePelispedia } = require('../providers/pelispedia');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function scrapeAll(info, type = 'movie') {
  const servers = { latino: {}, subtitulado: {} };
  const sources = {};

  const tmdbId = (info && info.tmdbId) || '';
  const title = (info && info.title) || '';
  const year = (info && info.year) || '';

  console.log('[scraper] TMDB', tmdbId, '—', title, year);
  if (!tmdbId && !title) return { servers, sources };

  // 🥇 PELISPEDIA — Vimeos, VOE, StreamWish, VidHide, etc.
  if (title) {
    try {
      const pelispediaServers = await scrapePelispedia(title, year, type);
      for (const lang of Object.keys(pelispediaServers)) {
        if (!servers[lang]) servers[lang] = {};
        Object.assign(servers[lang], pelispediaServers[lang]);
      }
      const total = Object.values(pelispediaServers).reduce((a, s) => a + Object.keys(s).length, 0);
      sources.pelispedia = { ok: true, count: total };
      console.log('[scraper] Pelispedia:', total, 'servidores');
    } catch (e) {
      console.warn('[scraper] Pelispedia falló:', e.message);
      sources.pelispedia = { ok: false, error: e.message };
    }
  }

  // 🥈 PELISPLUSHD — Fallback si Pelispedia no trae nada
  if (title && Object.keys(servers.latino).length === 0) {
    try {
      const pelisplusServers = await scrapePelisPlusHD(title);
      Object.assign(servers.latino, pelisplusServers);
      sources.pelisplushd = { ok: true, count: Object.keys(pelisplusServers).length };
      console.log('[scraper] PelisPlusHD:', Object.keys(pelisplusServers).length, 'servidores');
    } catch (e) {
      sources.pelisplushd = { ok: false, error: e.message };
    }
  }

  // 🥉 XPASS — Último recurso
  if (tmdbId && Object.keys(servers.latino).length === 0) {
    servers.latino['Xpass'] = `https://play.xpass.top/e/${type}/${tmdbId}`;
    servers.subtitulado['Xpass EN'] = `https://play.xpass.top/e/${type}/${tmdbId}`;
    console.log('[scraper] Fallback a Xpass');
  }

  console.log('[scraper] Total latino:', Object.keys(servers.latino).length);
  console.log('[scraper] Total subtitulado:', Object.keys(servers.subtitulado).length);

  return { servers, sources };
}

// ══════════════════════════════════════════════════════════════════════════
// PELISPLUSHD — fallback
// ══════════════════════════════════════════════════════════════════════════
async function scrapePelisPlusHD(title) {
  const found = {};
  const bases = ['https://pelisplushd.bz', 'https://pelisplushd.la'];

  for (const base of bases) {
    try {
      const { data: searchHtml } = await axios.get(
        `${base}/search?s=${encodeURIComponent(title)}`,
        {
          timeout: 8000,
          headers: { 'User-Agent': UA, 'Referer': base + '/' },
          validateStatus: s => s >= 200 && s < 400,
        }
      );

      const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = searchHtml.match(new RegExp(`href="(${escaped}\\/pelicula\\/[^"]+)"`, 'i'));
      if (!match) continue;

      const { data: detailHtml } = await axios.get(match[1], {
        timeout: 8000,
        headers: { 'User-Agent': UA, 'Referer': base },
        validateStatus: s => s >= 200 && s < 400,
      });

      const iframeRegex = /<iframe[^>]+src="([^"]+)"/gi;
      let m, count = 0;
      while ((m = iframeRegex.exec(detailHtml)) !== null) {
        let url = m[1];
        if (url.startsWith('//')) url = 'https:' + url;
        if (url.startsWith('/')) url = base + url;
        if (!url.startsWith('http')) continue;
        if (/youtube|googleads|doubleclick|histats|yandex|tagivi|mamshirt|embed69/i.test(url)) continue;
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
  if (/voe\.sx|voe\.de|voe\.bar|voe\.net/i.test(u)) return 'VOE';
  if (/streamwish|embedwish|hglink|filelions|vidhide|morencius/i.test(u)) return 'StreamWish';
  if (/filemoon|moonplayer|byse/i.test(u)) return 'FileMoon';
  if (/dood/i.test(u)) return 'DoodStream';
  if (/vimeos/i.test(u)) return 'Vimeos';
  if (/xpass/i.test(u)) return 'Xpass';
  if (/uqload/i.test(u)) return 'Uqload';
  return 'Servidor';
}

module.exports = { scrapeAll };
console.log('[scraper] v12 cargado — Pelispedia + PelisPlusHD + Xpass');
