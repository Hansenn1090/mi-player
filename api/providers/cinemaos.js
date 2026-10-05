// ══════════════════════════════════════════════════════════════════════════
// providers/cinemaos.js
// Provider que envuelve el extractor de CinemaOS
// ══════════════════════════════════════════════════════════════════════════

const { extractCinemaOS } = require('../core/extractors/cinemaos');

async function getCinemaOSServers(tmdbId, type = 'movie') {
  try {
    const { mpd, subtitles } = await extractCinemaOS(tmdbId, type);
    if (!mpd) return { servers: {} };

    return {
      servers: {
        CinemaOS: {
          url: mpd,
          kind: 'dash',
          subtitles,
        },
      },
    };
  } catch (err) {
    console.error('[cinemaos provider]', err.message);
    return { servers: {} };
  }
}

module.exports = { getCinemaOSServers };
