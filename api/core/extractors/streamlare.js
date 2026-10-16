// api/core/extractors/streamlare.js
'use strict';

const axios = require('axios');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function extractStreamLare(embedUrl) {
  if (!embedUrl || !/streamlare/i.test(embedUrl)) return null;

  console.log('[streamlare] Extrayendo:', embedUrl);

  try {
    // 1) GET al embed para obtener cookies + HTML
    const { data: html } = await axios.get(embedUrl, {
      timeout: 12000,
      headers: {
        'User-Agent': UA,
        'Referer': embedUrl,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      maxRedirects: 5,
    });

    // 2) Extraer el video id (de la URL, suele ser lo último)
    const idMatch = embedUrl.match(/\/(e|v|d)\/([a-zA-Z0-9]+)/);
    if (!idMatch) {
      console.warn('[streamlare] Sin ID en URL');
      return null;
    }
    const videoId = idMatch[2];
    const origin = new URL(embedUrl).origin;

    // 3) Buscar el hash / CSRF token en el HTML
    const hashMatch = html.match(/name="_token"\s+value="([^"]+)"/)
                   || html.match(/"csrf-token"\s+content="([^"]+)"/)
                   || html.match(/data-hash="([^"]+)"/);
    const token = hashMatch ? hashMatch[1] : null;

    // 4) POST al endpoint de la API que devuelve los sources
    const apiUrl = `${origin}/api/video/${videoId}`;
    const { data: apiData } = await axios.post(apiUrl, token ? { _token: token } : {}, {
      timeout: 12000,
      headers: {
        'User-Agent': UA,
        'Referer': embedUrl,
        'Origin': origin,
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      validateStatus: s => s >= 200 && s < 500,
    });

    if (apiData && apiData.result && apiData.result.sources) {
      const sources = apiData.result.sources;
      const hls = sources.find(s => /hls|m3u8/i.test(s.label || '') || /\.m3u8/i.test(s.file || ''));
      const mp4 = sources.find(s => /mp4/i.test(s.label || '') || /\.mp4/i.test(s.file || ''));
      const pick = hls || mp4 || sources[0];

      if (pick && pick.file) {
        let url = pick.file;
        if (url.startsWith('//')) url = 'https:' + url;
        const kind = /\.m3u8/i.test(url) ? 'hls' : 'mp4';
        console.log(`[streamlare] ✅ ${kind.toUpperCase()}:`, url.slice(0, 130));
        return { stream: url, kind, referer: origin + '/' };
      }
    }

    // 5) Fallback: buscar m3u8 directo en el HTML
    const m3u8Match = html.match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/i);
    if (m3u8Match) {
      let url = m3u8Match[0];
      if (url.startsWith('//')) url = 'https:' + url;
      console.log('[streamlare] ✅ HLS (fallback):', url.slice(0, 130));
      return { stream: url, kind: 'hls', referer: origin + '/' };
    }

    console.warn('[streamlare] ❌ No stream encontrado');
    return null;
  } catch (err) {
    console.warn('[streamlare] Error:', err.message);
    return null;
  }
}

module.exports = { extractStreamLare };
