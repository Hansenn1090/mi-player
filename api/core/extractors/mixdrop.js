const axios = require('axios');
const cheerio = require('cheerio');

async function extractMixdrop(embedUrl) {
    try {
        // 1. Obtener el HTML del embed
        const response = await axios.get(embedUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        });
        const html = response.data;
        const $ = cheerio.load(html);

        // 2. Buscar la URL del video en el código JavaScript
        const scriptContent = $('script').map((i, el) => $(el).html()).get().join('\n');
        // Buscar patrones comunes: "MDCore.wurl" o "wurl" en variables
        const urlMatch = scriptContent.match(/MDCore\.wurl\s*=\s*["']([^"']+)["']/);
        if (urlMatch) {
            let url = urlMatch[1];
            if (url.startsWith('//')) url = 'https:' + url;
            return { stream: url, kind: 'mp4', referer: embedUrl };
        }

        // A veces la URL está en una variable distinta
        const genericMatch = scriptContent.match(/wurl\s*=\s*["']([^"']+)["']/);
        if (genericMatch) {
            let url = genericMatch[1];
            if (url.startsWith('//')) url = 'https:' + url;
            return { stream: url, kind: 'mp4', referer: embedUrl };
        }

        return null;
    } catch (err) {
        console.warn('[mixdrop] Error:', err.message);
        return null;
    }
}
module.exports = { extractMixdrop };
