// api/providers/playlatinsrc.js
const axios = require('axios');

module.exports = {
    name: 'playlatinsrc',

    // Recibe el ID de TMDB (ej. 969681)
    async resolve(tmdbId, type = 'movie') {
        if (!tmdbId) return null;

        try {
            const response = await axios.post('https://playlatinsrc.co/api/embed-links', {
                type: type === 'movie' ? 'movie' : 'tv',
                id: tmdbId
            }, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Content-Type': 'application/json',
                    'Referer': `https://playlatinsrc.co/movie/${tmdbId}`
                },
                timeout: 10000
            });

            if (response.data && response.data.ok && response.data.sources) {
                const sources = {};
                for (const src of response.data.sources) {
                    // Normalizamos el nombre del servidor para tu player
                    const name = (src.name || 'server').toLowerCase();
                    sources[name] = src.url;
                }
                // Devolvemos todos los servidores bajo el idioma 'latino' por defecto
                return { latino: sources };
            }
        } catch (err) {
            console.warn('[playlatinsrc] Error:', err.message);
        }
        return null;
    }
};
