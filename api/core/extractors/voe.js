const { extractStream: puppeteerExtract } = require('../puppeteer-extractor');

async function extractVoe(embedUrl) {
    console.log('[voe] Extrayendo stream de:', embedUrl);
    try {
        // VOE carga el stream dinámicamente, por lo que Puppeteer es ideal.
        const result = await puppeteerExtract(embedUrl);
        if (result && result.stream) {
            return {
                stream: result.stream,
                kind: 'hls', // VOE suele servir HLS (.m3u8)
                referer: embedUrl
            };
        }
        return null;
    } catch (err) {
        console.warn('[voe] Error:', err.message);
        return null;
    }
}
module.exports = { extractVoe };
