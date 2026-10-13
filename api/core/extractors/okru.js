const axios = require('axios');
const cheerio = require('cheerio');

async function extractOkru(embedUrl) {
    try {
        const { data: html } = await axios.get(embedUrl, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'https://ok.ru/'
            }
        });
        // OKru expone las URLs de video directamente en el HTML en formato JSON
        const match = html.match(/data-options="([^"]+)"/);
        if (match) {
            const options = JSON.parse(match[1].replace(/&quot;/g, '"'));
            if (options.flashvars && options.flashvars.metadata) {
                const metadata = JSON.parse(options.flashvars.metadata);
                // Buscar la URL de video en los datos
                const videoUrl = metadata.videoUrl || metadata.url;
                if (videoUrl) return { stream: videoUrl, kind: 'mp4', referer: embedUrl };
            }
        }
        return null;
    } catch (err) {
        console.warn('[okru] Error:', err.message);
        return null;
    }
}
module.exports = { extractOkru };
