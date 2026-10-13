const { extractStreamWish } = require('./extractors/streamwish');
const { extractVidmoly } = require('./extractors/vidmoly');
const { extractFileLions } = require('./extractors/filelions');
const { extractVimeos } = require('./extractors/vimeos');
const { extractDoodstream } = require('./extractors/doodstream'); // NUEVO
const { extractMixdrop } = require('./extractors/mixdrop'); // NUEVO
const { extractStreamtape } = require('./extractors/streamtape'); // NUEVO
const { extractVoe } = require('./extractors/voe'); // NUEVO
const { extractFilemoon } = require('./extractors/filemoon'); // NUEVO
const { extractOkru } = require('./extractors/okru'); // NUEVO
const { extractPowvideo } = require('./extractors/powvideo'); // NUEVO
const { extractStreamplay } = require('./extractors/streamplay'); // NUEVO
// ... importa los demás

async function extractStream(embedUrl) {
    if (!embedUrl || !embedUrl.startsWith('http')) return null;
    const url = embedUrl.toLowerCase();
    try {
        if (/streamwish|hglink|flaswish|embedwish/i.test(url)) return await extractStreamWish(embedUrl);
        if (/vidmoly/i.test(url)) return await extractVidmoly(embedUrl);
        if (/filelions|vidhide|minochinos|callistanise|morencius/i.test(url)) return await extractFileLions(embedUrl);
        if (/vimeos\.net/i.test(url)) return await extractVimeos(embedUrl);
        if (/doodstream|dood\.la|dood\.stream/i.test(url)) return await extractDoodstream(embedUrl); // NUEVO
        if (/mixdrop|mxdrop/i.test(url)) return await extractMixdrop(embedUrl); // NUEVO
        if (/streamtape|stape/i.test(url)) return await extractStreamtape(embedUrl); // NUEVO
        if (/voe\.sx|voe\.de/i.test(url)) return await extractVoe(embedUrl);
        if (/filemoon/i.test(url)) return await extractFilemoon(embedUrl);
        if (/okru|ok\.ru/i.test(url)) return await extractOkru(embedUrl);
        if (/powvideo/i.test(url)) return await extractPowvideo(embedUrl);
        if (/streamplay/i.test(url)) return await extractStreamplay(embedUrl);
        // ... añade los demás
        console.warn('[extractor] Host no reconocido:', embedUrl);
        return null;
    } catch (e) {
        console.error('[extractor] Error:', e.message);
        return null;
    }
}
module.exports = { extractStream };
