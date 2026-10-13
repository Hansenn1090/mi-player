const { extractStream: puppeteerExtract } = require('../puppeteer-extractor');

async function extractPowvideo(embedUrl) {
    console.log('[powvideo] Extrayendo stream de:', embedUrl);
    try {
        // Powvideo requiere interacción (clics) para cargar el video.
        // Puppeteer con la configuración adecuada puede manejarlo.
        const result = await puppeteerExtract(embedUrl);
        if (result && result.stream) {
            return {
                stream: result.stream,
                kind: 'mp4', // Powvideo suele servir MP4 directo
                referer: embedUrl
            };
        }
        return null;
    } catch (err) {
        console.warn('[powvideo] Error:', err.message);
        return null;
    }
}
module.exports = { extractPowvideo };
