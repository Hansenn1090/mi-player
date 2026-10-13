// api/core/extractors/vimeos.js
const { extractStream: puppeteerExtract } = require('../puppeteer-extractor');

/**
 * Extractor para Vimeos.net
 * Usa Puppeteer para interceptar la petición del manifiesto HLS (.m3u8)
 * que hace el reproductor de Vimeos al cargar el video.
 */
async function extractVimeos(embedUrl) {
    console.log('[vimeos] Extrayendo stream de:', embedUrl);

    if (!embedUrl || !embedUrl.includes('vimeos.net')) {
        return null;
    }

    try {
        // Reutilizamos el extractor de Puppeteer que ya tienes
        // Él se encarga de interceptar las peticiones de red y encontrar el .m3u8
        const result = await puppeteerExtract(embedUrl);

        if (result && result.stream) {
            console.log('[vimeos] ✅ Stream encontrado:', result.stream.slice(0, 100));
            return {
                stream: result.stream,
                kind: 'hls', // Vimeos usa HLS
                referer: embedUrl,
            };
        }

        console.log('[vimeos] ⚠️ No se pudo extraer el stream');
        return null;

    } catch (err) {
        console.warn('[vimeos] ❌ Error:', err.message);
        return null;
    }
}

module.exports = { extractVimeos };
