// api/core/extractor.js
'use strict';

const { extractStreamWish }  = require('./extractors/streamwish');
const { extractVidmoly }     = require('./extractors/vidmoly');
const { extractFileLions }   = require('./extractors/filelions');
const { extractVimeos }      = require('./extractors/vimeos');
const { extractDoodstream }  = require('./extractors/doodstream');
const { extractMixdrop }     = require('./extractors/mixdrop');
const { extractStreamtape }  = require('./extractors/streamtape');
const { extractVoe }         = require('./extractors/voe');
const { extractFilemoon }    = require('./extractors/filemoon');
const { extractOkru }        = require('./extractors/okru');
const { extractPowvideo }    = require('./extractors/powvideo');
const { extractStreamplay }  = require('./extractors/streamplay');
const { extractUqload }      = require('./extractors/uqload');
const { extractFembed }      = require('./extractors/fembed');
const { extractWaaw }        = require('./extractors/waaw');
const { extractWatchSB }     = require('./extractors/watchsb');
const { extractStreamLare }  = require('./extractors/streamlare');
const { extractFastream }    = require('./extractors/fastream'); // ← NUEVO

async function extractStream(embedUrl) {
    if (!embedUrl || !embedUrl.startsWith('http')) return null;

    const url = embedUrl.toLowerCase();

    try {
        // ─── Uqload ────────────────────────────────────────────
        if (/uqload\.(vc|io|com|to|net)/i.test(url)) {
            return await extractUqload(embedUrl);
        }

        // ─── StreamWish (incluye hglink, flaswish, embedwish) ──
        if (/streamwish|hglink|flaswish|embedwish|wishfast|playnixes|niramirus/i.test(url)) {
            return await extractStreamWish(embedUrl);
        }

        // ─── Vidmoly ───────────────────────────────────────────
        if (/vidmoly/i.test(url)) {
            return await extractVidmoly(embedUrl);
        }

        // ─── FileLions (incluye vidhide, morencius, filelions.to) ──
        if (/filelions|vidhide|minochinos|callistanise|morencius|hgcloud/i.test(url)) {
            return await extractFileLions(embedUrl);
        }

        // ─── Vimeos ────────────────────────────────────────────
        if (/vimeos\.net/i.test(url)) {
            return await extractVimeos(embedUrl);
        }

        // ─── Doodstream (incluye playmogo) ─────────────────────
        if (/doodstream|dood\.(la|sh|so|pm|to|stream)|d000d|playmogo/i.test(url)) {
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
        if (/voe\.(sx|de|bar|net|to)/i.test(url)) {
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

        // ─── Waaw / Netu ───────────────────────────────────────
        if (/waaw\.(to|tv|ac)|netu\.(tv|ac)|hqq\.(tv|to)/i.test(url)) {
            return await extractWaaw(embedUrl);
        }

        // ─── Fembed ────────────────────────────────────────────
        if (/fembed\.(com|net|to)|femax20|feurl|fcdn\.stream|dutrag|vanfem/i.test(url)) {
            return await extractFembed(embedUrl);
        }

        // ─── StreamLare ────────────────────────────────────────
        if (/streamlare/i.test(url)) {
            return await extractStreamLare(embedUrl);
        }

        // ─── WatchSB ───────────────────────────────────────────
        if (/watchsb/i.test(url)) {
            return await extractWatchSB(embedUrl);
        }

        // ═══════════════════════════════════════════════════════
        // ─── Fastream (NUEVO) ──────────────────────────────────
        // ═══════════════════════════════════════════════════════
        if (/fastream/i.test(url)) {
            return await extractFastream(embedUrl);
        }

        console.warn('[extractor] Host no reconocido:', embedUrl);
        return null;
    } catch (e) {
        console.error('[extractor] Error:', e.message);
        return null;
    }
}

module.exports = { extractStream };
