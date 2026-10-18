// api/core/extractors/playpelis.js
'use strict';
const axios = require('axios');

async function extractPlaypelis(embedUrl) {
    try {
        // Pedimos el iframe simulando un navegador real
        const res = await axios.get(embedUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'es-ES,es;q=0.8,en-US;q=0.5,en;q=0.3',
                'Referer': 'https://playpelis.net/',
                'Origin': 'https://playpelis.net'
            },
            timeout: 10000,
            validateStatus: false // Para que no explote si da error 403 o 404
        });

        // DEBUG: Ver en los logs qué está pasando
        console.log(`[playpelis] Status de respuesta: ${res.status}`);
        const html = typeof res.data === 'string' ? res.data : '';
        console.log(`[playpelis] Longitud del HTML recibido: ${html.length} caracteres`);

        if (res.status !== 200 || html.length < 500) {
            console.warn('[playpelis] El servidor bloqueó la petición o devolvió una página vacía.');
            return { url: embedUrl, referer: 'https://playpelis.net/', isIframe: true };
        }

        // 1. Buscar enlace directo .m3u8 o .mp4
        const m3u8Match = html.match(/(https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)/i);
        if (m3u8Match) {
            return { url: m3u8Match[1], referer: 'https://playpelis.net/', server: 'Playpelis (Directo)' };
        }

        // 2. Buscar iframe interno (StreamWish, Filemoon, etc.)
        const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
        if (iframeMatch) {
            const innerUrl = iframeMatch[1];
            if (/streamwish|filemoon|vidhide|voe|dood|mixdrop/i.test(innerUrl)) {
                return { url: innerUrl, referer: 'https://playpelis.net/', server: 'Playpelis (Externo)' };
            }
        }

        // 3. Fallback: Devolver iframe original
        return { url: embedUrl, referer: 'https://playpelis.net/', isIframe: true };

    } catch (error) {
        console.error('[playpelis] Error crítico:', error.message);
        return { url: embedUrl, referer: 'https://playpelis.net/', isIframe: true };
    }
}

module.exports = { extractPlaypelis };
