// api/core/extractors/moviemaster.js
'use strict';
const axios = require('axios');

async function extractMoviemaster(embedUrl) {
    try {
        const cleanEmbedUrl = embedUrl.split('&pass=')[0];
        const urlObj = new URL(cleanEmbedUrl);
        
        const passUrl = urlObj.searchParams.get('pass') || '';
        const refererUrl = urlObj.searchParams.get('referer') || 'https://cinehaxplus.com/';
        const tmdbId = urlObj.pathname.split('/').pop();
        const lang = urlObj.searchParams.get('lang') || 'LAT';

        const baseHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'es-ES,es;q=0.8,en-US;q=0.5,en;q=0.3'
        };

        let cookies = [];

        const collectCookies = (headers) => {
            if (headers && headers['set-cookie']) {
                headers['set-cookie'].forEach(c => {
                    const cookieStr = c.split(';')[0];
                    if (!cookies.includes(cookieStr)) cookies.push(cookieStr);
                });
            }
        };

        const pageRes = await axios.get(refererUrl, { headers: baseHeaders, validateStatus: false, timeout: 10000 });
        collectCookies(pageRes.headers);

        if (passUrl) {
            const passRes = await axios.get(passUrl, { headers: { ...baseHeaders, 'Cookie': cookies.join('; '), 'Referer': refererUrl }, validateStatus: false, timeout: 10000 });
            collectCookies(passRes.headers);
        }

        const embedRes = await axios.get(cleanEmbedUrl, {
            headers: { ...baseHeaders, 'Cookie': cookies.join('; '), 'Referer': refererUrl, 'Origin': 'https://cinehaxplus.com' },
            validateStatus: false,
            timeout: 10000
        });

        // FIX: Convertir a string si la respuesta no lo es
        const html = typeof embedRes.data === 'string' ? embedRes.data : JSON.stringify(embedRes.data);

        const m3u8Regex = /(https?:\/\/[^"']+\.m3u8[^"']*)/i;
        const m3u8Match = html.match(m3u8Regex);
        if (m3u8Match) {
            return { url: m3u8Match[1], referer: refererUrl, server: 'Cinehax Directo' };
        }

        const apiUrl = `https://api-encrypted.moviemaster.lat/api/play/${tmdbId}?lang=${lang}`;
        const apiRes = await axios.get(apiUrl, {
            headers: { ...baseHeaders, 'Cookie': cookies.join('; '), 'Referer': refererUrl, 'Origin': 'https://cinehaxplus.com', 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, text/plain, */*' },
            validateStatus: false,
            timeout: 10000
        });

        if (apiRes.data) {
            if (typeof apiRes.data === 'object' && apiRes.data.url) {
                return { url: apiRes.data.url, referer: refererUrl, server: 'Cinehax API' };
            }
            const apiDataStr = typeof apiRes.data === 'string' ? apiRes.data : JSON.stringify(apiRes.data);
            const apiM3u8Match = apiDataStr.match(m3u8Regex);
            if (apiM3u8Match) {
                return { url: apiM3u8Match[1], referer: refererUrl, server: 'Cinehax API' };
            }
        }

        console.warn('[moviemaster] No se pudo extraer el M3U8. Devolviendo iframe como fallback.');
        return { url: cleanEmbedUrl, referer: refererUrl, isIframe: true };

    } catch (error) {
        console.error('[moviemaster] Error crítico:', error.message);
        return null;
    }
}

module.exports = { extractMoviemaster };
