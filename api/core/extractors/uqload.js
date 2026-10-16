// api/core/extractors/uqload.js
'use strict';

const axios = require('axios');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function unpackPacker(packedStr, base, count, tokens) {
  let p = packedStr;
  let c = count;
  while (c--) {
    if (tokens[c]) {
      p = p.split(new RegExp('\\b' + c.toString(base) + '\\b', 'g')).join(tokens[c]);
    }
  }
  return p;
}

// ← FIX: regex flexible que acepta cualquier variante del packer
function extractPackerArgs(html) {
  const match = html.match(/eval\(function\(p,a,c,k,e,[a-z]\)[\s\S]*?\}\(\s*'([\s\S]+?)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([\s\S]+?)'\.split\('\|'\)/);
  if (!match) return null;

  return {
    packedStr: match[1].replace(/\\'/g, "'"),
    base: parseInt(match[2], 10),
    count: parseInt(match[3], 10),
    tokens: match[4].split('|'),
  };
}

async function extractUqload(embedUrl) {
  if (!embedUrl || !/uqload/i.test(embedUrl)) return null;

  console.log('[uqload] Extrayendo:', embedUrl);

  try {
    const { data: html } = await axios.get(embedUrl, {
      timeout: 12000,
      headers: {
        'User-Agent': UA,
        'Referer': embedUrl,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      },
      validateStatus: s => s >= 200 && s < 400,
      maxRedirects: 5,
    });

    console.log(`[uqload] HTML recibido: ${html.length} bytes`);

    // Detectar bloqueos/errores en el HTML
    if (/cloudflare|just a moment|cf-challenge|access denied|error_wrong_ip/i.test(html)) {
      console.warn('[uqload] ⚠️ HTML contiene challenge/bloqueo');
      return null;
    }

    // ─── Método 1: packer ───────────────────────────────────────
    const args = extractPackerArgs(html);
    if (args) {
      console.log(`[uqload] Packer detectado (b=${args.base}, c=${args.count}, tokens=${args.tokens.length})`);
      const unpacked = unpackPacker(args.packedStr, args.base, args.count, args.tokens);

      const m3u8Match = unpacked.match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/i);
      if (m3u8Match) {
        let url = m3u8Match[0];
        if (url.startsWith('//')) url = 'https:' + url;
        console.log('[uqload] ✅ HLS:', url.slice(0, 130));
        return { stream: url, kind: 'hls', referer: embedUrl };
      }

      const mp4Match = unpacked.match(/https?:\/\/[^"'\s<>]+\.mp4[^"'\s<>]*/i);
      if (mp4Match) {
        let url = mp4Match[0];
        if (url.startsWith('//')) url = 'https:' + url;
        console.log('[uqload] ✅ MP4:', url.slice(0, 130));
        return { stream: url, kind: 'mp4', referer: embedUrl };
      }

      console.warn('[uqload] ⚠️ Desempaquetado OK pero sin m3u8/mp4');
    } else {
      console.warn('[uqload] ⚠️ No se encontró packer (posible cambio de ofuscación)');
    }

    // ─── Método 2: URLs directas en el HTML ─────────────────────
    const directM3u8 = html.match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/i);
    if (directM3u8) {
      console.log('[uqload] ✅ HLS (fallback):', directM3u8[0].slice(0, 130));
      return { stream: directM3u8[0], kind: 'hls', referer: embedUrl };
    }

    const directMp4 = html.match(/https?:\/\/[^"'\s<>]+\.mp4[^"'\s<>]*/i);
    if (directMp4) {
      console.log('[uqload] ✅ MP4 (fallback):', directMp4[0].slice(0, 130));
      return { stream: directMp4[0], kind: 'mp4', referer: embedUrl };
    }

    console.warn('[uqload] ❌ No se encontró stream');
    return null;

  } catch (err) {
    console.warn('[uqload] Error:', err.message);
    return null;
  }
}

module.exports = { extractUqload };
