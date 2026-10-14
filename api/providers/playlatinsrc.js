// api/providers/playlatinsrc.js
const axios = require('axios');

module.exports = {
  name: 'playlatinsrc',
  recommended: true,

  /**
   * PlayLatinSRC tiene una API interna que devuelve los servidores en JSON.
   * @param {string} tmdbId - ID de TMDB (ej: 969681)
   * @param {string} type - 'movie' | 'tv'
   * @param {string} lang - No usado (la API ya devuelve los idiomas)
   */
  async resolve(tmdbId, type = 'movie', lang = 'latino') {
    if (!tmdbId) return null;

    try {
      console.log(`[playlatinsrc] Buscando id=${tmdbId} type=${type}`);

      const response = await axios.post(
        'https://playlatinsrc.co/api/embed-links',
        {
          type: type === 'tv' || type === 'series' ? 'series' : 'movie',
          id: String(tmdbId),
        },
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Content-Type': 'application/json',
            'Origin': 'https://playlatinsrc.co',
            'Referer': `https://playlatinsrc.co/movie/${tmdbId}`,
            'Accept': 'application/json, text/plain, */*',
          },
          timeout: 10000,
        }
      );

      if (!response.data || !response.data.ok || !Array.isArray(response.data.sources)) {
        console.warn('[playlatinsrc] Respuesta inválida:', response.data);
        return null;
      }

      const servers = {};
      for (const src of response.data.sources) {
        if (!src || !src.url) continue;
        const name = (src.name || 'server').toLowerCase().replace(/[^a-z0-9]/g, '');
        // Evitar duplicados
        if (!servers[name]) {
          servers[name] = src.url;
        }
      }

      console.log(`[playlatinsrc] ✅ ${Object.keys(servers).length} servidores encontrados`);
      return { latino: servers };

    } catch (err) {
      console.warn('[playlatinsrc] Error:', err.message);
      return null;
    }
  }
};
