const axios = require('axios');
const cheerio = require('cheerio');

async function extractDoodstream(embedUrl) {
    try {
        // A veces la URL es tipo dood.la/d/xxxx o doodstream.com/e/xxxx
        const url = new URL(embedUrl);
        const pathParts = url.pathname.split('/').filter(Boolean);
        // El ID del video suele ser el último segmento
        const videoId = pathParts[pathParts.length - 1];
        if (!videoId) return null;

        // 1. Hacer la petición inicial para obtener los tokens
        const initialResponse = await axios.get(embedUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            maxRedirects: 0,
            validateStatus: (status) => status >= 200 && status < 400,
        });

        const setCookie = initialResponse.headers['set-cookie'];
        const cookies = setCookie ? setCookie.join('; ') : '';
        const html = initialResponse.data;
        const $ = cheerio.load(html);

        // 2. Buscar el token `pass_md5` en el código JavaScript
        const scriptContent = $('script').map((i, el) => $(el).html()).get().join('\n');
        const tokenMatch = scriptContent.match(/\/pass_md5\/([^\/"]+)/);
        if (!tokenMatch) return null;
        const token = tokenMatch[1];

        // 3. Construir la URL de la API
        const apiUrl = `https://doodstream.com/pass_md5/${token}`;
        const apiResponse = await axios.get(apiUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': embedUrl,
                'Cookie': cookies,
            },
            validateStatus: (status) => status >= 200 && status < 400,
        });

        // 4. La respuesta suele ser un string con la URL base del video
        const baseUrl = apiResponse.data.trim();
        if (!baseUrl || !baseUrl.startsWith('http')) return null;

        // 5. Construir la URL final (suele necesitar un token y el ID)
        // Esta parte es variable según el mirror, puede necesitar más pasos.
        // Devolvemos la URL base para probar.
        return { stream: baseUrl, kind: 'mp4', referer: embedUrl };
    } catch (err) {
        console.warn('[doodstream] Error:', err.message);
        return null;
    }
}
module.exports = { extractDoodstream };
