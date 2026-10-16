// api/core/extractors/filelions.js
'use strict';

const { extractStream: puppeteerExtract } = require('../puppeteer-extractor');

/**
 * Extractor para FileLions (y sus mirrors VidHide)
 *
 * FileLions usa JW Player con el m3u8 empaquetado en un Dean Edwards packer.
 * Además está detrás de Cloudflare y usa un TOKEN per-sesión que SOLO se
 * genera al ejecutar el JS del player. Por eso delegamos en Puppeteer.
 *
 * Flujo:
 *   1. Lanza Chromium
 *   2. Resuelve el challenge de Cloudflare
 *   3. Intercepta las peticiones de red y captura el .m3u8 real
 *
 * IMPORTANTE: el m3u8 se sirve desde un dominio distinto al embed
 * (ej: filelions.to → callistanise.com). El referer DEBE ser el origen
 * del stream, no el del embed, o el servidor devuelve 403.
 */
async function extractFileLions(embedUrl) {
  console.log('[filelions] Extrayendo stream de:', embedUrl.slice(0, 90));

  if (!embedUrl) return null;

  // Validación de host: acepta todos los mirrors del grupo
  if (!/filelions|vidhide|minochinos|callistanise|morencius|hgcloud/i.test(embedUrl)) {
    console.warn('[filelions] Host no reconocido');
    return null;
  }

  try {
    // Delegamos en el extractor Puppeteer genérico (mismo que Vimeos)
    const result = await puppeteerExtract(embedUrl);

    if (!result || !result.stream) {
      console.log('[filelions] ⚠️ No se pudo extraer el stream');
      return null;
    }

    // ══════════════════════════════════════════════════════════════
    // FIX CLAVE: el referer debe ser el ORIGEN del stream, no del embed
    //
    // Ejemplo:
    //   embedUrl  = https://filelions.to/v/p8hnvxqx1um7
    //   stream    = https://callistanise.com/stream/.../master.m3u8
    //   referer   = https://callistanise.com/     ← ESTE
    // ══════════════════════════════════════════════════════════════
    let streamReferer = embedUrl;
    try {
      const streamUrl = new URL(result.stream);
      streamReferer = streamUrl.origin + '/';
    } catch (_) {
      // Si el stream no es una URL parseable, usar el embed como fallback
    }

    console.log('[filelions] ✅ Stream encontrado:', result.stream.slice(0, 120));
    console.log('[filelions]    Referer:', streamReferer);

    return {
      stream: result.stream,
      kind: result.kind || 'hls',
      referer: streamReferer,
    };

  } catch (err) {
    console.warn('[filelions] ❌ Error:', err.message);
    return null;
  }
}

module.exports = { extractFileLions };
