// api/providers/playpelis.js
'use strict';
const axios = require('axios');

const BASE_URL = 'https://playpelis.net';
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

// Función para limpiar el título y crear la URL amigable
function slugify(text) {
    return text.toString().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9 -]/g, '')
        .trim().replace(/\s+/g, '-');
}

async function extract(title, year, id, type, lang) {
    try {
        if (!title) return null;

        const slug = slugify(title);
        // Playpelis usa una estructura de URL predecible
        let pageUrl = `${BASE_URL}/peliculas/${slug}/`;

        // 1. Intentar acceder directamente a la URL de la película
        let { data: html, status } = await axios.get(pageUrl, {
            headers: { 'User-Agent': USER_AGENT },
            validateStatus: false,
            timeout: 8000
        });

        // 2. Si da 404, usar el buscador interno
        if (status === 404 || !html.includes('trembed')) {
            console.log(`[playpelis] URL directa falló. Buscando "${title}"...`);
            const searchUrl = `${BASE_URL}/?s=${encodeURIComponent(title)}`;
            const searchRes = await axios.get(searchUrl, { headers: { 'User-Agent': USER_AGENT }, timeout: 8000 });
            
            // Buscar el primer enlace que coincida con el slug
            const match = searchRes.data.match(new RegExp(`href="(${BASE_URL}/peliculas/[^"]*${slug}[^"]*)"`));
            if (match) {
                pageUrl = match[1];
                const res = await axios.get(pageUrl, { headers: { 'User-Agent': USER_AGENT } });
                html = res.data;
            } else {
                return null; 
            }
        }

        // 3. Extraer el iframe del reproductor
        // Buscamos el patrón: src="https://playpelis.net/?trembed=..."
        const embedMatch = html.match(/src="(https?:\/\/playpelis\.net\/\?trembed=[^"]+)"/i);
        
        if (embedMatch) {
            const embedUrl = embedMatch[1];
            // El reproductor de Playpelis es un iframe, lo clasificamos como 'embed'
            return {
                latino: {
                    'Playpelis': { url: embedUrl, referer: pageUrl, type: 'embed' }
                }
            };
        }

        return null;

    } catch (error) {
        console.error(`[playpelis] Error extrayendo "${title}":`, error.message);
        return null;
    }
}

module.exports = { extract };
