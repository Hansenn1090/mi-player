// api/core/extractors/watchsb.js
'use strict';

const axios = require('axios');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function extractWatchSB(embedUrl) {
  if (!embedUrl || !/watchsb/i.test(embedUrl)) return null;

  console.log('[watchsb] Extrayendo:', embedUrl);

  // WatchSB lleva caído desde 2024. Muchos mirrors devuelven 502/403 directo.
  try {
    const { data: html, status } = await axios.get(embedUrl, {
      timeout: 8000,
      headers: {
        'User-Agent': UA,
        'Referer': embedUrl,
      },
      validateStatus: s => s >= 200 && s < 500,
    });

    if (status >= 400) {
      console.warn(`[watchsb] HTTP ${status}, host caído`);
      return null;
    }

    // Buscar jwplayer setup o m3u8 directo
    const m3u8Match = html.match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/i);
    if (m3u8Match) {
      let url = m3u8Match[0];
      if (url.startsWith('//')) url = 'https:' + url;
      console.log('[watchsb] ✅ HLS:', url.slice(0, 130));
      return { stream: url, kind: 'hls', referer: embedUrl };
    }

    const mp4Match = html.match(/https?:\/\/[^"'\s<>]+\.mp4[^"'\s<>]*/i);
    if (mp4Match) {
      let url = mp4Match[0];
      if (url.startsWith('//')) url = 'https:' + url;
      console.log('[watchsb] ✅ MP4:', url.slice(0, 130));
      return { stream: url, kind: 'mp4', referer: embedUrl };
    }

    console.warn('[watchsb] ❌ No stream encontrado');
    return null;
  } catch (err) {
    console.warn('[watchsb] Error:', err.message);
    return null;
  }
}

module.exports = { extractWatchSB };
