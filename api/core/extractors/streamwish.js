// api/core/extractors/streamwish.js
'use strict';

const { extractStream: puppeteerExtract } = require('../puppeteer-extractor');

/**
 * Extractor para StreamWish (y sus mirrors)
 *
 * StreamWish sirve MP4 (no HLS) con TOKEN dinámico por sesión:
 *   https://xxx.premilkyway.com/vp/.../video.mp4?t=<TOKEN>&s=<SESSION>&e=<EXPIRY>
 *
 * El TOKEN se genera en JavaScript, no está en el HTML estático.
 * Además el dominio rota constantemente:
 *   streamwish.to → playnixes.com → niramirus.com → ...
 *
 * Delegamos en puppeteer-extractor.js que:
 *   1. Lanza Chromium
 *   2. Sigue el redirect al mirror activo
 *   3. Intercepta las peticiones de red y captura el .mp4 real
 */
async function extractStreamWish(embedUrl) {
  console.log('[streamwish] Extrayendo stream de:', embedUrl.slice(0, 90));

  if (!embedUrl) return null;

  // Acepta todos los mirrors conocidos
  if (!/streamwish|embedwish|hglink|flaswish|wishfast|playnixes|niramirus|swdyu|swhoi/i.test(embedUrl)) {
    console.warn('[streamwish] Host no reconocido');
    return null;
  }

  try {
    const result = await puppeteerExtract(embedUrl);

    if (!result || !result.stream) {
      console.log('[streamwish] ⚠️ No se pudo extraer el stream');
      return null;
    }

    // ══════════════════════════════════════════════════════════════
    // Referer: usar el del resultado de Puppeteer si existe,
    // sino el origen del embed
    // ══════════════════════════════════════════════════════════════
    let streamReferer = result.referer || null;
    if (!streamReferer) {
      try {
        streamReferer = new URL(embedUrl).origin + '/';
      } catch (_) {
        streamReferer = embedUrl;
      }
    }

    // StreamWish sirve MP4 con token; si no detectamos tipo, inferimos por extensión
    const kind = result.kind
      || (/\.m3u8/i.test(result.stream) ? 'hls' : 'mp4');

    console.log('[streamwish] ✅ Stream encontrado:', result.stream.slice(0, 120));
    console.log('[streamwish]    Kind:', kind);
    console.log('[streamwish]    Referer:', streamReferer);

    return {
      stream: result.stream,
      kind,
      referer: streamReferer,
    };

  } catch (err) {
    console.warn('[streamwish] ❌ Error:', err.message);
    return null;
  }
}

module.exports = { extractStreamWish };
