// api/core/extractors/uqload.js
/**
 * Uqload.vc / Uqload.io — Extractor de MP4 directo
 *
 * Uqload sirve MP4 directo, y la URL del archivo está embebida en el
 * JavaScript del reproductor. No requiere Puppeteer.
 *
 * URLs conocidas:
 *   https://uqload.vc/embed-XXXXX.html
 *   https://uqload.io/embed-XXXXX.html
 *   https://uqload.com/embed-XXXXX.html
 *   https://uqload.to/embed-XXXXX.html
 *
 * El archivo final está en:
 *   https://sXX.uqload.io/v/XXXXX.mp4
 */

const axios = require('axios');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function extractUqload(embedUrl) {
  if (!embedUrl || !/uqload/i.test(embedUrl)) return null;

  console.log('[uqload] Extrayendo:', embedUrl);

  try {
    const { data: html } = await axios.get(embedUrl, {
      timeout: 12000,
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        'Referer': embedUrl,
      },
      validateStatus: s => s >= 200 && s < 400,
      maxRedirects: 5,
    });

    // ─── Patrón 1: sources: [{file: "..."}] ────────────────────
    const patterns = [
      /sources\s*:\s*\[\s*\{\s*file\s*:\s*["']([^"']+\.mp4[^"']*)["']/i,
      /sources\s*:\s*\[\s*\{\s*src\s*:\s*["']([^"']+\.mp4[^"']*)["']/i,
      /file\s*:\s*["']([^"']+\.mp4[^"']*)["']/i,
      /src\s*:\s*["']([^"']+\.mp4[^"']*)["']/i,
    ];

    let mp4Url = null;
    for (const re of patterns) {
      const m = html.match(re);
      if (m && m[1]) {
        mp4Url = m[1];
        break;
      }
    }

    // ─── Patrón 2: URL directa a uqload.io/v/ o uqload.vc/v/ ───
    if (!mp4Url) {
      const direct = html.match(/https?:\/\/s\d+\.uqload\.[a-z]+\/v\/[^"'\s<>]+\.mp4[^"'\s<>]*/i);
      if (direct) mp4Url = direct[0];
    }

    // ─── Patrón 3: URL con dominio uqload.io ───────────────────
    if (!mp4Url) {
      const uqMatch = html.match(/https?:\/\/[^"'\s<>]*uqload\.[a-z]+\/[^"'\s<>]*\.mp4[^"'\s<>]*/i);
      if (uqMatch) mp4Url = uqMatch[0];
    }

    if (!mp4Url) {
      console.warn('[uqload] ⚠️ No se encontró MP4 en el HTML');
      return null;
    }

    // Normalizar URL
    if (mp4Url.startsWith('//')) mp4Url = 'https:' + mp4Url;
    if (!mp4Url.startsWith('http')) mp4Url = 'https://' + mp4Url;

    console.log('[uqload] ✅ MP4:', mp4Url.slice(0, 100));

    return {
      stream: mp4Url,
      kind: 'mp4',
      referer: embedUrl,
    };

  } catch (err) {
    console.warn('[uqload] Error:', err.message);
    return null;
  }
}

module.exports = { extractUqload };
