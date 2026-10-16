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
// ══════════════════════════════════════════════════════════════════════════
// NUEVOS EXTRACTORES
// ══════════════════════════════════════════════════════════════════════════
const { extractFembed }      = require('./extractors/fembed');
const { extractWaaw }        = require('./extractors/waaw');
const { extractWatchSB }     = require('./extractors/watchsb');
const { extractStreamLare }  = require('./extractors/streamlare');

// ══════════════════════════════════════════════════════════════════════════
// Router de extractores: detecta el host y usa el extractor correcto
//
// ORDEN IMPORTANTE:
//  1. Hosts específicos (dominio exacto) ANTES de los genéricos
//  2. Fembed y Waaw comparten grupo → Waaw va primero (más específico)
//  3. FileLions y VidHide comparten grupo → mismo extractor
//  4. OK.ru va antes que otros por el patrón "ok." que podría confundirse
// ══════════════════════════════════════════════════════════════════════════
async function extractStream(embedUrl) {
    if (!embedUrl || !embedUrl.startsWith('http')) return null;

    const url = embedUrl.toLowerCase();

    try {
        // ─── Uqload ────────────────────────────────────────────
        if (/uqload\.(vc|io|com|to|net)/i.test(url)) {
            return await extractUqload(embedUrl);
        }

        // ─── StreamWish (incluye hglink, flaswish, embedwish, wishfast) ──
        if (/streamwish|hglink|flaswish|embedwish|wishfast/i.test(url)) {
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

        // ─── Doodstream ────────────────────────────────────────
        if (/doodstream|dood\.(la|sh|so|pm|to|stream)|d000d/i.test(url)) {
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

        // ═══════════════════════════════════════════════════════
        // NUEVOS HOSTS
        // ═══════════════════════════════════════════════════════

        // ─── Waaw / Netu (antes de Fembed porque comparten endpoints) ───
        if (/waaw\.(to|tv|ac)|netu\.(tv|ac)|hqq\.(tv|to)/i.test(url)) {
            return await extractWaaw(embedUrl);
        }

        // ─── Fembed (todos sus mirrors) ────────────────────────
        if (/fembed\.(com|net|to)|femax20|feurl|fcdn\.stream|dutrag|vanfem/i.test(url)) {
            return await extractFembed(embedUrl);
        }

        // ─── StreamLare ────────────────────────────────────────
        if (/streamlare/i.test(url)) {
            return await extractStreamLare(embedUrl);
        }

        // ─── WatchSB (host caído pero por si revive) ───────────
        if (/watchsb/i.test(url)) {
            return await extractWatchSB(embedUrl);
        }

        console.warn('[extractor] Host no reconocido:', embedUrl);
        return null;
    } catch (e) {
        console.error('[extractor] Error:', e.message);
        return null;
    }
}

module.exports = { extractStream };
