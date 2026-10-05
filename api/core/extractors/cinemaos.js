// ══════════════════════════════════════════════════════════════════════════
// core/extractors/cinemaos.js
// Extrae el manifiesto DASH (.mpd) y subtítulos (.vtt) desde CinemaOS
// ══════════════════════════════════════════════════════════════════════════

const doFetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const BASE = 'https://cinemaos.tech';

async function extractCinemaOS(tmdbId, type = 'movie') {
  const url = `${BASE}/player/${tmdbId}?theme=ffffff&autoPlay=true&title=false`;

  const res = await doFetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/122.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
    },
    redirect: 'follow',
  });

  if (!res.ok) throw new Error(`CinemaOS respondió ${res.status}`);

  const html = await res.text();

  // 1) Manifest DASH (.mpd)
  const mpdMatch = html.match(/<source\s+src="([^"]+\.mpd)"/);
  const mpd = mpdMatch ? mpdMatch[1] : null;

  // 2) scrapeToken (por si se necesita)
  const tokenMatch = html.match(/"scrapeToken":"([^"]+)"/);
  const token = tokenMatch ? tokenMatch[1] : null;

  // 3) Subtítulos (.vtt con label y srclang)
  const subs = [];
  const tracks = html.match(/<track\b[^>]*>/g) || [];
  for (const tag of tracks) {
    const src = (tag.match(/src="([^"]+)"/) || [])[1];
    const label = (tag.match(/label="([^"]+)"/) || [])[1];
    const lang = (tag.match(/srclang="([^"]+)"/) || [])[1];
    if (src && label) subs.push({ url: src, label, lang: lang || 'en' });
  }

  return { mpd, subtitles: subs, token };
}

module.exports = { extractCinemaOS };
