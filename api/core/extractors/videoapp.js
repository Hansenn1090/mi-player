// api/core/extractors/videoapp.js
'use strict';
const axios = require('axios');

async function extractVideoapp(embedUrl) {
    try {
        const baseHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'es-ES,es;q=0.8,en-US;q=0.5,en;q=0.3',
            'Referer': 'https://videoapp.zip/' // Referer importante
        };

        // 1. Petición a videoapp.zip
        const res = await axios.get(embedUrl, { headers: baseHeaders, timeout: 10000 });
        
        // 2. Búsqueda más flexible: cualquier iframe que contenga "vimeos.net"
        const iframeMatch = res.data.match(/<iframe[^>]+src="([^"]*vimeos\.net[^"]+)"/i);
        
        if (!iframeMatch) {
            console.warn('[videoapp] No se encontró el iframe de vimeos.net en el HTML.');
            // Fallback: Devolver la URL original como iframe si no hay otra opción
            return { url: embedUrl, isIframe: true };
        }

        const vimeosUrl = iframeMatch[1];
        console.log(`[videoapp] Iframe encontrado: ${vimeosUrl}`);

        // 3. Petición a vimeos.net para extraer el .m3u8
        const vimeosRes = await axios.get(vimeosUrl, {
            headers: { ...baseHeaders, 'Referer': 'https://videoapp.zip/' },
            timeout: 10000
        });

        const m3u8Match = vimeosRes.data.match(/"file":"(https?:\/\/[^"]+?\.m3u8[^"]*)"/i) || 
                          vimeosRes.data.match(/"(https?:\/\/[^"]+?\.m3u8[^"]*)"/i);

        if (m3u8Match) {
            return {
                url: m3u8Match[1],
                referer: 'https://vimeos.net/',
                server: 'Videoapp (Vimeos Directo)'
            };
        }

        // Si no hay .m3u8, devolver el iframe como respaldo
        console.warn('[videoapp] No se encontró el .m3u8. Devolviendo iframe.');
        return { url: vimeosUrl, referer: 'https://videoapp.zip/', isIframe: true };

    } catch (error) {
        console.error('[videoapp] Error crítico:', error.message);
        return { url: embedUrl, isIframe: true };
    }
}

module.exports = { extractVideoapp };
