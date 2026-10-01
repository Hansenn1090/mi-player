// ══════════════════════════════════════════════════════════════════════════
// providers/poseidonhd2.js — Provider para PoseidonHD2 (DooPlay)
// ══════════════════════════════════════════════════════════════════════════

module.exports = {
  key: 'poseidonhd2',
  name: 'PoseidonHD2',
  enabled: true,
  weight: 8,
  langs: ['latino', 'castellano', 'subtitulado'],
  mirrors: [
    { base: 'https://www.poseidonhd2.co', weight: 10 },
    { base: 'https://poseidonhd2.co', weight: 5 },
  ],

  buildSearchUrl(tmdbId, type, title) {
    const q = encodeURIComponent(title || tmdbId);
    return `${this.mirrors[0].base}/?s=${q}`;
  },

  selectors: {
    movieLink: [
      'div.image > a[href*="/pelicula/"]',
      'article.item a[href*="/pelicula/"]',
      'h3.title > a[href*="/pelicula/"]',
      'a[href*="/pelicula/"]',
    ],
    tvLink: [
      'div.image > a[href*="/serie/"]',
      'article.item a[href*="/serie/"]',
      'h3.title > a[href*="/serie/"]',
      'a[href*="/serie/"]',
    ],
  },

  parseDetail($) {
    const servers = [];

    // DooPlay: opciones de servidor
    $('li.dooplay_player_option, li[data-post][data-nume]').each((i, el) => {
      const $el = $(el);
      const postId = $el.attr('data-post');
      const nume = $el.attr('data-nume');
      const dtype = $el.attr('data-type') || 'movie';
      if (!postId || !nume) return;

      // Detectar idioma
      let langKey = 'latino';
      const titleText = $el.find('span.title').text().trim().toUpperCase();
      const serverText = $el.find('span.server').text().trim().toUpperCase();
      const allText = titleText + ' ' + serverText;

      if (/CASTELLANO|ESPA[ÑN]A|SPANISH/i.test(allText)) langKey = 'castellano';
      else if (/SUBTITULADO|SUB\b|VOSE/i.test(allText)) langKey = 'subtitulado';

      servers.push({
        name: `${titleText || 'HD'} ${serverText}`.trim(),
        lang: langKey,
        ajax: {
          post: postId,
          nume: nume,
          type: dtype,
        },
      });
    });

    return servers;
  },

  async resolveEmbed(server, ctx) {
    const { http, pickUA, mirror } = ctx || {};

    // ─── Método 1: AJAX de DooPlay (rápido, sin Puppeteer) ──────────────
    if (server.ajax && http) {
      const actions = ['doo_player_ajax', 'dooplay_player_ajax'];
      for (const action of actions) {
        try {
          const { data } = await http.post(
            `${mirror.base}/wp-admin/admin-ajax.php`,
            new URLSearchParams({
              action: action,
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
              timeout: 10000,
            }
          );

          let embedUrl = null;
          if (data && data.embed_url) embedUrl = data.embed_url;
          else if (data && data.url) embedUrl = data.url;
          else if (typeof data === 'string' && /^https?:/.test(data.trim())) embedUrl = data.trim();

          if (embedUrl) {
            // ─── Intento 1: Extraer m3u8 con axios (rápido) ──────────
            try {
              const axios = require('axios');
              const { data: html } = await axios.get(embedUrl, {
                timeout: 10000,
                headers: {
                  'User-Agent': pickUA(),
                  'Referer': mirror.base,
                },
                validateStatus: s => s >= 200 && s < 400,
              });

              const htmlStr = typeof html === 'string' ? html : JSON.stringify(html);
              const patterns = [
                /["'](https?:\/\/[^"']*\.m3u8[^"']*)["']/i,
                /file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i,
                /source\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i,
                /["'](\/\/[^"']*\.m3u8[^"']*)["']/i,
              ];

              for (const re of patterns) {
                const match = htmlStr.match(re);
                if (match && match[1]) {
                  let hlsUrl = match[1];
                  if (hlsUrl.startsWith('//')) hlsUrl = 'https:' + hlsUrl;
                  console.log(`[poseidonhd2] ✅ HLS vía axios: ${hlsUrl.substring(0, 80)}`);
                  return hlsUrl;
                }
              }
            } catch (e) {
              // Continuar a Puppeteer
            }

            // ─── Intento 2: Puppeteer (lento pero robusto) ───────────
            try {
              console.log(`[poseidonhd2] ⚙️ Usando Puppeteer...`);
              const extractor = require('../core/puppeteer-extractor');
              const extractFn = extractor.extractM3u8FromEmbed
                || extractor.extractM3u8
                || extractor.extract
                || extractor.default;

              const result = await extractFn(embedUrl);
              // ⚠️ Importante: el extractor devuelve un OBJETO {stream, kind}
              if (result && result.stream) {
                console.log(`[poseidonhd2] ✅ HLS vía Puppeteer: ${result.stream.substring(0, 80)}`);
                return result.stream;
              }
            } catch (e) {
              console.warn(`[poseidonhd2] Puppeteer error: ${e.message}`);
            }

            // ─── Fallback: devolver el embed original ────────────────
            console.log(`[poseidonhd2] ⚠️ Fallback a iframe: ${embedUrl.substring(0, 80)}`);
            return embedUrl;
          }
        } catch (e) {
          // Probar la siguiente action
        }
      }
    }

    // ─── Sin AJAX o falló: intentar extraer directo de la URL ─────────
    if (server.url) {
      try {
        const extractor = require('../core/puppeteer-extractor');
        const extractFn = extractor.extractM3u8FromEmbed || extractor.extractM3u8 || extractor.extract || extractor.default;
        const result = await extractFn(server.url);
        if (result && result.stream) return result.stream;
      } catch (_) {}
      return server.url;
    }

    return null;
  },
};
