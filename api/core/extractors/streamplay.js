const axios = require('axios');
const cheerio = require('cheerio');

async function extractStreamplay(embedUrl) {
    try {
        const { data: html } = await axios.get(embedUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        const $ = cheerio.load(html);
        let videoUrl = null;
        
        // Buscar en el código JS la URL del video
        $('script').each((i, el) => {
            const content = $(el).html();
            const match = content.match(/file\s*:\s*["']([^"']+)["']/);
            if (match) {
                videoUrl = match[1];
                return false;
            }
        });

        if (videoUrl) return { stream: videoUrl, kind: 'mp4', referer: embedUrl };
        return null;
    } catch (err) {
        console.warn('[streamplay] Error:', err.message);
        return null;
    }
}
module.exports = { extractStreamplay };
