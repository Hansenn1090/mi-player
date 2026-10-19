/**
 * =====================================================================
 *  API UNIFICADA Y CORREGIDA — mi-player-api
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

// ── RUTA RAÍZ
app.get('/', (req, res) => {
  res.send(`
    <h1>API en Línea</h1>
    <p><a href="/api/servers?id=315635&type=movie">Probar /api/servers (Películas)</a></p>
    <p><a href="/api/vimeo/extract?url=https://vimeo.com/76979871">Probar Vimeo</a></p>
  `);
});

// ── HEALTH
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// ─────────────────────────────────────────────────────────────────────
// 🔥 RUTA QUE FALTABA: /api/servers (Para tus películas)
// ─────────────────────────────────────────────────────────────────────
const TMDB_KEY = '2d85217008ed46189916cf9cf1eaef53';

app.get('/api/servers', async (req, res) => {
  try {
    const { id, type } = req.query;
    if (!id) return res.status(400).json({ error: 'Falta ID' });

    // 1. Obtener info de la película desde TMDB
    const tmdbUrl = `https://api.themoviedb.org/3/${type}/${id}?api_key=${TMDB_KEY}&language=es-ES`;
    const tmdbRes = await axios.get(tmdbUrl);
    const movie = tmdbRes.data;

    // 2. Crear los servidores falsos (Simulando los que hacía Puppeteer)
    const servers = {
      latino: {
        vimeo: { url: "https://vimeo.com/76979871" }, // Servidor 1: Vimeo
        unlimplay: { url: `https://unlimplay.com/f/embed/movie/${movie.imdb_id || id}` }, // Servidor 2
      }
    };

    // 3. Responder al reproductor con el formato que espera
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
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────
// 🔥 RUTAS DE VIMEO (Ya estaban bien)
// ─────────────────────────────────────────────────────────────────────
const VIMEO_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

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
      headers: { 'User-Agent': VIMEO_UA, 'Referer': 'https://player.vimeo.com/' }
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
      headers: { 'User-Agent': VIMEO_UA, 'Referer': 'https://player.vimeo.com/' },
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
    const headers = { 'User-Agent': VIMEO_UA, 'Referer': 'https://player.vimeo.com/' };
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

// ── SERVIR ARCHIVOS ESTÁTICOS
app.use(express.static(path.join(__dirname)));

// ── 404 / ERROR HANDLER
app.use((_req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
