// ══════════════════════════════════════════════════════════════════════════
// core/extractors/cinemaos.js
// Extrae el manifiesto DASH (.mpd) y subtítulos (.vtt) desde CinemaOS
// Usa allorigins como puente para saltar el bloqueo de Cloudflare
// ══════════════════════════════════════════════════════════════════════════

const doFetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const BASE = 'https://cinemaos.tech';

// Lista de proxies públicos — si uno falla, intenta el siguiente
const PROXIES = [
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
];

async function fetchHtml(targetUrl) {
  let lastError = null;

  // 1) Intento directo (con headers de navegador)
  try {
    const res = await doFetch(targetUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
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
    lastError = `Directo → ${res.status}`;
  } catch (e) {
    lastError = `Directo → ${e.message}`;
  }

  // 2) Fallback: usar proxies públicos
  for (const buildProxy of PROXIES) {
    try {
      const proxyUrl = buildProxy(targetUrl);
      const res = await doFetch(proxyUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        redirect: 'follow',
      });
      if (res.ok) {
        const html = await res.text();
        // Verificar que sea HTML válido y no una página de error
        if (html && html.length > 1000) return html;
      }
      lastError = `Proxy → ${res.status}`;
    } catch (e) {
      lastError = `Proxy → ${e.message}`;
    }
  }

  throw new Error(`Todos los intentos fallaron: ${lastError}`);
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

  // 3) Subtítulos
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
