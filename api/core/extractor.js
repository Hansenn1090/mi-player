const { extractStreamWish } = require('./extractors/streamwish');
const { extractVidmoly } = require('./extractors/vidmoly');
const { extractFileLions } = require('./extractors/filelions');

// ══════════════════════════════════════════════════════════════════════════
// Router de extractores: detecta el host y usa el extractor correcto
// ══════════════════════════════════════════════════════════════════════════
async function extractStream(embedUrl) {
  if (!embedUrl || !embedUrl.startsWith('http')) return null;

  const url = embedUrl.toLowerCase();

  try {
    if (/streamwish|hglink|flaswish|embedwish/i.test(url)) {
      return await extractStreamWish(embedUrl);
    }
    if (/vidmoly/i.test(url)) {
      return await extractVidmoly(embedUrl);
    }
    if (/filelions|vidhide|minochinos|callistanise|morencius/i.test(url)) {
      return await extractFileLions(embedUrl);
    }

    console.warn('[extractor] Host no reconocido:', embedUrl);
    return null;
  } catch (e) {
    console.error('[extractor] Error:', e.message);
    return null;
  }
}

module.exports = { extractStream };
