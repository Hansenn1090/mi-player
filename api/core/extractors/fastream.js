// api/core/extractors/fastream.js
'use strict';

const axios = require('axios');
const { unpack, extractM3U8 } = require('./unpacker');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function extractFastream(embedUrl) {
  console.log('[fastream] Extrayendo:', embedUrl.slice(0, 90));
  if (!embedUrl || !/fastream/i.test(embedUrl)) return null;

  try {
    const { data: html } = await axios.get(embedUrl, {
      timeout: 15000,
      headers: {
        'User-Agent': UA,
        'Referer': 'https://fastream.to/',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      validateStatus: s => s >= 200 && s < 400,
    });

    // 1. Desempaquetar el HTML si está ofuscado
    let unpackedHtml = html;
    if (/eval\(function\(p,a,c,k,e,[rd]\)/.test(html)) {
      console.log('[fastream] Packer detectado, desempaquetando...');
      unpackedHtml = unpack(html);
    }

    // 2. Buscar el m3u8 usando la regex del foro
    const match = unpackedHtml.match(/file\s*:\s*"([^"]+)"/);
    if (match && match[1]) {
      let streamUrl = match[1];
      if (streamUrl.startsWith('//')) streamUrl = 'https:' + streamUrl;
      
      const kind = /\.m3u8/i.test(streamUrl) ? 'hls' : 'mp4';
      console.log(`[fastream] ✅ ${kind.toUpperCase()}:`, streamUrl.slice(0, 130));
      
      return {
        stream: streamUrl,
        kind,
        referer: 'https://fastream.to/',
      };
    }

    // 3. Fallback: buscar m3u8 directamente en el HTML desempaquetado
    const m3u8 = extractM3U8(unpackedHtml);
    if (m3u8) {
      console.log('[fastream] ✅ HLS (fallback):', m3u8.slice(0, 130));
      return { stream: m3u8, kind: 'hls', referer: 'https://fastream.to/' };
    }

    console.warn('[fastream] ❌ No se encontró stream');
    return null;

  } catch (err) {
    console.warn('[fastream] Error:', err.message);
    return null;
  }
}

module.exports = { extractFastream };
