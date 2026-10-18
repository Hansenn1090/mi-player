// api/providers/cinehax.js
'use strict';
const axios = require('axios');

const BASE_URL = 'https://cinehaxplus.com';
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

function slugify(text) {
    return text.toString().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9 -]/g, '').trim().replace(/\s+/g, '-');
}

async function extract(title, year, id, type, lang) {
    try {
        const slug = slugify(title);
        const pathType = (type === 'tv' || type === 'serie') ? 'serie' : 'pelicula';
        let pageUrl = `${BASE_URL}/${pathType}/${slug}-${year}`;

        // 1. Intentar URL directa
        let { data: html, status } = await axios.get(pageUrl, {
            headers: { 'User-Agent': USER_AGENT },
            validateStatus: false,
            timeout: 8000
        });

        // 2. Si falla, buscar en el sitio
        if (status === 404 || !html.includes('data-embed')) {
            console.log(`[cinehax] URL directa falló para "${title}". Buscando...`);
            const searchUrl = `${BASE_URL}/search?q=${encodeURIComponent(title)}`;
            const searchRes = await axios.get(searchUrl, { 
                headers: { 'User-Agent': USER_AGENT },
                timeout: 8000 
            });
            
            const match = searchRes.data.match(new RegExp(`href="([^"]*${slug}[^"]*)"`));
            if (match) {
                pageUrl = match[1].startsWith('http') ? match[1] : `${BASE_URL}${match[1]}`;
                const res = await axios.get(pageUrl, { headers: { 'User-Agent': USER_AGENT } });
                html = res.data;
            } else {
                return null; 
            }
        }

        // 3. Extraer enlaces del HTML
        const embeds = [...html.matchAll(/data-embed="([^"]+)"/g)];
        const result = { latino: {}, 'español': {}, subtitulado: {} };
        let found = false;

        for (const match of embeds) {
            let embedHtml = match[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
            const srcMatch = embedHtml.match(/src="([^"]+)"/);
            
            if (srcMatch && !srcMatch[1].includes('youtube')) {
                const srcUrl = srcMatch[1];
                found = true;
                
                if (srcUrl.includes('lang=LAT')) result.latino['Cinehax'] = { url: srcUrl, referer: pageUrl };
                if (srcUrl.includes('lang=ESP')) result['español']['Cinehax'] = { url: srcUrl, referer: pageUrl };
                if (srcUrl.includes('lang=SUB')) result.subtitulado['Cinehax'] = { url: srcUrl, referer: pageUrl };
            }
        }

        return found ? result : null;

    } catch (error) {
        console.error(`[cinehax] Error:`, error.message);
        return null;
    }
}

module.exports = { extract };
