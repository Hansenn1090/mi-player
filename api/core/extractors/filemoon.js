const { extractStream: puppeteerExtract } = require('../puppeteer-extractor');

async function extractFilemoon(embedUrl) {
    console.log('[filemoon] Extrayendo stream de:', embedUrl);
    try {
        const result = await puppeteerExtract(embedUrl);
        if (result && result.stream) {
            return {
                stream: result.stream,
                kind: 'hls', // Filemoon suele servir HLS (.m3u8)
                referer: embedUrl
            };
        }
        return null;
    } catch (err) {
        console.warn('[filemoon] Error:', err.message);
        return null;
    }
}
module.exports = { extractFilemoon };
