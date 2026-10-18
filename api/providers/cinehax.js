// api/providers/cinehax.js
'use strict';

const axios = require('axios');

const BASE_URL = 'https://cinehaxplus.com';
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

// Convierte "Spider-Man: Homecoming" a "spider-man-homecoming"
function slugify(text) {
    return text.toString().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Quita acentos
        .replace(/[^a-z0-9 -]/g, '')                      // Quita símbolos
        .trim().replace(/\s+/g, '-');                     // Espacios a guiones
}

async function extract(title, year, id, type, lang) {
    try {
        const slug = slugify(title);
        const pathType = (type === 'tv' || type === 'serie') ? 'serie' : 'pelicula';
        let pageUrl = `${BASE_URL}/${pathType}/${slug}-${year}`;

        // 1. Intentar acceder directamente por la URL predecible
        let { data: html, status } = await axios.get(pageUrl, {
            headers: { 'User-Agent': USER_AGENT },
            validateStatus: false // Evita que axios arroje error si es 404
        });

        // 2. Si da 404, usar el buscador interno de Cinehax
        if (status === 404 || !html.includes('data-embed')) {
            console.log(`[cinehax] URL directa falló. Buscando "${title}"...`);
            const searchRes = await axios.get(`${BASE_URL}/search?q=${encodeURIComponent(title)}`, { 
                headers: { 'User-Agent': USER_AGENT } 
            });
            
            // Buscar el primer enlace del resultado que coincida con el título
            const match = searchRes.data.match(new RegExp(`href="([^"]*${slug}[^"]*)"`));
            if (match) {
                pageUrl = match[1].startsWith('http') ? match[1] : `${BASE_URL}${match[1]}`;
                const res = await axios.get(pageUrl, { headers: { 'User-Agent': USER_AGENT } });
                html = res.data;
            } else {
                return null; // No se encontró la película
            }
        }

        // 3. Extraer los iframes del HTML (Súper ligero)
        const embeds = [...html.matchAll(/data-embed="([^"]+)"/g)];
        const result = { latino: {}, 'español': {}, subtitulado: {} };

        for (const match of embeds) {
            // Limpiamos el HTML (viene con &lt; en vez de <)
            let embedHtml = match[1]
                .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"').replace(/&amp;/g, '&');

            const srcMatch = embedHtml.match(/src="([^"]+)"/);
            
            if (srcMatch && !srcMatch[1].includes('youtube')) {
                const srcUrl = srcMatch[1];
                
                // Clasificamos según la URL del embed
                if (srcUrl.includes('lang=LAT')) {
                    result.latino['Cinehax LAT'] = { url: srcUrl, referer: pageUrl };
                } else if (srcUrl.includes('lang=ESP')) {
                    result['español']['Cinehax ESP'] = { url: srcUrl, referer: pageUrl };
                } else if (srcUrl.includes('lang=SUB')) {
                    result.subtitulado['Cinehax SUB'] = { url: srcUrl, referer: pageUrl };
                }
            }
        }

        // Si no encontró nada en ningún idioma, retornamos null
        if (Object.keys(result.latino).length === 0 && Object.keys(result['español']).length === 0) {
            return null;
        }

        return result;

    } catch (error) {
        console.error(`[cinehax] Error extrayendo "${title}":`, error.message);
        return null;
    }
}

module.exports = { extract };
