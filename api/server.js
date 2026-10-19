/**
 * =====================================================================
 *  VIMEO EXTRACTOR API — server.js
 * ---------------------------------------------------------------------
 *  Extrae streams directos (HLS / MP4) de Vimeo y los sirve mediante
 *  proxy CORS-safe para que un reproductor externo (Video.js, Plyr,
 *  <video> nativo) tome el control de la reproducción.
 *
 *  Endpoints:
 *    GET /health
 *    GET /api/vimeo/extract?url=<vimeo-url|id>[&referer=<url>][&format=hls|mp4]
 *    GET /api/vimeo/hls?url=<m3u8>       (uso interno / reproductor HLS)
 *    GET /api/vimeo/proxy?url=<segment>  (uso interno / reproductor HLS/MP4)
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
  PORT: process.env.PORT || 3000,
  VIMEO_UA: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  TIMEOUT_MS: 15000,
  CACHE_TTL_MS: 8 * 60 * 1000,     // 8 min (las URLs de Vimeo caducan en ~15)
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || '*',
  // Allowlist de hosts para evitar SSRF / open proxy
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
//  HELPERS
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

/**
 * Acepta: URL de Vimeo, URL de player, o solo el ID numérico.
 * Devuelve { videoId, videoHash } — el hash es necesario para videos
 * no listados (unlisted/private).
 */
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

/** Llama al endpoint /config no oficial de Vimeo. */
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

/** Devuelve { format, streamUrl, qualities } desde el config de Vimeo. */
function pickBestStream(config) {
  const files = config?.request?.files || {};
  const qualities = [];

  // 1) HLS — preferido por ser adaptativo
  if (files.hls?.cdns) {
    const cdns = files.hls.cdns;
    const defaultCdn = files.hls.default_cdn || Object.keys(cdns)[0];
    const cdn = cdns[defaultCdn];
    // avc_url es la variante AVC (máxima compatibilidad)
    const masterUrl = cdn?.avc_url || cdn?.url;
    if (masterUrl) {
      qualities.push({ type: 'hls', url: masterUrl, quality: 'auto' });
      // Si hay variantes explícitas, exponerlas
      for (const [k, v] of Object.entries(cdns)) {
        if (v?.url && v.url !== masterUrl) {
          qualities.push({ type: 'hls', url: v.url, quality: k });
        }
      }
      return { format: 'hls', streamUrl: masterUrl, qualities };
    }
  }

  // 2) Progressive MP4
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

/** Envuelve una URL de Vimeo a través de nuestro proxy. */
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

// ── HEALTH
app.get('/health', (_req, res) =>
  res.json({ ok: true, uptime: process.uptime(), now: new Date().toISOString() })
);

// ── EXTRACT
// GET /api/vimeo/extract?url=<vimeo-url|id>[&referer=...][&format=hls|mp4]
app.get('/api/vimeo/extract', async (req, res) => {
  try {
    const { url, referer, format: prefer } = req.query;
    const { videoId, videoHash } = parseVimeoInput(url);

    const cKey = `extract:${videoId}:${videoHash || ''}:${referer || ''}`;
    const cached = getCache(cKey);
    if (cached) return res.json({ ...cached, cached: true });

    const config = await fetchVimeoConfig(videoId, videoHash, referer);
    const { format, streamUrl, qualities } = pickBestStream(config);

    // Reordenar si el cliente pidió un formato específico
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
      // URL directa (caduca en ~15 min y NO es CORS-safe)
      directUrl: finalUrl,
      // URL proxificada — usa esta en el cliente
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
// Descarga el .m3u8 y reescribe todas las URLs para que vuelvan a pasar
// por este servidor (sub-playlists → /hls, segmentos/keys → /proxy).
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

    // 1) Reescribe atributos URI="..." en #EXT-X-MAP / #EXT-X-KEY / #EXT-X-MEDIA
    text = text.replace(/URI="([^"]+)"/g, (_m, uri) => {
      const abs = new URL(uri, target).href;
      return `URI="${origin}/api/vimeo/proxy?url=${encodeURIComponent(abs)}"`;
    });

    // 2) Reescribe URLs "sueltas" (una por línea)
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

// ── BINARY PROXY (segmentos HLS, keys, init maps, MP4)
// Soporta Range → permite seeking en MP4.
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

    // Propaga cabeceras relevantes (incluye Range)
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
  console.log(`  Vimeo Extractor API`);
  console.log(`  http://localhost:${CONFIG.PORT}`);
  console.log(`  Prueba: /api/vimeo/extract?url=https://vimeo.com/76979871`);
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
