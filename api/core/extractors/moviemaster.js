// api/core/extractors/moviemaster.js
'use strict';
const axios = require('axios');

async function extractMoviemaster(embedUrl) {
    try {
        // 1. Extraer la URL base y el token (pass) que nos envió el provider
        const urlObj = new URL(embedUrl);
        const passUrl = urlObj.searchParams.get('pass');
        
        // Limpiamos la URL del iframe (quitando el parámetro &pass= que le agregamos)
        const cleanEmbedUrl = embedUrl.split('&pass=')[0];

        // 2. Configurar una sesión con headers reales (User-Agent de navegador)
        const session = axios.create({
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
                'Referer': 'https://cinehaxplus.com/',
                'Origin': 'https://cinehaxplus.com'
            },
            withCredentials: true // Importante para manejar cookies
        });

        let cookies = '';

        // 3. PASO CLAVE: Visitar el player-pass para obtener la cookie de autorización
        if (passUrl) {
            console.log('[moviemaster] Obteniendo cookie de sesión desde player-pass...');
            const passRes = await session.get(passUrl);
            
            // Extraer las cookies que nos devuelve el servidor
            if (passRes.headers['set-cookie']) {
                cookies = passRes.headers['set-cookie'].join('; ');
                console.log('[moviemaster] ✅ Cookie obtenida');
            }
        }

        // 4. Entrar al iframe del reproductor CON la cookie de sesión
        console.log('[moviemaster] Accediendo al iframe con la cookie...');
        const res = await session.get(cleanEmbedUrl, {
            headers: cookies ? { 'Cookie': cookies } : {}
        });

        // 5. Buscar el archivo .m3u8 en el HTML resultante
        const m3u8Match = res.data.match(/(https?:\/\/[^"']+\.m3u8[^"']*)/);
        
        if (m3u8Match) {
            return { 
                url: m3u8Match[1], 
                referer: 'https://cinehaxplus.com/',
                server: 'Cinehax (Directo)'
            };
        }

        // 6. Si no está el .m3u8 directo, intentar extraer la configuración de la API
        // El reproductor a veces carga un JSON con la URL del video
        const apiConfigMatch = res.data.match(/"api":"([^"]+)"/);
        const papiMatch = res.data.match(/"papi":"([^"]+)"/);
        
        if (apiConfigMatch && papiMatch) {
            const tmdbId = urlObj.pathname.split('/').pop();
            const lang = urlObj.searchParams.get('lang') || 'LAT';
            // La ruta correcta a menudo incluye el ID del video y el idioma
            const apiUrl = `${papiMatch[1]}${apiConfigMatch[1]}${tmdbId}?lang=${lang}`;
            
            console.log(`[moviemaster] Probando API interna: ${apiUrl}`);
            const apiRes = await session.get(apiUrl, { 
                headers: cookies ? { 'Cookie': cookies } : {} 
            });
            
            if (apiRes.data && apiRes.data.url) {
                return { 
                    url: apiRes.data.url, 
                    referer: 'https://cinehaxplus.com/',
                    server: 'Cinehax (API)'
                };
            }
        }

        // 7. Si nada funciona, devolver el iframe limpio (el frontend podría manejarlo)
        return { url: cleanEmbedUrl, referer: 'https://cinehaxplus.com/', isIframe: true };

    } catch (error) {
        console.error('[moviemaster] Error:', error.message);
        return null;
    }
}

module.exports = { extractMoviemaster };
