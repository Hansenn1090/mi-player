// api/providers/videoapp.js
'use strict';

async function extract(title, year, id, type, lang) {
    try {
        if (type !== 'movie') return null;

        const embedUrl = `https://videoapp.zip/e/movie/${id}?autoplay=1`;

        return {
            latino: {
                'Videoapp': { url: embedUrl, referer: 'https://videoapp.zip/', type: 'embed' }
            }
        };
    } catch (error) {
        return null;
    }
}

module.exports = { extract };
