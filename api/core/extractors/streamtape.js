const axios = require('axios');
const cheerio = require('cheerio');

async function extractStreamtape(embedUrl) {
    try {
        const { data: html } = await axios.get(embedUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        const $ = cheerio.load(html);
        
        // Buscar el patrón de Streamtape en los scripts
        // Ejemplo: document.getElementById('ideoolink').innerHTML = ...
        let videoUrl = null;
        $('script').each((i, el) => {
            const content = $(el).html();
            const match = content.match(/document\.getElementById\('ideoolink'\)\.innerHTML\s*=\s*(.*?);/);
            if (match) {
                // Se necesita limpiar y reconstruir la URL, ya que a veces está ofuscada
                const raw = match[1].replace(/["']/g, '').trim();
                if (raw.startsWith('//')) videoUrl = 'https:' + raw;
                else if (raw.startsWith('http')) videoUrl = raw;
                return false;
            }
        });

        if (videoUrl) return { stream: videoUrl, kind: 'mp4', referer: embedUrl };
        return null;
    } catch (err) {
        console.warn('[streamtape] Error:', err.message);
        return null;
    }
}
module.exports = { extractStreamtape };
