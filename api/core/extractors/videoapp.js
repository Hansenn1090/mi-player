// api/core/extractors/videoapp.js
'use strict';
const axios = require('axios');

async function extractVideoapp(embedUrl) {
    try {
        const baseHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'es-ES,es;q=0.8,en-US;q=0.5,en;q=0.3',
            'Referer': 'https://videoapp.zip/'
        };

        const res = await axios.get(embedUrl, { headers: baseHeaders, timeout: 10000 });
        const html = res.data;

        // 1. DETECTAR SI EL VIDEO NO EXISTE
        if (html.includes('Contenido no disponible') || html.includes('no está disponible')) {
            console.warn(`[videoapp] El video no está disponible en este servidor (ID: ${embedUrl.split('/').pop()})`);
            return null; // Retornamos null para que el registry lo ignore
        }

        // 2. BUSCAR EL IFRAME
        const iframeMatch = html.match(/<iframe[^>]+src="([^"]*vimeos\.net[^"]+)"/i);
        
        if (!iframeMatch) {
            console.warn('[videoapp] No se encontró el iframe de vimeos.net en el HTML.');
            return null;
        }

        const vimeosUrl = iframeMatch[1];

        // 3. PEDIR EL M3U8 A VIMEOS
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

        // Si vimeos está pero no hay m3u8, lo ignoramos también
        return null;

    } catch (error) {
        console.error('[videoapp] Error crítico:', error.message);
        return null;
    }
}

module.exports = { extractVideoapp };
