// api/core/extractors/videoapp.js
'use strict';
const axios = require('axios');

async function extractVideoapp(embedUrl) {
    try {
        const baseHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'es-ES,es;q=0.8,en-US;q=0.5,en;q=0.3'
        };

        // 1. Entrar a videoapp.zip para obtener el iframe con el token fresco
        console.log(`[videoapp] Obteniendo iframe de: ${embedUrl}`);
        const res = await axios.get(embedUrl, { headers: baseHeaders, timeout: 10000 });
        
        // 2. Buscar el iframe de vimeos.net
        const iframeMatch = res.data.match(/<iframe[^>]+src="([^"]*vimeos\.net[^"]+)"/i);
        if (!iframeMatch) {
            console.warn('[videoapp] No se encontró el iframe de vimeos.net');
            return { url: embedUrl, isIframe: true };
        }

        const vimeosUrl = iframeMatch[1];

        // 3. Entrar a vimeos.net pasando el Referer correcto
        console.log(`[videoapp] Extrayendo video de: ${vimeosUrl}`);
        const vimeosRes = await axios.get(vimeosUrl, {
            headers: {
                ...baseHeaders,
                'Referer': 'https://videoapp.zip/'
            },
            timeout: 10000
        });

        const vimeosHtml = vimeosRes.data;

        // 4. Buscar el enlace .m3u8 o .mp4
        // Buscamos la etiqueta "file" o "source" típica de vimeos
        const m3u8Match = vimeosHtml.match(/"(https?:\/\/[^"]+?\.(?:m3u8|mp4)[^"]*)"/i) ||
                          vimeosHtml.match(/file\s*:\s*["'](https?:\/\/[^"']+?\.(?:m3u8|mp4)[^"']*)["']/i);

        if (m3u8Match) {
            console.log(`[videoapp] ✅ Enlace directo encontrado: ${m3u8Match[1]}`);
            return {
                url: m3u8Match[1],
                referer: 'https://vimeos.net/',
                server: 'Videoapp (Vimeos Directo)'
            };
        }

        // 5. Fallback: Si no encontramos el .m3u8, devolvemos el iframe de vimeos
        console.warn('[videoapp] No se encontró M3U8 directo. Devolviendo iframe de vimeos.');
        return { 
            url: vimeosUrl, 
            referer: 'https://videoapp.zip/', 
            isIframe: true 
        };

    } catch (error) {
        console.error('[videoapp] Error crítico:', error.message);
        return { url: embedUrl, isIframe: true };
    }
}

module.exports = { extractVideoapp };
