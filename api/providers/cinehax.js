// Ruta: api/providers/cinehax.js
const axios = require('axios');

const BASE_URL = 'https://cinehaxplus.com';
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

async function extract(url) {
    try {
        // 1. Obtener el HTML de la página
        const { data: html } = await axios.get(url, {
            headers: { 
                'User-Agent': USER_AGENT, 
                'Accept-Language': 'es-ES,es;q=0.9' 
            }
        });

        // 2. Extraer TMDB ID
        const tmdbMatch = html.match(/themoviedb\.org\/movie\/(\d+)/);
        const tmdbId = tmdbMatch ? tmdbMatch[1] : null;

        // 3. Extraer el token (pass)
        const passMatch = html.match(/data-pass="([^"]+)"/);
        let passUrl = null;
        if (passMatch) {
            const rawPass = passMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
            passUrl = rawPass.startsWith('http') ? rawPass : `${BASE_URL}${rawPass}`;
        }

        // 4. Extraer los iframes (servidores)
        const embeds = [...html.matchAll(/data-embed="([^"]+)"/g)];
        const servers = [];
        const vistos = new Set();

        for (const match of embeds) {
            // Decodificar HTML entities
            let embedHtml = match[1]
                .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"').replace(/&amp;/g, '&');

            const srcMatch = embedHtml.match(/src="([^"]+)"/);
            if (srcMatch) {
                const srcUrl = srcMatch[1];
                
                // Ignorar el tráiler de YouTube y duplicados
                if (!srcUrl.includes('youtube') && !vistos.has(srcUrl)) {
                    vistos.add(srcUrl);
                    const langMatch = srcUrl.match(/lang=([A-Z]{3})/);
                    
                    servers.push({
                        name: 'Cinehax',
                        lang: langMatch ? langMatch[1] : 'LAT',
                        url: srcUrl,
                        type: 'embed', // Le decimos a tu core que esto necesita Puppeteer
                        tmdbId: tmdbId,
                        pass: passUrl
                    });
                }
            }
        }

        return servers;

    } catch (error) {
        console.error("[Provider: Cinehax] Error:", error.message);
        return [];
    }
}

module.exports = { extract };
