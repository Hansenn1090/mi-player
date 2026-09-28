module.exports = {
  key: 'poseidonhd2',
  name: 'PoseidonHD2',
  enabled: true,
  weight: 8,
  langs: ['latino', 'castellano', 'subtitulado'],
  mirrors: [{ base: 'https://www.poseidonhd2.co', weight: 10 }],

  buildSearchUrl(tmdbId, type, title) {
    const q = encodeURIComponent(title || tmdbId);
    return `${this.mirrors[0].base}/search?q=${q}`;
  },

  selectors: {
    movieLink: [
      'div.TPost.D > a[href*="/pelicula/"]',
      'a[href*="/pelicula/"]',
    ],
    tvLink: [
      'div.TPost.D > a[href*="/serie/"]',
      'a[href*="/serie/"]',
    ],
  },

  parseDetail($) {
    const servers = [];

    $('.tab_language_movie, [data-lang]').each((i, langEl) => {
      const $lang = $(langEl);
      const langText = $lang.text().trim().toUpperCase();
      let langKey = 'latino';
      if (/CASTELLANO|ESPANA/i.test(langText)) langKey = 'castellano';
      else if (/SUBTITULADO|SUB/i.test(langText)) langKey = 'subtitulado';

      $lang.find('li.clili, li[data-tr], a[data-tr]').each((j, srvEl) => {
        const $srv = $(srvEl);
        const url = $srv.attr('data-tr');
        if (!url) return;
        const label = $srv.find('span').first().text().trim() || `Server ${j + 1}`;
        servers.push({ name: label, lang: langKey, url });
      });
    });

    if (!servers.length) {
      $('li[data-tr], a[data-tr]').each((i, el) => {
        const url = $(el).attr('data-tr');
        if (!url) return;
        const label = $(el).text().trim() || `Server ${i + 1}`;
        servers.push({ name: label, lang: 'latino', url });
      });
    }
    return servers;
  },

  async resolveEmbed(server) {
    try {
      const axios = require('axios');
      const embedUrl = server.url;

      console.log(`[poseidonhd2] Explorando: ${embedUrl.substring(0, 90)}`);

      const { data: html } = await axios.get(embedUrl, {
        timeout: 12000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0 Safari/537.36',
          'Referer': 'https://www.poseidonhd2.co/',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'es-MX,es;q=0.9',
        },
        validateStatus: s => s >= 200 && s < 400,
      });

      const htmlStr = typeof html === 'string' ? html : JSON.stringify(html);

      // Buscar .m3u8 en el HTML (múltiples patrones)
      const patterns = [
        /["'](https?:\/\/[^"']*\.m3u8[^"']*)["']/i,
        /file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i,
        /source\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i,
        /["'](\/\/[^"']*\.m3u8[^"']*)["']/i,
        /"hls"\s*:\s*["']([^"']+)["']/i,
        /"url"\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i,
        /<source[^>]+src=["']([^"']+\.m3u8[^"']*)["']/i,
      ];

      for (const re of patterns) {
        const match = htmlStr.match(re);
        if (match && match[1]) {
          let hlsUrl = match[1];
          if (hlsUrl.startsWith('//')) hlsUrl = 'https:' + hlsUrl;
          else if (hlsUrl.startsWith('/')) {
            const u = new URL(embedUrl);
            hlsUrl = u.origin + hlsUrl;
          }
          console.log(`[poseidonhd2] ✓ HLS encontrado: ${hlsUrl.substring(0, 80)}...`);
          return hlsUrl;
        }
      }

      // Fallback: buscar .mp4
      const mp4Match = htmlStr.match(/["'](https?:\/\/[^"']*\.mp4[^"']*)["']/i);
      if (mp4Match && mp4Match[1]) {
        console.log(`[poseidonhd2] ✓ MP4 encontrado`);
        return mp4Match[1];
      }

      // Buscar iframes anidados (por si el player real está dentro)
      const nestedMatch = htmlStr.match(/<iframe[^>]+src=["']([^"']+)["']/i);
      if (nestedMatch && nestedMatch[1] && !nestedMatch[1].includes('about:blank')) {
        let next = nestedMatch[1];
        if (next.startsWith('//')) next = 'https:' + next;
        else if (next.startsWith('/')) {
          const u = new URL(embedUrl);
          next = u.origin + next;
        }
        if (next !== embedUrl) {
          console.log(`[poseidonhd2] Explorando iframe anidado: ${next.substring(0, 80)}`);
          return await this.resolveEmbed({ url: next, lang: server.lang });
        }
      }

      console.log(`[poseidonhd2] ✗ No se encontró HLS/MP4, usando iframe original`);
      return embedUrl;

    } catch (e) {
      console.warn(`[poseidonhd2] Error: ${e.message}`);
      return server.url;
    }
  },
};
