module.exports = {
  key: 'cineplus123',
  name: 'CinePlus123',
  enabled: true,
  weight: 9,
  langs: ['latino', 'castellano', 'subtitulado'],
  mirrors: [{ base: 'https://cineplus123.org', weight: 10 }],

  buildSearchUrl(tmdbId, type, title) {
    const q = encodeURIComponent(title || tmdbId);
    const postType = type === 'tv' ? 'serie-de-tv' : 'peliculas';
    return `${this.mirrors[0].base}/?s=${q}&post_type=${postType}`;
  },

  selectors: {
    movieLink: [
      'div.image > a[href*="/peliculas/"]',
      'article.item a[href*="/peliculas/"]',
      'h3.title > a[href*="/peliculas/"]',
    ],
    tvLink: [
      'div.image > a[href*="/serie-de-tv/"]',
      'article.item a[href*="/serie-de-tv/"]',
      'h3.title > a[href*="/serie-de-tv/"]',
    ],
  },

  parseDetail($) {
    const servers = [];
    $('li.dooplay_player_option, li[data-post][data-nume]').each((i, el) => {
      const $el = $(el);
      const postId = $el.attr('data-post');
      const nume = $el.attr('data-nume');
      const dtype = $el.attr('data-type') || 'movie';
      if (!postId || !nume) return;

      let langKey = 'latino';
      const titleText = $el.find('span.title').text().trim().toUpperCase();
      const serverText = $el.find('span.server').text().trim().toUpperCase();
      const allText = titleText + ' ' + serverText;

      if (/CASTELLANO|ESPANA/i.test(allText)) langKey = 'castellano';
      else if (/SUBTITULADO|SUB\b/i.test(allText)) langKey = 'subtitulado';

      servers.push({
        name: `${titleText || 'HD'} ${serverText}`,
        lang: langKey,
        ajax: { post: postId, nume, type: dtype },
      });
    });
    return servers;
  },

  async resolveEmbed(server, { http, pickUA, mirror }) {
    const actions = ['doo_player_ajax', 'dooplay_player_ajax'];
    for (const action of actions) {
      try {
        const { data } = await http.post(
          `${mirror.base}/wp-admin/admin-ajax.php`,
          new URLSearchParams({
            action,
            post: server.ajax.post,
            nume: server.ajax.nume,
            type: server.ajax.type,
          }).toString(),
          {
            headers: {
              'User-Agent': pickUA(),
              'Referer': mirror.base,
              'X-Requested-With': 'XMLHttpRequest',
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          }
        );
        if (data && data.embed_url) return data.embed_url;
        if (data && data.url) return data.url;
        if (typeof data === 'string' && /^https?:/.test(data.trim())) return data.trim();
      } catch (e) {}
    }
    return null;
  },
};