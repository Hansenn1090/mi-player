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

  async resolveEmbed(server) { return server.url; },
};