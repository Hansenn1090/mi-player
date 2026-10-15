// api/core/extractor.js
const { extractStreamWish } = require('./extractors/streamwish');
const { extractVidmoly } = require('./extractors/vidmoly');
const { extractFileLions } = require('./extractors/filelions');
const { extractVimeos } = require('./extractors/vimeos');
const { extractDoodstream } = require('./extractors/doodstream');
const { extractMixdrop } = require('./extractors/mixdrop');
const { extractStreamtape } = require('./extractors/streamtape');
const { extractVoe } = require('./extractors/voe');
const { extractFilemoon } = require('./extractors/filemoon');
const { extractOkru } = require('./extractors/okru');
const { extractPowvideo } = require('./extractors/powvideo');
const { extractStreamplay } = require('./extractors/streamplay');
const { extractUqload } = require('./extractors/uqload');  // ← NUEVO

// ══════════════════════════════════════════════════════════════════════════
// Router de extractores: detecta el host y usa el extractor correcto
// ══════════════════════════════════════════════════════════════════════════
async function extractStream(embedUrl) {
    if (!embedUrl || !embedUrl.startsWith('http')) return null;

    const url = embedUrl.toLowerCase();

    try {
        // ─── Uqload (NUEVO) ────────────────────────────────────
        if (/uqload\.(vc|io|com|to|net)/i.test(url)) {
            return await extractUqload(embedUrl);
        }

        // ─── StreamWish (incluye hglink, flaswish, embedwish) ──
        if (/streamwish|hglink|flaswish|embedwish/i.test(url)) {
            return await extractStreamWish(embedUrl);
        }

        // ─── Vidmoly ───────────────────────────────────────────
        if (/vidmoly/i.test(url)) {
            return await extractVidmoly(embedUrl);
        }

        // ─── FileLions (incluye vidhide, morencius) ────────────
        if (/filelions|vidhide|minochinos|callistanise|morencius/i.test(url)) {
            return await extractFileLions(embedUrl);
        }

        // ─── Vimeos ────────────────────────────────────────────
        if (/vimeos\.net/i.test(url)) {
            return await extractVimeos(embedUrl);
        }

        // ─── Doodstream ────────────────────────────────────────
        if (/doodstream|dood\.la|dood\.stream|dood\.sh|d000d/i.test(url)) {
            return await extractDoodstream(embedUrl);
        }

        // ─── Mixdrop ───────────────────────────────────────────
        if (/mixdrop|mxdrop/i.test(url)) {
            return await extractMixdrop(embedUrl);
        }

        // ─── Streamtape ────────────────────────────────────────
        if (/streamtape|stape/i.test(url)) {
            return await extractStreamtape(embedUrl);
        }

        // ─── VOE ───────────────────────────────────────────────
        if (/voe\.sx|voe\.de|voe\.bar|voe\.net|voe\.to/i.test(url)) {
            return await extractVoe(embedUrl);
        }

        // ─── Filemoon ──────────────────────────────────────────
        if (/filemoon|moonplayer|byse/i.test(url)) {
            return await extractFilemoon(embedUrl);
        }

        // ─── OkRu ──────────────────────────────────────────────
        if (/okru|ok\.ru/i.test(url)) {
            return await extractOkru(embedUrl);
        }

        // ─── Powvideo ──────────────────────────────────────────
        if (/powvideo/i.test(url)) {
            return await extractPowvideo(embedUrl);
        }

        // ─── Streamplay ────────────────────────────────────────
        if (/streamplay/i.test(url)) {
            return await extractStreamplay(embedUrl);
        }

        console.warn('[extractor] Host no reconocido:', embedUrl);
        return null;
    } catch (e) {
        console.error('[extractor] Error:', e.message);
        return null;
    }
}

module.exports = { extractStream };
