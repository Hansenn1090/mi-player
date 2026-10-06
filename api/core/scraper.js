const { scrapePelispedia } = require('../providers/pelispedia');
const { scrapePelisPlusHD } = require('../providers/pelisplushd');

async function scrapeAll(info, type = 'movie') {
  const servers = { latino: {}, subtitulado: {} };
  const sources = {};

  const tmdbId = (info && info.tmdbId) || '';
  const title = (info && info.title) || '';
  const year = (info && info.year) || '';

  console.log('[scraper] TMDB', tmdbId, '—', title, year);

  // 🥇 PELISPEDIA
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

  // 🥈 PELISPLUSHD
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

  // 🥉 XPASS (Fallback garantizado: siempre se ejecuta si los anteriores fallan o no dan resultados)
  if (tmdbId && Object.keys(servers.latino).length === 0) {
    servers.latino['Xpass'] = `https://play.xpass.top/e/${type}/${tmdbId}`;
    servers.subtitulado['Xpass EN'] = `https://play.xpass.top/e/${type}/${tmdbId}`;
    sources.xpass = { ok: true, count: 2 };
    console.log('[scraper] Usando fallback de Xpass');
  }

  console.log('[scraper] Total latino:', Object.keys(servers.latino).length);
  console.log('[scraper] Total subtitulado:', Object.keys(servers.subtitulado).length);

  return { servers, sources };
}

module.exports = { scrapeAll };
