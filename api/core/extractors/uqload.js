// api/core/extractors/uqload.js
/**
 * Uqload.vc — Extractor HLS (.m3u8)
 *
 * El player es JW Player (jw8) y la URL del stream está dentro de un
 * script ofuscado con eval() usando el packer de Dean Edwards:
 *
 *   eval(function(p,a,c,k,e,d){...}('...',36,409,'...'.split('|')))
 *
 * Al desempaquetarla se obtiene el setup del JW Player con:
 *   sources: [{ file: "https://strm10.uqload.vc/.../master.m3u8?t=..." }]
 *
 * La URL tiene auth por token válido ~4 horas (e=14400).
 */

const axios = require('axios');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ══════════════════════════════════════════════════════════════════
// Dean Edwards packer unpacker
// ══════════════════════════════════════════════════════════════════
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

// Extrae los argumentos del eval() del packer
function extractPackerArgs(html) {
  const startIdx = html.indexOf('eval(function(p,a,c,k,e,d)');
  if (startIdx === -1) return null;

  // Encontrar el fin de la definición de la función: "}('"
  const fnEnd = html.indexOf("}('", startIdx);
  if (fnEnd === -1) return null;

  const afterFn = html.slice(fnEnd + 2); // empieza con el primer '

  // Encontrar el cierre del packed string (primer ' no escapado)
  let packedEnd = -1;
  let esc = false;
  for (let i = 1; i < afterFn.length; i++) {
    const ch = afterFn[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === "'") { packedEnd = i; break; }
  }
  if (packedEnd === -1) return null;

  const packedStr = afterFn.slice(1, packedEnd);
  const rest = afterFn.slice(packedEnd + 1); // empieza con ,

  const argsMatch = rest.match(/^,(\d+),(\d+),'([^']*)'/);
  if (!argsMatch) return null;

  return {
    packedStr,
    base: parseInt(argsMatch[1], 10),
    count: parseInt(argsMatch[2], 10),
    tokens: argsMatch[3].split('|'),
  };
}

// ══════════════════════════════════════════════════════════════════
// Extractor principal
// ══════════════════════════════════════════════════════════════════
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

    // ─── Método 1: desempaquetar el eval del packer ─────────────
    const args = extractPackerArgs(html);
    if (args) {
      console.log('[uqload] Encontrado packer, desempaquetando...');
      const unpacked = unpackPacker(args.packedStr, args.base, args.count, args.tokens);

      // Buscar .m3u8 (HLS)
      const m3u8Match = unpacked.match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/i);
      if (m3u8Match) {
        let url = m3u8Match[0];
        if (url.startsWith('//')) url = 'https:' + url;
        console.log('[uqload] ✅ HLS:', url.slice(0, 130));
        return { stream: url, kind: 'hls', referer: embedUrl };
      }

      // Buscar .mp4
      const mp4Match = unpacked.match(/https?:\/\/[^"'\s<>]+\.mp4[^"'\s<>]*/i);
      if (mp4Match) {
        let url = mp4Match[0];
        if (url.startsWith('//')) url = 'https:' + url;
        console.log('[uqload] ✅ MP4:', url.slice(0, 130));
        return { stream: url, kind: 'mp4', referer: embedUrl };
      }

      // Log para debug si no encontramos nada
      console.warn('[uqload] ⚠️ Desempaquetado OK pero sin m3u8/mp4');
    } else {
      console.warn('[uqload] ⚠️ No se encontró el packer en el HTML');
    }

    // ─── Método 2: fallback — buscar URLs directas en el HTML ───
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
