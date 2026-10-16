// api/core/extractors/doodstream.js
'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

// Agente HTTPS con keepAlive para mantener la conexión (útil contra Cloudflare)
const httpsAgent = new https.Agent({
  keepAlive: true,
  rejectUnauthorized: false,
});

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function extractDoodstream(embedUrl) {
  try {
    const urlObj = new URL(embedUrl);
    const origin = urlObj.origin; // ej. https://doodstream.com

    // ─── 1. Request inicial para capturar cookies de sesión ───
    let initial;
    try {
      initial = await axios.get(embedUrl, {
        headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*' },
        maxRedirects: 0,
        validateStatus: (s) => s >= 200 && s < 400,
        timeout: 15000,
        httpsAgent,
      });
    } catch (e) {
      if (e.response && e.response.headers) initial = e.response;
      else throw e;
    }

    const setCookie = initial.headers['set-cookie'];
    const cookies = Array.isArray(setCookie)
      ? setCookie.map(c => c.split(';')[0]).join('; ')
      : (setCookie ? setCookie.split(';')[0] : '');

    // ─── 2. Segundo request siguiendo el redirect, con las cookies ───
    let followUrl = embedUrl;
    if (initial.status >= 300 && initial.status < 400 && initial.headers.location) {
      followUrl = initial.headers.location;
      if (followUrl.startsWith('/')) followUrl = origin + followUrl;
    }

    const finalResponse = await axios.get(followUrl, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,*/*',
        'Referer': origin + '/',
        ...(cookies ? { Cookie: cookies } : {}),
      },
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 400,
      timeout: 15000,
      httpsAgent,
    });

    const html = typeof finalResponse.data === 'string'
      ? finalResponse.data
      : JSON.stringify(finalResponse.data);

    // ─── 3. Extraer el token pass_md5 Y los parámetros token/expiry ───
    // Este patrón está basado en el extractor de mediaflow-proxy
    const pattern = /(\/pass_md5\/.*?)'.*(\?token=.*?expiry=)/;
    const match = html.match(pattern);

    if (!match) {
      console.warn('[doodstream] No se encontró el patrón pass_md5/token/expiry');
      return null;
    }

    const passMd5Path = match[1];   // ej. /pass_md5/abc123xyz
    const tokenExpiry = match[2];   // ej. ?token=XYZ&expiry=1234567890

    // ─── 4. Llamar a pass_md5 para obtener la URL base del video ───
    const passUrl = `${origin}${passMd5Path}`;
    const passResponse = await axios.get(passUrl, {
      headers: {
        'User-Agent': UA,
        'Referer': followUrl,
        'X-Requested-With': 'XMLHttpRequest',
        ...(cookies ? { Cookie: cookies } : {}),
      },
      timeout: 15000,
      httpsAgent,
    });

    const baseUrl = String(passResponse.data || '').trim();
    if (!baseUrl || !baseUrl.startsWith('http')) {
      console.warn('[doodstream] pass_md5 no devolvió una URL base válida');
      return null;
    }

    // ─── 5. Construir la URL final con token y expiry reales ───
    const timestamp = Date.now();
    // El string "123456789" es un padding conocido que usa el reproductor
    const finalStream = `${baseUrl}123456789${tokenExpiry}${timestamp}`;

    console.log(`[doodstream] ✅ Stream: ${finalStream.slice(0, 110)}`);
    return {
      stream: finalStream,
      kind: 'mp4',
      referer: origin + '/',
    };
  } catch (err) {
    console.warn('[doodstream] Error crítico:', err.message);
    return null;
  }
}

module.exports = { extractDoodstream };
