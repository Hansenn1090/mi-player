// api/core/extractor.js
const { extractStreamWish } = require('./extractors/streamwish');
const { extractVidmoly } = require('./extractors/vidmoly');
const { extractFileLions } = require('./extractors/filelions');
const { extractVimeos } = require('./extractors/vimeos'); // ← NUEVO

// ══════════════════════════════════════════════════════════════════════════
// Router de extractores: detecta el host y usa el extractor correcto
// ══════════════════════════════════════════════════════════════════════════
async function extractStream(embedUrl) {
  if (!embedUrl || !embedUrl.startsWith('http')) return null;

  const url = embedUrl.toLowerCase();

  try {
    // ─── StreamWish ────────────────────────────────────────────────
    if (/streamwish|hglink|flaswish|embedwish/i.test(url)) {
      return await extractStreamWish(embedUrl);
    }

    // ─── Vidmoly ───────────────────────────────────────────────────
    if (/vidmoly/i.test(url)) {
      return await extractVidmoly(embedUrl);
    }

    // ─── FileLions / VidHide ───────────────────────────────────────
    if (/filelions|vidhide|minochinos|callistanise|morencius/i.test(url)) {
      return await extractFileLions(embedUrl);
    }

    // ─── Vimeos ────────────────────────────────────────────────────
    if (/vimeos\.net/i.test(url)) {
      return await extractVimeos(embedUrl);
    }

    console.warn('[extractor] Host no reconocido:', embedUrl);
    return null;
  } catch (e) {
    console.error('[extractor] Error:', e.message);
    return null;
  }
}

module.exports = { extractStream };
