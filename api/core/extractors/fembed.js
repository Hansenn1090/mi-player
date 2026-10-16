// api/core/extractors/fembed.js
'use strict';

const axios = require('axios');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Fembed usa distintos dominios según el mirror
const FEMBED_HOSTS = /fembed\.com|fembed\.net|fembed\.to|femax20\.com|feurl\.com|fcdn\.stream|dutrag\.com|waaw\.to|waaw\.tv|vanfem\.com/i;

async function extractFembed(embedUrl) {
  if (!embedUrl || !FEMBED_HOSTS.test(embedUrl)) return null;

  console.log('[fembed] Extrayendo:', embedUrl);

  try {
    // 1) Convertir la URL del embed a formato "video id"
    // Ej: https://www.fembed.com/v/24qz3s25wgg8m0k  →  24qz3s25wgg8m0k
    const idMatch = embedUrl.match(/\/(v|f)\/([a-zA-Z0-9]+)/);
    if (!idMatch) {
      console.warn('[fembed] No pude extraer el ID del video');
      return null;
    }
    const videoId = idMatch[2];
    const origin = new URL(embedUrl).origin;

    // 2) Llamar al endpoint de la API (JSON)
    const apiUrl = `${origin}/api/source/${videoId}`;
    const { data } = await axios.post(apiUrl, '', {
      timeout: 12000,
      headers: {
        'User-Agent': UA,
        'Referer': embedUrl,
        'Accept': 'application/json, text/plain, */*',
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    if (!data || !data.data) {
      console.warn('[fembed] API sin data:', JSON.stringify(data).slice(0, 200));
      return null;
    }

    // data.data es un array [{ file, label, type }, ...]
    // A veces type = "hls" con m3u8, otras type = "mp4"
    const streams = data.data;
    if (!Array.isArray(streams) || streams.length === 0) return null;

    // Preferir el de mayor calidad / hls primero
    const hls = streams.find(s => /hls|m3u8/i.test(s.type || '') || /\.m3u8/i.test(s.file || ''));
    const mp4 = streams.find(s => /mp4/i.test(s.type || '') || /\.mp4/i.test(s.file || ''));
    const pick = hls || mp4 || streams[0];

    let streamUrl = pick.file;
    if (streamUrl.startsWith('//')) streamUrl = 'https:' + streamUrl;

    const kind = /\.m3u8/i.test(streamUrl) ? 'hls' : 'mp4';
    console.log(`[fembed] ✅ ${kind.toUpperCase()}:`, streamUrl.slice(0, 130));

    return {
      stream: streamUrl,
      kind,
      referer: origin + '/',
    };
  } catch (err) {
    console.warn('[fembed] Error:', err.message);
    return null;
  }
}

module.exports = { extractFembed };
