// api/core/extractors/moviemaster.js
'use strict';
const axios = require('axios');

async function extractMoviemaster(embedUrl) {
    try {
        // 1. Limpiar la URL base (quitar cualquier pass viejo que venga en la URL)
        const cleanUrl = embedUrl.split('&pass=')[0];
        const urlObj = new URL(cleanUrl);
        
        // 2. Extraer el TMDB ID y el idioma de la URL
        const pathParts = urlObj.pathname.split('/');
        const tmdbId = pathParts[pathParts.length - 1]; // Ej: 27205
        const lang = urlObj.searchParams.get('lang') || 'LAT';

        // 3. Crear sesión con headers de navegador real (importante para evitar bloqueos)
        const session = axios.create({
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
                'Referer': 'https://cinehaxplus.com/',
                'Origin': 'https://cinehaxplus.com',
                'Accept': '*/*'
            }
        });

        // 4. VISITAR LA PÁGINA ORIGINAL PARA OBTENER EL TOKEN FRESCO
        // Construimos la URL de la película en Cinehax (ej: /pelicula/origen-2010)
        // Como el provider ya nos dio la URL del iframe, usamos el TMDB ID para buscarla.
        // Pero lo más seguro es ir a la página de búsqueda o usar el ID.
        // Para este caso, asumimos que podemos obtener el token desde la página del reproductor.
        
        // NOTA: El token viene en el HTML de la página, no en el iframe.
        // Vamos a la página principal de Cinehax a buscar la película.
        // (Esto lo hace el provider, pero aquí lo hacemos para asegurar un token fresco).
        
        // 5. Obtener el token fresco desde la página de la película
        // Simulamos que ya tenemos la URL de la página, pero como no la tenemos,
        // vamos a intentar obtener el token directamente del endpoint del player.
        // El endpoint es: https://cinehaxplus.com/api/player-pass?t=movie:27205:xxxx
        
        // Como no podemos saber el token sin la página, el provider debe pasarlo.
        // Si el provider ya lo pasó, lo usamos. Si no, fallback.
        
        // MEJOR ESTRATEGIA: Usar el endpoint de la API interna que descubrimos en el HTML.
        // El HTML tiene: "papi":"https://api-encrypted.moviemaster.lat"
        // "api":"/api/play/"
        
        // Vamos a intentar llamar directamente a la API de reproducción sin pasar por el iframe.
        // La API de reproducción suele ser: {papi}/api/play/{tmdbId}?lang={lang}
        
        const papi = 'https://api-encrypted.moviemaster.lat';
        const apiUrl = `${papi}/api/play/${tmdbId}?lang=${lang}`;
        
        // Hacemos la petición a la API interna (esto suele devolver el m3u8 directo)
        const apiRes = await session.get(apiUrl);
        
        if (apiRes.data && apiRes.data.url) {
            return {
                url: apiRes.data.url,
                referer: 'https://cinehaxplus.com/',
                server: 'Cinehax (API)'
            };
        }
        
        // 6. Si la API falla, intentamos extraer el m3u8 del HTML del iframe
        const res = await session.get(cleanUrl);
        const m3u8Match = res.data.match(/(https?:\/\/[^"']+\.m3u8[^"']*)/);
        
        if (m3u8Match) {
            return {
                url: m3u8Match[1],
                referer: 'https://cinehaxplus.com/',
                server: 'Cinehax (Directo)'
            };
        }

        // 7. Si todo falla, devolvemos el iframe para que el frontend lo maneje
        return { url: cleanUrl, referer: 'https://cinehaxplus.com/', isIframe: true };

    } catch (error) {
        console.error('[moviemaster] Error:', error.message);
        return null;
    }
}

module.exports = { extractMoviemaster };
