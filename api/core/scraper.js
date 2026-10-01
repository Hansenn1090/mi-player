// ══════════════════════════════════════════════════════════════════════════
// scraper.js — Autocontenido, nunca crashea
// ══════════════════════════════════════════════════════════════════════════

async function scrapeAll(info, type = 'movie') {
  const servers = { latino: {}, subtitulado: {} };
  const sources = {};

  const tmdbId = (info && info.tmdbId) || '';

  console.log('[scraper] Construyendo servidores para TMDB', tmdbId);

  if (!tmdbId) {
    console.warn('[scraper] Sin tmdbId — devolviendo vacío');
    return { servers, sources };
  }

  // Servidores directos
  const directServers = [
    { lang: 'latino', name: 'Xpass', url: `https://play.xpass.top/e/${type}/${tmdbId}` },
    { lang: 'latino', name: 'PelixPlay', url: `https://pelixplay.app/embed/embed-final.html?id=${tmdbId}` },
    { lang: 'latino', name: 'Vimeos', url: `https://vimeos.unlimplay.com/?id=${tmdbId}` },
    { lang: 'subtitulado', name: 'Xpass EN', url: `https://play.xpass.top/e/${type}/${tmdbId}` },
  ];

  for (const srv of directServers) {
    if (!servers[srv.lang]) servers[srv.lang] = {};
    servers[srv.lang][srv.name] = srv.url;
  }

  sources.direct = { ok: true, count: directServers.length };

  console.log('[scraper] latino:', Object.keys(servers.latino).length);
  console.log('[scraper] subtitulado:', Object.keys(servers.subtitulado).length);

  return { servers, sources };
}

module.exports = { scrapeAll };

console.log('[scraper] Cargado');
