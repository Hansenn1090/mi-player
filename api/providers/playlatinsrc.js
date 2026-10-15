// api/providers/playlatinsrc.js
/**
 * PlayLatinSRC — Embed limpio vía /custom/
 *
 * NOTA IMPORTANTE:
 * NO llamamos a su API interna (POST /api/embed-links) porque
 * está protegida por Cloudflare y devuelve 403 desde cualquier
 * IP de datacenter (Render, AWS, DigitalOcean, etc.).
 *
 * En su lugar construimos directamente la URL del embed limpio.
 * El reproductor de PlayLatinSRC incluye su propio selector de
 * idioma (latino/castellano/subtitulado) y de hosts internos
 * (Dropload, Doodstream, Mixdrop, UnlimPlay).
 *
 * URLs:
 *   Películas: /custom/movie/{id}?lang=latino
 *   Series:    /custom/serial/{id}/{season}/{episode}?lang=latino
 */

module.exports = {
  name: 'playlatinsrc',
  recommended: false,

  async resolve(tmdbId, type = 'movie', lang = 'latino') {
    if (!tmdbId) return null;

    const cleanId = String(tmdbId).replace(/\D/g, '');
    if (!cleanId) return null;

    // Series aún no soportadas (Fase 2)
    if (type === 'tv' || type === 'series' || type === 'serie') {
      console.log('[playlatinsrc] Series aún no soportadas');
      return null;
    }

    // Películas → embed limpio (sin API, sin 403)
    const url = `https://playlatinsrc.co/custom/movie/${cleanId}?lang=${lang}`;
    console.log(`[playlatinsrc] ✅ ${url}`);

    return {
      latino: {
        playlatinsrc: url,
      },
    };
  },
};
