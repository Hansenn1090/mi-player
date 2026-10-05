// ══════════════════════════════════════════════════════════════════════════
// core/extractors/cinemaos.js
// Usa fetch nativo de Node 18+ (sin dependencias externas)
// ══════════════════════════════════════════════════════════════════════════

const BASE = 'https://cinemaos.tech';

// ⚠️ Después de crear tu Cloudflare Worker, pega aquí la URL
// Por ahora lo dejamos vacío — el extractor funciona igual (con 403 de CinemaOS)
const CF_WORKER = '';

async function fetchHtml(targetUrl) {
  // 1) Intento directo con headers de navegador real
  try {
    const res = await fetch(targetUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept':
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
      },
      redirect: 'follow',
    });

    if (res.ok) return await res.text();
    console.warn(`[cinemaos] directo → ${res.status}, intentando Worker...`);
  } catch (e) {
    console.warn('[cinemaos] directo falló:', e.message);
  }

  // 2) Fallback: usar Cloudflare Worker (si está configurado)
  if (CF_WORKER) {
    try {
      const workerUrl = `${CF_WORKER}/?url=${encodeURIComponent(targetUrl)}`;
      const res = await fetch(workerUrl, { redirect: 'follow' });
      if (res.ok) return await res.text();
      throw new Error(`Worker respondió ${res.status}`);
    } catch (e) {
      throw new Error(`Worker falló: ${e.message}`);
    }
  }

  throw new Error('CinemaOS respondió 403');
}

async function extractCinemaOS(tmdbId, type = 'movie') {
  const targetUrl = `${BASE}/player/${tmdbId}?theme=ffffff&autoPlay=true&title=false`;
  const html = await fetchHtml(targetUrl);

  // 1) Manifest DASH (.mpd)
  const mpdMatch = html.match(/<source\s+src="([^"]+\.mpd)"/);
  const mpd = mpdMatch ? mpdMatch[1] : null;

  // 2) scrapeToken
  const tokenMatch = html.match(/"scrapeToken":"([^"]+)"/);
  const token = tokenMatch ? tokenMatch[1] : null;

  // 3) Subtítulos (.vtt)
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
