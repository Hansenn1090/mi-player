// api/core/extractors/moviemaster.js
'use strict';
const axios = require('axios');

async function extractMoviemaster(embedUrl) {
    try {
        // 1. Separar la URL base del "pass" que le agregamos en el provider
        const urlObj = new URL(embedUrl);
        const passUrl = urlObj.searchParams.get('pass');
        const cleanEmbedUrl = embedUrl.split('&pass=')[0];

        // Creamos una sesión para mantener las cookies (necesario para el pass)
        const session = axios.create({
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
                'Referer': 'https://cinehaxplus.com/',
                'Origin': 'https://cinehaxplus.com'
            }
        });

        let cookies = '';

        // 2. Si hay un pass, lo visitamos para obtener la cookie de autorización
        if (passUrl) {
            const passRes = await session.get(passUrl);
            if (passRes.headers['set-cookie']) {
                cookies = passRes.headers['set-cookie'].join('; ');
            }
        }

        // 3. Entrar al iframe con la cookie ya validada
        const res = await session.get(cleanEmbedUrl, {
            headers: cookies ? { 'Cookie': cookies } : {}
        });

        // 4. Buscar el archivo .m3u8 en el HTML
        const m3u8Match = res.data.match(/(https?:\/\/[^"']+\.m3u8[^"']*)/);
        
        if (m3u8Match) {
            return { 
                url: m3u8Match[1], 
                referer: 'https://cinehaxplus.com/',
                server: 'Cinehax (Directo)'
            };
        }

        // 5. Si no encontramos el .m3u8 directo (porque lo genera un JS), 
        // intentamos buscar la API de reproducción que usa su reproductor.
        // En el código original vimos que usan: /api/play/
        const apiMatch = res.data.match(/"api":"([^"]+)"/);
        const papiMatch = res.data.match(/"papi":"([^"]+)"/);
        
        if (apiMatch && papiMatch) {
            // Hacemos la petición a su API interna para pedir el video
            const apiUrl = `${papiMatch[1]}${apiMatch[1]}${urlObj.pathname.split('/').pop()}?lang=${urlObj.searchParams.get('lang') || 'LAT'}`;
            const apiRes = await session.get(apiUrl, { headers: cookies ? { 'Cookie': cookies } : {} });
            
            if (apiRes.data && apiRes.data.url) {
                return { 
                    url: apiRes.data.url, 
                    referer: 'https://cinehaxplus.com/',
                    server: 'Cinehax (API)'
                };
            }
        }

        console.warn('[moviemaster] No se encontró el archivo .m3u8 en el HTML.');
        // Si todo falla, devolvemos el iframe original para que tu frontend decida qué hacer
        return { url: cleanEmbedUrl, referer: 'https://cinehaxplus.com/', isIframe: true };

    } catch (error) {
        console.error('[moviemaster] Error:', error.message);
        return null;
    }
}

module.exports = { extractMoviemaster };
