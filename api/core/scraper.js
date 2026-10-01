// ══════════════════════════════════════════════════════════════════════════
// scraper.js — v8
//   Orden: UnlimPlay → Vimeos (fallback)
// ══════════════════════════════════════════════════════════════════════════

const { scrapeUnlimplay } = require('../providers/unlimplay');

async function scrapeAll(info, type = 'movie') {
  const servers = { latino: {}, subtitulado: {} };
  const sources = {};

  const tmdbId = (info && info.tmdbId) || '';
  const title = (info && info.title) || '';

  console.log('[scraper] TMDB', tmdbId, '—', title);
  if (!tmdbId) return { servers, sources };

  // 🥇 UNLIMPLAY — Extrae los servidores vía Puppeteer
  try {
    const unlimplayServers = await scrapeUnlimplay(tmdbId, type);
    for (const lang of Object.keys(unlimplayServers)) {
      if (!servers[lang]) servers[lang] = {};
      Object.assign(servers[lang], unlimplayServers[lang]);
    }
    const total = Object.values(unlimplayServers).reduce((a, s) => a + Object.keys(s).length, 0);
    sources.unlimplay = { ok: true, count: total };
    console.log('[scraper] UnlimPlay:', total, 'servidores');
  } catch (e) {
    console.warn('[scraper] UnlimPlay falló:', e.message);
    sources.unlimplay = { ok: false, error: e.message };
  }

  // 🥈 VIMEOS — Fallback siempre disponible
  if (!Object.keys(servers.latino).length) {
    servers.latino['Vimeos'] = `https://vimeos.unlimplay.com/?id=${tmdbId}`;
    console.log('[scraper] Solo Vimeos disponible');
  } else {
    // Añadir Vimeos también si hay otros servidores
    servers.latino['Vimeos'] = `https://vimeos.unlimplay.com/?id=${tmdbId}`;
  }

  // Subtitulado (usar Vimeos como fallback)
  if (!Object.keys(servers.subtitulado).length) {
    servers.subtitulado['Vimeos EN'] = `https://vimeos.unlimplay.com/?id=${tmdbId}`;
  }

  console.log('[scraper] Total latino:', Object.keys(servers.latino).length);
  console.log('[scraper] Total subtitulado:', Object.keys(servers.subtitulado).length);

  return { servers, sources };
}

module.exports = { scrapeAll };

console.log('[scraper] v8 cargado — UnlimPlay + Vimeos');
