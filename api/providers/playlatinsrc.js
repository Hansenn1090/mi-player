// api/providers/playlatinsrc.js
const axios = require('axios');

module.exports = {
  name: 'playlatinsrc',
  recommended: true,

  async resolve(tmdbId, type = 'movie', lang = 'latino') {
    if (!tmdbId) return null;

    const cleanId = String(tmdbId).replace(/\D/g, ''); // Solo números
    const contentType = (type === 'tv' || type === 'series' || type === 'serie') ? 'series' : 'movie';

    try {
      console.log(`[playlatinsrc] Buscando id=${cleanId} type=${contentType}`);

      const response = await axios.post(
        'https://playlatinsrc.co/api/embed-links',
        {
          type: contentType,
          id: cleanId,
        },
        {
          headers: {
            // Headers que simulan un navegador real
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Content-Type': 'application/json',
            'Origin': 'https://playlatinsrc.co',
            'Referer': `https://playlatinsrc.co/movie/${cleanId}`,
            'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin',
            'Connection': 'keep-alive',
          },
          timeout: 15000,
          // No seguir redirecciones que nos saquen del dominio
          maxRedirects: 0,
          validateStatus: (status) => status >= 200 && status < 400,
        }
      );

      if (!response.data || !response.data.ok || !Array.isArray(response.data.sources)) {
        console.warn('[playlatinsrc] Respuesta inválida:', JSON.stringify(response.data).slice(0, 200));
        return null;
      }

      const servers = {};
      for (const src of response.data.sources) {
        if (!src || !src.url) continue;
        let name = (src.name || 'server').toLowerCase().replace(/[^a-z0-9]/g, '');
        // Normalizar nombres comunes
        if (name.includes('drop')) name = 'dropload';
        else if (name.includes('dood')) name = 'doodstream';
        else if (name.includes('mix')) name = 'mixdrop';
        else if (name.includes('unlim')) name = 'unlimplay';

        if (!servers[name]) {
          servers[name] = src.url;
        }
      }

      console.log(`[playlatinsrc] ✅ ${Object.keys(servers).length} servidores: ${Object.keys(servers).join(', ')}`);
      return { latino: servers };

    } catch (err) {
      if (err.response && err.response.status === 403) {
        console.warn('[playlatinsrc] ❌ 403 Forbidden — el sitio rechaza la petición');
      } else {
        console.warn('[playlatinsrc] Error:', err.message);
      }
      return null;
    }
  }
};
