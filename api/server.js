// ══════════════════════════════════════════════════════════════════════════
// server.js — UnLim Play Backend
// Usa fetch nativo de Node 18+ (sin node-fetch)
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
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: false,
}));

app.use(express.json());

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ══════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0 Safari/537.36';

// ══════════════════════════════════════════════════════════════════════════
// ROOT
// ══════════════════════════════════════════════════════════════════════════
app.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'UnLim Play API',
    version: '1.1.0',
    endpoints: ['/api/proxy', '/api/servers', '/api/extract', '/api/cinemaos'],
  });
});

// ══════════════════════════════════════════════════════════════════════════
// PROXY UNIVERSAL
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
      try { headers['Origin'] = new URL(referer).origin; } catch (_) {}
    }

    const r = await fetch(url, { headers, redirect: 'follow' });

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
// SERVIDORES PROPIOS
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
            if (result.meta) meta = { ...meta, ...result.meta };
          } catch (err) {
            console.warn(`[provider:${name}]`, err.message);
          }
        }
      }
    } catch (err) {
      console.warn('[registry]', err.message);
    }

    res.set('Access-Control-Allow-Origin', '*');
    res.json({ servers, meta });
  } catch (e) {
    console.error('[servers]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// EXTRAER HLS
// ══════════════════════════════════════════════════════════════════════════
app.get('/api/extract', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Falta url' });

  try {
    try {
      const extractor = require('./core/extractor');
      const fn = extractor.extractStream || extractor.extract || extractor.default;

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
    } catch (_) {}

    const r = await fetch(url, {
      headers: { 'User-Agent': UA, Referer: url },
      redirect: 'follow',
    });
    const html = await r.text();

    const m = html.match(/https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/);
    if (!m) return res.status(404).json({ error: 'No m3u8 encontrado' });

    res.set('Access-Control-Allow-Origin', '*');
    res.json({ stream: m[0], kind: 'hls', referer: url });
  } catch (e) {
    console.error('[extract]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// CINEMAOS
// ══════════════════════════════════════════════════════════════════════════
app.get('/api/cinemaos', async (req, res) => {
  const { id, type = 'movie' } = req.query;
  if (!id) return res.status(400).json({ error: 'Falta id' });

  try {
    const { getCinemaOSServers } = require('./providers/cinemaos');
    const data = await getCinemaOSServers(id, type);

    res.set('Access-Control-Allow-Origin', '*');

    if (data && data.servers && Object.keys(data.servers).length) {
      return res.json(data);
    }

    return res.status(403).json({ error: 'CinemaOS respondió 403' });
  } catch (e) {
    console.error('[cinemaos]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// 404
// ══════════════════════════════════════════════════════════════════════════
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada', path: req.path });
});

// ══════════════════════════════════════════════════════════════════════════
// ERROR GLOBAL
// ══════════════════════════════════════════════════════════════════════════
app.use((err, _req, res, _next) => {
  console.error('[global]', err);
  res.status(500).json({ error: err.message || 'Error interno' });
});

// ══════════════════════════════════════════════════════════════════════════
// ARRANQUE
// ══════════════════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('═══════════════════════════════════════════════');
  console.log(`✅ UnLim Play API en puerto ${PORT}`);
  console.log('   • /api/proxy');
  console.log('   • /api/servers');
  console.log('   • /api/extract');
  console.log('   • /api/cinemaos');
  console.log('═══════════════════════════════════════════════');
});
