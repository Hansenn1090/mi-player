/**
 * =====================================================================
 *  API UNIFICADA — mi-player-api
 * ---------------------------------------------------------------------
 *  Incluye:
 *    - Extractor y Proxy de Vimeo (HLS / MP4)
 *    - Rutas para tu scraper con Puppeteer (películas)
 * =====================================================================
 */

'use strict';

const express = require('express');
const axios   = require('axios');
const cors    = require('cors');
const { URL } = require('url');

// ─────────────────────────────────────────────────────────────────────
//  CONFIGURACIÓN
// ─────────────────────────────────────────────────────────────────────
const CONFIG = {
  PORT: process.env.PORT || 10000, // Render usa 10000 por defecto en Docker
  VIMEO_UA: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  TIMEOUT_MS: 15000,
  CACHE_TTL_MS: 8 * 60 * 1000,
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || '*',
  ALLOWED_HOST_PATTERNS: [
    /^player\.vimeo\.com$/i,
    /^vimeo\.com$/i,
    /^[a-z0-9-]+(\.[a-z0-9-]+)*\.vimeo\.com$/i,
    /^[a-z0-9-]+(\.[a-z0-9-]+)*\.vimeocdn\.com$/i,
    /^[a-z0-9-]+(\.[a-z0-9-]+)*\.vod-progressive\.akamaized\.net$/i,
    /^vod-progressive\.akamaized\.net$/i,
  ],
};

// ─────────────────────────────────────────────────────────────────────
//  CACHÉ EN MEMORIA
// ─────────────────────────────────────────────────────────────────────
const cache = new Map();
const getCache = (k) => {
  const hit = cache.get(k);
  if (!hit) return null;
  if (Date.now() > hit.exp) { cache.delete(k); return null; }
  return hit.val;
};
const setCache = (k, v) =>
  cache.set(k, { val: v, exp: Date.now() + CONFIG.CACHE_TTL_MS });
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of cache) if (now > v.exp) cache.delete(k);
}, 60_000).unref();

// ─────────────────────────────────────────────────────────────────────
//  HELPERS VIMEO
// ─────────────────────────────────────────────────────────────────────
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

function parseVimeoInput(input) {
  if (!input) throw new Error('Falta el parámetro url o id');
  if (/^\d+$/.test(String(input).trim())) {
    return { videoId: String(input).trim(), videoHash: null };
  }
  let u;
  try { u = new URL(input); }
  catch { throw new Error('URL inválida'); }

  const m = u.pathname.match(/(?:video\/)?(\d+)(?:\/([a-zA-Z0-9]+))?/);
  if (!m) throw new Error('No se pudo extraer el ID de Vimeo');
  return {
    videoId: m[1],
    videoHash: m[2] || u.searchParams.get('h') || null,
  };
}

async function fetchVimeoConfig(videoId, videoHash, referer) {
  const hashParam = videoHash ? `?h=${videoHash}` : '';
  const url = `https://player.vimeo.com/video/${videoId}/config${hashParam}`;

  const res = await axios.get(url, {
    headers: {
      'User-Agent': CONFIG.VIMEO_UA,
      'Referer':    referer || `https://player.vimeo.com/video/${videoId}`,
      'Origin':     'https://player.vimeo.com',
      'Accept':     'application/json, text/plain, */*',
    },
    timeout: CONFIG.TIMEOUT_MS,
    validateStatus: (s) => s >= 200 && s < 400,
  });
  return res.data;
}

function pickBestStream(config) {
  const files = config?.request?.files || {};
  const qualities = [];

  if (files.hls?.cdns) {
    const cdns = files.hls.cdns;
    const defaultCdn = files.hls.default_cdn || Object.keys(cdns)[0];
    const cdn = cdns[defaultCdn];
    const masterUrl = cdn?.avc_url || cdn?.url;
    if (masterUrl) {
      qualities.push({ type: 'hls', url: masterUrl, quality: 'auto' });
      for (const [k, v] of Object.entries(cdns)) {
        if (v?.url && v.url !== masterUrl) {
          qualities.push({ type: 'hls', url: v.url, quality: k });
        }
      }
      return { format: 'hls', streamUrl: masterUrl, qualities };
    }
  }

  if (Array.isArray(files.progressive) && files.progressive.length) {
    const sorted = [...files.progressive].sort((a, b) => (b.height || 0) - (a.height || 0));
    for (const p of sorted) {
      qualities.push({
        type: 'mp4',
        url: p.url,
        quality: p.quality || `${p.height}p`,
        width: p.width, height: p.height, fps: p.fps,
      });
    }
    return { format: 'mp4', streamUrl: sorted[0].url, qualities };
  }

  throw new Error('No hay streams disponibles (HLS/MP4) en el config');
}

function wrapProxy(req, type, url) {
  const base = publicBaseUrl(req);
  const ep = type === 'hls' ? '/api/vimeo/hls' : '/api/vimeo/proxy';
  return `${base}${ep}?url=${encodeURIComponent(url)}`;
}

// ─────────────────────────────────────────────────────────────────────
//  APP
// ─────────────────────────────────────────────────────────────────────
const app = express();
app.set('trust proxy', 1);
app.use(cors({
  origin: CONFIG.ALLOWED_ORIGINS === '*' ? true : CONFIG.ALLOWED_ORIGINS.split(','),
  methods: ['GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Range'],
  exposedHeaders: ['Content-Length', 'Content-Range', 'Accept-Ranges'],
}));

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl.slice(0, 140)}`);
  next();
});

// ── RUTA RAÍZ (Interfaz visual)
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>mi-player-api</title>
      <style>
        body { font-family: system-ui, sans-serif; background: #0d0d18; color: #f0f0f5; padding: 2rem; }
        h1 { color: #8b5cf6; }
        input { width: 100%; max-width: 400px; padding: 10px; border-radius: 8px; border: 1px solid #333; background: #1a1a28; color: white; margin-bottom: 10px; }
        button { padding: 10px 20px; border-radius: 8px; border: none; background: #7c5cff; color: white; font-weight: bold; cursor: pointer; }
        pre { background: #1a1a28; padding: 1rem; border-radius: 8px; border: 1px solid #333; overflow-x: auto; max-width: 800px; }
        .endpoint { color: #4f7fff; font-family: monospace; }
      </style>
    </head>
    <body>
      <h1>🎬 API en Línea</h1>
      <p>Servidor funcionando correctamente.</p>
      
      <h3>Endpoints de Vimeo:</h3>
      <ul>
        <li><span class="endpoint">GET /api/vimeo/extract?url=...</span></li>
        <li><span class="endpoint">GET /api/vimeo/hls?url=...</span></li>
        <li><span class="endpoint">GET /api/vimeo/proxy?url=...</span></li>
      </ul>

      <hr style="border-color: #333; margin: 2rem 0;">

      <h3>Probar extracción de Vimeo:</h3>
      <input id="vurl" type="text" value="https://vimeo.com/76979871" placeholder="URL de Vimeo">
      <button onclick="testExtract()">Extraer Video</button>
      
      <pre id="out" style="margin-top: 20px; display: none;"></pre>

      <script>
        async function testExtract() {
          const url = document.getElementById('vurl').value;
          const out = document.getElementById('out');
          out.style.display = 'block';
          out.textContent = 'Cargando...';
          try {
            const res = await fetch('/api/vimeo/extract?url=' + encodeURIComponent(url));
            const data = await res.json();
            out.textContent = JSON.stringify(data, null, 2);
          } catch(e) {
            out.textContent = 'Error: ' + e.message;
          }
        }
      </script>
    </body>
    </html>
  `);
});

// ── HEALTH (Render usa esta ruta para saber si está vivo)
app.get('/api/health', (_req, res) =>
  res.json({ ok: true, uptime: process.uptime(), now: new Date().toISOString() })
);
// Alias de compatibilidad
app.get('/health', (_req, res) => res.redirect('/api/health'));

// ── EXTRACT VIMEO
app.get('/api/vimeo/extract', async (req, res) => {
  try {
    const { url, referer, format: prefer } = req.query;
    const { videoId, videoHash } = parseVimeoInput(url);

    const cKey = `extract:${videoId}:${videoHash || ''}:${referer || ''}`;
    const cached = getCache(cKey);
    if (cached) return res.json({ ...cached, cached: true });

    const config = await fetchVimeoConfig(videoId, videoHash, referer);
    const { format, streamUrl, qualities } = pickBestStream(config);

    let finalFormat = format;
    let finalUrl = streamUrl;
    if (prefer && prefer !== format) {
      const alt = qualities.find((q) => q.type === prefer);
      if (alt) { finalFormat = prefer; finalUrl = alt.url; }
    }

    const meta = config.video || {};
    const payload = {
      success: true,
      videoId,
      videoHash,
      title: meta.title,
      duration: meta.duration,
      thumbnail: meta.thumbs?.['1280'] || meta.thumbs?.['640'] || meta.thumbs?.['320'],
      width: meta.width,
      height: meta.height,
      format: finalFormat,
      directUrl: finalUrl,
      streamUrl: wrapProxy(req, finalFormat === 'hls' ? 'hls' : 'proxy', finalUrl),
      qualities: qualities.map((q) => ({
        ...q,
        proxyUrl: wrapProxy(req, q.type === 'hls' ? 'hls' : 'proxy', q.url),
      })),
    };

    setCache(cKey, payload);
    res.json(payload);
  } catch (err) {
    console.error('[extract]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── HLS PLAYLIST REWRITER
app.get('/api/vimeo/hls', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'Falta ?url' });
    const target = assertAllowedUrl(url);

    const upstream = await axios.get(target.href, {
      headers: { 'User-Agent': CONFIG.VIMEO_UA, 'Referer': 'https://player.vimeo.com/' },
      timeout: CONFIG.TIMEOUT_MS,
      responseType: 'text',
      transformResponse: [(x) => x],
    });

    const origin = publicBaseUrl(req);
    let text = String(upstream.data || '');

    text = text.replace(/URI="([^"]+)"/g, (_m, uri) => {
      const abs = new URL(uri, target).href;
      return `URI="${origin}/api/vimeo/proxy?url=${encodeURIComponent(abs)}"`;
    });

    text = text.split('\n').map((line) => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return line;
      const abs = new URL(t, target).href;
      const isPlaylist = /\.m3u8(\?|$)/i.test(abs);
      const ep = isPlaylist ? '/api/vimeo/hls' : '/api/vimeo/proxy';
      return `${origin}${ep}?url=${encodeURIComponent(abs)}`;
    }).join('\n');

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-store');
    res.send(text);
  } catch (err) {
    console.error('[hls]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── BINARY PROXY
app.get('/api/vimeo/proxy', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'Falta ?url' });
    const target = assertAllowedUrl(url);

    const headers = {
      'User-Agent': CONFIG.VIMEO_UA,
      'Referer': 'https://player.vimeo.com/',
    };
    if (req.headers.range) headers.Range = req.headers.range;

    const upstream = await axios({
      method: 'GET',
      url: target.href,
      headers,
      timeout: CONFIG.TIMEOUT_MS,
      responseType: 'stream',
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 400,
    });

    for (const h of [
      'content-type', 'content-length', 'content-range',
      'accept-ranges', 'cache-control', 'last-modified', 'etag',
    ]) {
      if (upstream.headers[h]) res.setHeader(h, upstream.headers[h]);
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers',
      'Content-Length, Content-Range, Accept-Ranges');

    res.status(upstream.status);
    upstream.data.pipe(res);

    upstream.data.on('error', () => { try { res.end(); } catch {} });
    req.on('close', () => { try { upstream.data.destroy(); } catch {} });
  } catch (err) {
    console.error('[proxy]', err.message);
    if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
    else try { res.end(); } catch {}
  }
});

// ─────────────────────────────────────────────────────────────────────
// 🔥 AQUÍ DEBES PEGAR TUS RUTAS DE PELÍCULAS / PUPPETEER
// ─────────────────────────────────────────────────────────────────────
// Ejemplo:
// app.get('/api/servers', async (req, res) => { ... });
// app.get('/api/extract', async (req, res) => { ... });
// app.get('/api/proxy', async (req, res) => { ... });
//
// NOTA: Asegúrate de que no haya conflictos con las rutas /api/vimeo/* de arriba.

// ── 404 / ERROR HANDLER
app.use((_req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));
app.use((err, _req, res, _next) => {
  console.error('[global]', err);
  if (!res.headersSent) res.status(500).json({ error: err.message || 'Error interno' });
});

// ─────────────────────────────────────────────────────────────────────
//  ARRANQUE / APAGADO LIMPIO
// ─────────────────────────────────────────────────────────────────────
const server = app.listen(CONFIG.PORT, () => {
  console.log('──────────────────────────────────────────────────');
  console.log(`  mi-player-api en puerto ${CONFIG.PORT}`);
  console.log(`  http://localhost:${CONFIG.PORT}`);
  console.log('──────────────────────────────────────────────────');
});

const shutdown = (sig) => {
  console.log(`\n[${sig}] Cerrando servidor…`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('unhandledRejection', (r) => console.error('[unhandledRejection]', r));
process.on('uncaughtException',  (e) => console.error('[uncaughtException]',  e));
