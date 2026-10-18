// api/core/extractors/playpelis.js
'use strict';
const axios = require('axios');

async function extractPlaypelis(embedUrl) {
    try {
        // 1. Limpiamos la URL del iframe (por si tiene parámetros extra)
        const cleanUrl = embedUrl.split('&')[0] + '&' + embedUrl.split('&')[1] + '&' + embedUrl.split('&')[2];
        
        const session = axios.create({
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
                'Referer': 'https://playpelis.net/',
                'Origin': 'https://playpelis.net'
            }
        });

        // 2. Entrar al iframe para buscar el .m3u8
        const res = await session.get(cleanUrl, { timeout: 10000, validateStatus: false });
        const html = res.data;

        // 3. Buscar el archivo .m3u8 o un enlace directo
        const m3u8Match = html.match(/(https?:\/\/[^"']+\.m3u8[^"']*)/i);
        if (m3u8Match) {
            return { 
                url: m3u8Match[1], 
                referer: 'https://playpelis.net/',
                server: 'Playpelis (Directo)'
            };
        }

        // 4. Si no hay .m3u8, buscar enlaces a servidores externos (streamwish, filemoon, etc.)
        // Playpelis a veces redirige a otros hosts. Buscamos el patrón de iframe interno.
        const iframeMatch = html.match(/src="(https?:\/\/[^"']*(?:streamwish|filemoon|vidhide|voe|dood)[^"']*)"/i);
        if (iframeMatch) {
            return { 
                url: iframeMatch[1], 
                referer: 'https://playpelis.net/',
                server: 'Playpelis (Externo)'
            };
        }

        // 5. FALLBACK: Si no encontramos nada, devolvemos el iframe original.
        // Tu frontend puede renderizar este iframe directamente.
        console.warn('[playpelis] No se encontró M3U8. Devolviendo iframe como fallback.');
        return { 
            url: embedUrl, 
            referer: 'https://playpelis.net/', 
            isIframe: true 
        };

    } catch (error) {
        console.error('[playpelis] Error:', error.message);
        return null;
    }
}

module.exports = { extractPlaypelis };
