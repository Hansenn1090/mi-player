// api/core/extractors/moviemaster.js
'use strict';
const axios = require('axios');

async function extractMoviemaster(embedUrl) {
    try {
        // 1. Limpiamos la URL y extraemos los parámetros
        const cleanEmbedUrl = embedUrl.split('&pass=')[0];
        const urlObj = new URL(cleanEmbedUrl);
        
        // Si el provider pasó el referer, lo usamos. Si no, usamos la página principal.
        const passUrl = urlObj.searchParams.get('pass') || '';
        const refererUrl = urlObj.searchParams.get('referer') || 'https://cinehaxplus.com/';
        const tmdbId = urlObj.pathname.split('/').pop(); // Ej: 1423191
        const lang = urlObj.searchParams.get('lang') || 'LAT';

        // 2. Configuración de headers base (Simulando un navegador real)
        const baseHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'es-ES,es;q=0.8,en-US;q=0.5,en;q=0.3'
        };

        let cookies = [];

        // Función auxiliar para guardar las cookies que nos envíe el servidor
        const collectCookies = (headers) => {
            if (headers && headers['set-cookie']) {
                headers['set-cookie'].forEach(c => {
                    const cookieStr = c.split(';')[0];
                    // Evitamos duplicados
                    if (!cookies.includes(cookieStr)) cookies.push(cookieStr);
                });
            }
        };

        // PASO 1: Visitar la página principal de la película en Cinehax para obtener cookies base
        const pageRes = await axios.get(refererUrl, { 
            headers: baseHeaders, 
            validateStatus: false,
            timeout: 10000 
        });
        collectCookies(pageRes.headers);

        // PASO 2: Visitar el endpoint "player-pass" para validar el token
        if (passUrl) {
            const passRes = await axios.get(passUrl, { 
                headers: { 
                    ...baseHeaders, 
                    'Cookie': cookies.join('; '), 
                    'Referer': refererUrl 
                }, 
                validateStatus: false,
                timeout: 10000 
            });
            collectCookies(passRes.headers);
        }

        // PASO 3: Entrar al iframe del reproductor CON las cookies obtenidas
        const embedRes = await axios.get(cleanEmbedUrl, {
            headers: { 
                ...baseHeaders, 
                'Cookie': cookies.join('; '), 
                'Referer': refererUrl,
                'Origin': 'https://cinehaxplus.com'
            },
            validateStatus: false,
            timeout: 10000
        });

        const html = embedRes.data;

        // 4. Intentar extraer el .m3u8 del HTML del iframe
        const m3u8Regex = /(https?:\/\/[^"']+\.m3u8[^"']*)/i;
        const m3u8Match = html.match(m3u8Regex);
        if (m3u8Match) {
            return { 
                url: m3u8Match[1], 
                referer: refererUrl, 
                server: 'Cinehax Directo' 
            };
        }

        // 5. Si no está en el HTML, usar la API interna (como vimos en el mp-config)
        const apiUrl = `https://api-encrypted.moviemaster.lat/api/play/${tmdbId}?lang=${lang}`;
        const apiRes = await axios.get(apiUrl, {
            headers: { 
                ...baseHeaders, 
                'Cookie': cookies.join('; '), 
                'Referer': refererUrl,
                'Origin': 'https://cinehaxplus.com',
                'X-Requested-With': 'XMLHttpRequest',
                'Accept': 'application/json, text/plain, */*'
            },
            validateStatus: false,
            timeout: 10000
        });

        // 6. Procesar la respuesta de la API
        if (apiRes.data) {
            if (typeof apiRes.data === 'object' && apiRes.data.url) {
                return { 
                    url: apiRes.data.url, 
                    referer: refererUrl, 
                    server: 'Cinehax API' 
                };
            }
            // Por si la API devuelve texto plano con el m3u8
            const apiM3u8Match = typeof apiRes.data === 'string' ? apiRes.data.match(m3u8Regex) : null;
            if (apiM3u8Match) {
                return { 
                    url: apiM3u8Match[1], 
                    referer: refererUrl, 
                    server: 'Cinehax API' 
                };
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
