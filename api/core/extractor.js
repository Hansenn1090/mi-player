const { extractStreamWish } = require('./extractors/streamwish');
const { extractVidmoly } = require('./extractors/vidmoly');
const { extractFileLions } = require('./extractors/filelions');
const { extractVimeos } = require('./extractors/vimeos');
const { extractDoodstream } = require('./extractors/doodstream'); // NUEVO
const { extractMixdrop } = require('./extractors/mixdrop'); // NUEVO
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
        // ... añade los demás
        console.warn('[extractor] Host no reconocido:', embedUrl);
        return null;
    } catch (e) {
        console.error('[extractor] Error:', e.message);
        return null;
    }
}
module.exports = { extractStream };
