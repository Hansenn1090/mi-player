// api/core/extractors/playpelis.js
'use strict';
const axios = require('axios');

async function extractPlaypelis(embedUrl) {
    try {
        const session = axios.create({
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
                'Referer': 'https://playpelis.net/',
                'Origin': 'https://playpelis.net'
            }
        });

        // Pedimos el HTML del iframe
        const res = await session.get(embedUrl, { timeout: 10000, validateStatus: false });
        const html = res.data;

        if (typeof html !== 'string') {
            return { url: embedUrl, referer: 'https://playpelis.net/', isIframe: true };
        }

        // 1. Buscar un iframe anidado dentro del embed
        // Playpelis a veces redirige a un servidor externo con la etiqueta <iframe src="...">
        const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
        
        if (iframeMatch) {
            const innerUrl = iframeMatch[1];
            // Si el iframe interno apunta a un servidor conocido, lo devolvemos para que tu enrutador lo resuelva
            if (innerUrl.includes('streamwish') || innerUrl.includes('filemoon') || innerUrl.includes('vidhide') || innerUrl.includes('voe') || innerUrl.includes('dood') || innerUrl.includes('mixdrop')) {
                return { 
                    url: innerUrl, 
                    referer: 'https://playpelis.net/',
                    server: 'Playpelis (Externo)'
                };
            }
        }

        // 2. Buscar el archivo .m3u8 o mp4 directamente en el código
        const m3u8Match = html.match(/(https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)/i);
        if (m3u8Match) {
            return { 
                url: m3u8Match[1], 
                referer: 'https://playpelis.net/',
                server: 'Playpelis (Directo)'
            };
        }

        // 3. Fallback: si no encuentra nada, devuelve el iframe original (para que el frontend lo muestre)
        console.warn('[playpelis] No se encontró M3U8 ni iframe interno. Devolviendo iframe original.');
        return { 
            url: embedUrl, 
            referer: 'https://playpelis.net/', 
            isIframe: true 
        };

    } catch (error) {
        console.error('[playpelis] Error:', error.message);
        return { url: embedUrl, referer: 'https://playpelis.net/', isIframe: true };
    }
}

module.exports = { extractPlaypelis };
