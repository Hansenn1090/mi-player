/**
 * =====================================================================
 *  API UNIFICADA — mi-player-api (TMDB + Scrapers + Vimeo)
 * =====================================================================
 */

'use strict';

const express = require('express');
const axios   = require('axios');
const cors    = require('cors');
const path    = require('path');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors({ origin: '*' }));
app.use(express.json());

// ── CONFIGURACIÓN
const CONFIG = {
  TMDB_KEY: '2d85217008ed46189916cf9cf1eaef53',
  VIMEO_UA: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  TIMEOUT_MS: 15000,
  ALLOWED_HOST_PATTERNS: [
    /^player\.vimeo\.com$/i,
    /^vimeo\.com$/i,
    /^[a-z0-9-]+(\.[a-z0-9-]+)*\.vimeo\.com$/i,
    /^[a-z0-9-]+(\.[a-z0-9-]+)*\.vimeocdn\.com$/i,
  ],
};

// ── HELPERS VIMEO
function isAllowedHost(hostname) {
  return CONFIG.ALLOWED_HOST_PATTERNS.some((rx) => rx.test(hostname));
}
function assertAllowedUrl(urlString) {
  const u = new URL(urlString);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Protocolo no permitido');
  if (!isAllowedHost(u.hostname)) throw new Error('Host no permitido: ' + u.hostname);
  return u;
}
function publicBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host  = req.headers['x-forwarded-host']  || req.get('host');
  return `${proto}://${host}`;
}

// ─────────────────────────────────────────────────────────────────────
// 🔥 RUTA PARA BUSCAR PELÍCULAS (Usa TMDB + Scrapers)
// ─────────────────────────────────────────────────────────────────────
app.get('/api/servers', async (req, res) => {
  try {
    const { id, type = 'movie' } = req.query;
    if (!id) return res.status(400).json({ error: 'Falta ID' });

    // 1. Obtener info de TMDB
    const tmdbRes = await axios.get(`https://api.themoviedb.org/3/${type}/${id}?api_key=${CONFIG.TMDB_KEY}&language=es-ES`);
    const movie = tmdbRes.data;

    // 2. Crear servidores (Aquí es donde tus scrapers de Puppeteer entran)
    // Para este ejemplo, simulamos que el primer servidor devuelve un Vimeo.
    // 🔥 AQUÍ DEBES PONER TU LÓGICA REAL DE SCRAPING (PelisPlusHD, Cuevana, etc.)
    
    const servers = {
      latino: {
        // Si tu scraper encuentra un enlace de Vimeo, lo pones aquí:
        vimeo: { url: "https://vimeo.com/76979871" }, 
        
        // Si tu scraper encuentra otros enlaces, los pones aquí:
        pelisplushd: { url: `https://pelisplushd.to/pelicula/${movie.title.toLowerCase().replace(/\s+/g, '-')}/` },
      }
    };

    // 3. Responder al reproductor
    res.json({
      meta: {
        title: movie.title || movie.name,
        year: (movie.release_date || movie.first_air_date || '').split('-')[0],
        overview: movie.overview,
        poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
        voteAverage: movie.vote_average,
        tmdbId: id
      },
      servers: servers
    });
  } catch (error) {
    console.error("Error en /api/servers:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────
// 🔥 RUTAS DE VIMEO
// ─────────────────────────────────────────────────────────────────────
app.get('/api/vimeo/extract', async (req, res) => {
  try {
    const { url } = req.query;
    let videoId = url;
    let videoHash = null;
    if (url.includes('vimeo.com')) {
      const match = url.match(/(?:vimeo\.com\/(?:video\/)?)(\d+)(?:\/([a-zA-Z0-9]+))?/);
      if (match) {
        videoId = match[1];
        videoHash = match[2] || new URL(url).searchParams.get('h');
      }
    }

    const hashParam = videoHash ? `?h=${videoHash}` : '';
    const configUrl = `https://player.vimeo.com/video/${videoId}/config${hashParam}`;
    const response = await axios.get(configUrl, {
      headers: { 'User-Agent': CONFIG.VIMEO_UA, 'Referer': 'https://player.vimeo.com/' }
    });

    const config = response.data;
    const files = config.request?.files || {};
    let streamUrl = null;
    let format = 'unknown';

    if (files.hls?.cdns) {
      const defaultCdn = files.hls.default_cdn;
      streamUrl = files.hls.cdns[defaultCdn]?.url;
      format = 'hls';
    } else if (files.progressive && files.progressive.length > 0) {
      const sorted = files.progressive.sort((a, b) => b.height - a.height);
      streamUrl = sorted[0].url;
      format = 'mp4';
    }

    if (!streamUrl) return res.status(404).json({ error: 'No hay streams' });

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    
    res.json({
      success: true,
      title: config.video?.title,
      duration: config.video?.duration,
      format: format,
      streamUrl: format === 'hls' 
        ? `${baseUrl}/api/vimeo/hls?url=${encodeURIComponent(streamUrl)}`
        : `${baseUrl}/api/vimeo/proxy?url=${encodeURIComponent(streamUrl)}`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/vimeo/hls', async (req, res) => {
  try {
    const { url } = req.query;
    const upstream = await axios.get(url, {
      headers: { 'User-Agent': CONFIG.VIMEO_UA, 'Referer': 'https://player.vimeo.com/' },
      responseType: 'text',
      transformResponse: [(x) => x],
    });

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    let text = String(upstream.data || '');

    text = text.split('\n').map((line) => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return line;
      const abs = new URL(t, url).href;
      const isPlaylist = /\.m3u8(\?|$)/i.test(abs);
      const ep = isPlaylist ? '/api/vimeo/hls' : '/api/vimeo/proxy';
      return `${baseUrl}${ep}?url=${encodeURIComponent(abs)}`;
    }).join('\n');

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.send(text);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get('/api/vimeo/proxy', async (req, res) => {
  try {
    const { url } = req.query;
    const headers = { 'User-Agent': CONFIG.VIMEO_UA, 'Referer': 'https://player.vimeo.com/' };
    if (req.headers.range) headers.Range = req.headers.range;

    const upstream = await axios({ method: 'GET', url, headers, responseType: 'stream' });

    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      if (upstream.headers[h]) res.setHeader(h, upstream.headers[h]);
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    upstream.data.pipe(res);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ── HEALTH
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// ── SERVIR ARCHIVOS ESTÁTICOS
app.use(express.static(path.join(__dirname)));

// ── 404
app.use((_req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
