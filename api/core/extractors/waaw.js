// api/core/extractors/waaw.js
'use strict';

const axios = require('axios');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const WAAW_HOSTS = /waaw\.to|waaw\.tv|waaw\.ac|netu\.tv|hqq\.tv|hqq\.to|netu\.ac/i;

async function extractWaaw(embedUrl) {
  if (!embedUrl || !WAAW_HOSTS.test(embedUrl)) return null;

  console.log('[waaw] Extrayendo:', embedUrl);

  try {
    // Waaw/Netu usa URLs como: https://waaw.to/f/HKuSnCZwjGp1
    const idMatch = embedUrl.match(/\/(v|f|e)\/([a-zA-Z0-9]+)/);
    if (!idMatch) {
      console.warn('[waaw] No pude extraer el ID');
      return null;
    }
    const videoId = idMatch[2];
    const origin = new URL(embedUrl).origin;

    // Intentar primero el endpoint Fembed-style
    const endpoints = [
      `${origin}/api/source/${videoId}`,
      `${origin}/api/v/${videoId}`,
      `${origin}/e/${videoId}`,
    ];

    for (const apiUrl of endpoints) {
      try {
        const { data } = await axios.post(apiUrl, '', {
          timeout: 10000,
          headers: {
            'User-Agent': UA,
            'Referer': embedUrl,
            'Accept': 'application/json, text/plain, */*',
            'X-Requested-With': 'XMLHttpRequest',
          },
          validateStatus: s => s >= 200 && s < 400,
        });

        if (data && data.data && Array.isArray(data.data)) {
          const pick = data.data.find(s => /\.m3u8/i.test(s.file || ''))
                    || data.data.find(s => /\.mp4/i.test(s.file || ''))
                    || data.data[0];
          if (pick && pick.file) {
            let streamUrl = pick.file;
            if (streamUrl.startsWith('//')) streamUrl = 'https:' + streamUrl;
            const kind = /\.m3u8/i.test(streamUrl) ? 'hls' : 'mp4';
            console.log(`[waaw] ✅ ${kind.toUpperCase()}:`, streamUrl.slice(0, 130));
            return { stream: streamUrl, kind, referer: origin + '/' };
          }
        }
      } catch (e) {
        // Probar el siguiente endpoint
      }
    }

    // Fallback: scrapear el HTML y buscar m3u8
    try {
      const { data: html } = await axios.get(embedUrl, {
        timeout: 12000,
        headers: {
          'User-Agent': UA,
          'Referer': embedUrl,
        },
      });

      const m3u8Match = html.match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/i);
      if (m3u8Match) {
        let url = m3u8Match[0];
        if (url.startsWith('//')) url = 'https:' + url;
        console.log('[waaw] ✅ HLS (fallback):', url.slice(0, 130));
        return { stream: url, kind: 'hls', referer: origin + '/' };
      }
    } catch (e) { /* noop */ }

    console.warn('[waaw] ❌ No se encontró stream');
    return null;
  } catch (err) {
    console.warn('[waaw] Error:', err.message);
    return null;
  }
}

module.exports = { extractWaaw };
