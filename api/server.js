// ══════════════════════════════════════════════════════════════════════════
// server.js — UnLim Play Backend
// Deploy en Render: Build = npm install | Start = npm start
// ══════════════════════════════════════════════════════════════════════════

const express = require('express');
const cors = require('cors');

const app = express();

// ══════════════════════════════════════════════════════════════════════════
// MIDDLEWARES
// ══════════════════════════════════════════════════════════════════════════

app.use(cors({
  origin: [
    'https://mi-player.netlify.app',
    /\.netlify\.app$/,
    /\.onrender\.com$/,
    'http://localhost:3000',
    'http://localhost:5173',
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: false,
}));

app.use(express.json());

// Logger simple
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ══════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════

const doFetch = (...args) =>
  import('node-fetch').then(({ default: f }) => f(...args));

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0 Safari/537.36';

// ══════════════════════════════════════════════════════════════════════════
// ROOT / HEALTH CHECK
// ══════════════════════════════════════════════════════════════════════════
app.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'UnLim Play API',
    version: '1.0.0',
    endpoints: [
      '/api/proxy',
      '/api/servers',
      '/api/extract',
      '/api/cinemaos',
    ],
  });
});

// ══════════════════════════════════════════════════════════════════════════
// PROXY UNIVERSAL — evita CORS y bloqueos por Referer
// Uso: /api/proxy?url=<URL>&referer=<URL>
// ══════════════════════════════════════════════════════════════════════════
app.get('/api/proxy', async (req, res) => {
  try {
    const { url, referer } = req.query;
    if (!url) return res.status(400).send('Falta url');

    const headers = {
      'User-Agent': UA,
      'Accept': '*/*',
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
    };

    if (referer) {
      headers['Referer'] = referer;
      try {
        headers['Origin'] = new URL(referer).origin;
      } catch (_) { /* noop */ }
    } else {
      try {
        headers['Origin'] = new URL(url).origin;
      } catch (_) { /* noop */ }
    }

    const r = await doFetch(url, { headers, redirect: 'follow' });

    res.set('Access-Control-Allow-Origin', '*');
    res.set(
      'Content-Type',
      r.headers.get('content-type') || 'application/octet-stream'
    );

    const buf = Buffer.from(await r.arrayBuffer());
    res.send(buf);
  } catch (e) {
    console.error('[proxy]', e.message);
    res.status(500).send('Proxy error: ' + e.message);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// SERVIDORES PROPIOS (HLS)
// Uso: /api/servers?id=<TMDB_ID>&type=movie|tv
// ══════════════════════════════════════════════════════════════════════════
app.get('/api/servers', async (req, res) => {
  const { id, type = 'movie' } = req.query;
  if (!id) return res.status(400).json({ error: 'Falta id' });

  try {
    let servers = { latino: {} };
    let meta = {
      title: null,
      year: null,
      genres: [],
      runtime: 0,
      voteAverage: 0,
      poster: '',
      backdrop: '',
    };

    // ────────────────────────────────────────────────────────────────────
    // Usar tu registry de providers existente
    // ────────────────────────────────────────────────────────────────────
    try {
      const registry = require('./providers/registry');
      const providers = registry.providers || registry;

      if (providers && typeof providers === 'object') {
        for (const [name, fn] of Object.entries(providers)) {
          try {
            const handler =
              (typeof fn === 'function' && fn) ||
              fn?.getServers ||
              fn?.scrape ||
              fn?.default;

            if (typeof handler !== 'function') continue;

            const result = await handler(id, type);
            if (!result) continue;

            if (result.servers) {
              servers.latino = { ...servers.latino, ...result.servers };
            }
            if (result.meta) {
              meta = { ...meta, ...result.meta };
            }
          } catch (err) {
            console.warn(`[provider:${name}]`, err.message);
          }
        }
      }
    } catch (err) {
      console.warn('[registry] no disponible:', err.message);
    }

    res.set('Access-Control-Allow-Origin', '*');
    res.json({ servers, meta });
  } catch (e) {
    console.error('[servers]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// EXTRAER HLS (.m3u8)
// Uso: /api/extract?url=<EMBED_URL>
// ══════════════════════════════════════════════════════════════════════════
app.get('/api/extract', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Falta url' });

  try {
    // Intentar usar tu extractor central si existe
    try {
      const extractor = require('./core/extractor');
      const fn =
        extractor.extractStream ||
        extractor.extract ||
        extractor.default;

      if (typeof fn === 'function') {
        const result = await fn(url);
        if (result && result.stream) {
          res.set('Access-Control-Allow-Origin', '*');
          return res.json({
            stream: result.stream,
            kind: result.kind || 'hls',
            referer: result.referer || url,
          });
        }
      }
    } catch (_) {
      // sigue con el fallback
    }

    // Fallback: fetch simple buscando .m3u8 en el HTML
    const r = await doFetch(url, {
      headers: { 'User-Agent': UA, Referer: url },
      redirect: 'follow',
    });
    const html = await r.text();

    const m = html.match(/https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/);
    if (!m) {
      return res.status(404).json({ error: 'No m3u8 encontrado' });
    }

    res.set('Access-Control-Allow-Origin', '*');
    res.json({ stream: m[0], kind: 'hls', referer: url });
  } catch (e) {
    console.error('[extract]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// CINEMAOS — DASH (.mpd) + subtítulos (.vtt)
// Uso: /api/cinemaos?id=<TMDB_ID>&type=movie|tv
// ══════════════════════════════════════════════════════════════════════════
app.get('/api/cinemaos', async (req, res) => {
  const { id, type = 'movie' } = req.query;
  if (!id) return res.status(400).json({ error: 'Falta id' });

  try {
    // 1) Intentar con el provider de CinemaOS
    try {
      const cinemaos = require('./providers/cinemaos');
      const fn = cinemaos.getCinemaOSServers || cinemaos.default;

      if (typeof fn === 'function') {
        const data = await fn(id, type);
        if (data && data.servers && Object.keys(data.servers).length) {
          res.set('Access-Control-Allow-Origin', '*');
          return res.json(data);
        }
      }
    } catch (err) {
      console.warn('[cinemaos provider]', err.message);
    }

    // 2) Fallback: scraping inline
    const pageUrl =
      `https://cinemaos.tech/player/${id}` +
      `?theme=ffffff&autoPlay=true&title=false`;

    const r = await doFetch(pageUrl, {
      headers: {
        'User-Agent': UA,
        'Accept':
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });

    if (!r.ok) {
      return res
        .status(r.status)
        .json({ error: `CinemaOS respondió ${r.status}` });
    }

    const html = await r.text();

    const mpdMatch = html.match(/<source\s+src="([^"]+\.mpd)"/);
    if (!mpdMatch) {
      return res.json({ servers: {} });
    }

    const subs = [];
    const tracks = html.match(/<track\b[^>]*>/g) || [];
    for (const tag of tracks) {
      const src = (tag.match(/src="([^"]+)"/) || [])[1];
      const label = (tag.match(/label="([^"]+)"/) || [])[1];
      const lang = (tag.match(/srclang="([^"]+)"/) || [])[1];
      if (src && label) {
        subs.push({ url: src, label, lang: lang || 'en' });
      }
    }

    res.set('Access-Control-Allow-Origin', '*');
    res.json({
      servers: {
        CinemaOS: {
          url: mpdMatch[1],
          kind: 'dash',
          subtitles: subs,
        },
      },
    });
  } catch (e) {
    console.error('[cinemaos]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// 404
// ══════════════════════════════════════════════════════════════════════════
app.use((req, res) => {
  res.status(404).json({
    error: 'Ruta no encontrada',
    path: req.path,
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ERROR HANDLER GLOBAL
// ══════════════════════════════════════════════════════════════════════════
app.use((err, _req, res, _next) => {
  console.error('[global error]', err);
  res.status(500).json({ error: err.message || 'Error interno' });
});

// ══════════════════════════════════════════════════════════════════════════
// ARRANQUE
// ══════════════════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('═══════════════════════════════════════════════════════');
  console.log(`✅ UnLim Play API escuchando en puerto ${PORT}`);
  console.log(`   Endpoints:`);
  console.log(`   • /api/proxy      → proxy universal`);
  console.log(`   • /api/servers    → servidores HLS propios`);
  console.log(`   • /api/extract    → extraer .m3u8`);
  console.log(`   • /api/cinemaos   → CinemaOS DASH + subtítulos`);
  console.log('═══════════════════════════════════════════════════════');
});
