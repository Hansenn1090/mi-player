// api/core/extractors/fembed.js
'use strict';

const axios = require('axios');
const https = require('https');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Fembed tiene certificados TLS mal configurados en varios mirrors.
// Relajamos la validación SOLO para este host.
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const FEMBED_HOSTS = /fembed\.com|fembed\.net|fembed\.to|femax20\.com|feurl\.com|fcdn\.stream|dutrag\.com|vanfem\.com/i;

async function extractFembed(embedUrl) {
  if (!embedUrl || !FEMBED_HOSTS.test(embedUrl)) return null;

  console.log('[fembed] Extrayendo:', embedUrl);

  try {
    const idMatch = embedUrl.match(/\/(v|f)\/([a-zA-Z0-9]+)/);
    if (!idMatch) {
      console.warn('[fembed] No pude extraer el ID');
      return null;
    }
    const videoId = idMatch[2];
    const origin = new URL(embedUrl).origin;

    const { data } = await axios.post(`${origin}/api/source/${videoId}`, '', {
      timeout: 12000,
      httpsAgent,   // ← FIX TLS
      headers: {
        'User-Agent': UA,
        'Referer': embedUrl,
        'Accept': 'application/json, text/plain, */*',
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    if (!data || !data.data) {
      console.warn('[fembed] API sin data');
      return null;
    }
    if (!Array.isArray(data.data) || data.data.length === 0) return null;

    const hls = data.data.find(s => /hls|m3u8/i.test(s.type || '') || /\.m3u8/i.test(s.file || ''));
    const mp4 = data.data.find(s => /mp4/i.test(s.type || '') || /\.mp4/i.test(s.file || ''));
    const pick = hls || mp4 || data.data[0];
    if (!pick || !pick.file) return null;

    let streamUrl = pick.file;
    if (streamUrl.startsWith('//')) streamUrl = 'https:' + streamUrl;
    const kind = /\.m3u8/i.test(streamUrl) ? 'hls' : 'mp4';
    console.log(`[fembed] ✅ ${kind.toUpperCase()}:`, streamUrl.slice(0, 130));

    return { stream: streamUrl, kind, referer: origin + '/' };
  } catch (err) {
    console.warn('[fembed] Error:', err.message);
    return null;
  }
}

module.exports = { extractFembed };
