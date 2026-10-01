const axios = require('axios');
const { scrapeUnlimplay } = require('../providers/unlimplay');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function scrapeAll(info, type = 'movie') {
  const servers = { latino: {}, subtitulado: {} };
  const sources = {};

  const tmdbId = (info && info.tmdbId) || '';
  const title = (info && info.title) || '';

  console.log('[scraper] TMDB', tmdbId, '—', title);
  if (!tmdbId) return { servers, sources };

  // 🥇 UNLIMPLAY
  try {
    const unlimplayServers = await scrapeUnlimplay(tmdbId, type);
    for (const lang of Object.keys(unlimplayServers)) {
      if (!servers[lang]) servers[lang] = {};
      Object.assign(servers[lang], unlimplayServers[lang]);
    }
    sources.unlimplay = { 
      ok: true, 
      count: Object.values(unlimplayServers).reduce((a, s) => a + Object.keys(s).length, 0)
    };
  } catch (e) {
    console.warn('[scraper] UnlimPlay falló:', e.message);
    sources.unlimplay = { ok: false, error: e.message };
  }

  // 🥈 VIMEOS (fallback)
  if (!Object.keys(servers.latino).length) {
    servers.latino['Vimeos'] = `https://vimeos.unlimplay.com/?id=${tmdbId}`;
  }

  console.log('[scraper] latino:', Object.keys(servers.latino).length);
  console.log('[scraper] subtitulado:', Object.keys(servers.subtitulado).length);

  return { servers, sources };
}

module.exports = { scrapeAll };

console.log('[scraper] v7 cargado — UnlimPlay primero + Vimeos fallback');
