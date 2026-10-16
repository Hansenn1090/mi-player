// api/core/extractors/filelions.js
'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');
const { unpack, extractM3U8 } = require('./unpacker');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// FileLions/VidHide tienen TLS variable — relajamos para evitar errores de cert
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

async function extractFileLions(embedUrl) {
  if (!embedUrl) return null;

  try {
    console.log('[filelions] Extrayendo:', embedUrl.slice(0, 90));

    // ═══════════════════════════════════════════════════════════════
    // ⚠️ FIX: NO reescribir el dominio. Cada mirror tiene su propia BD.
    // Usamos la URL original tal cual.
    // ═══════════════════════════════════════════════════════════════
    const url = embedUrl;

    const { data: html, status } = await axios.get(url, {
      timeout: 15000,
      httpsAgent,
      headers: {
        'User-Agent': UA,
        'Referer': url,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        'Sec-Fetch-Dest': 'iframe',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'cross-site',
        'Upgrade-Insecure-Requests': '1',
      },
      maxRedirects: 5,
      validateStatus: s => s >= 200 && s < 500,
    });

    console.log(`[filelions] HTML recibido: ${html.length} bytes (HTTP ${status})`);

    // ─── Detección de bloqueo ───
    if (html.length < 500) {
      console.warn('[filelions] HTML demasiado corto — bloqueo probable');
      console.warn('[filelions] Preview:', String(html).slice(0, 200).replace(/\s+/g, ' '));
      return null;
    }

    if (/cloudflare|just a moment|cf-challenge|access denied/i.test(html)) {
      console.warn('[filelions] Challenge/403 detectado');
      return null;
    }

    // ═══════════════════════════════════════════════════════════════
    // 1) Intento directo: m3u8 en HTML plano
    // ═══════════════════════════════════════════════════════════════
    let m3u8 = extractM3U8(html);

    // ═══════════════════════════════════════════════════════════════
    // 2) Buscar en scripts (unpack si tiene packer)
    // ═══════════════════════════════════════════════════════════════
    if (!m3u8) {
      const $ = cheerio.load(html);
      const scripts = $('script').map((i, el) => $(el).html()).get();

      for (const script of scripts) {
        if (!script) continue;

        // Si tiene packer, desempaquetar
        let code = script;
        if (script.includes('eval(function(p,a,c,k,e,d)')) {
          try {
            code = unpack(script);
          } catch (e) {
            continue;
          }
        }

        const found = extractM3U8(code);
        if (found) { m3u8 = found; break; }
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // 3) Fallback: buscar mp4 directo
    // ═══════════════════════════════════════════════════════════════
    if (!m3u8) {
      const mp4Match = html.match(/https?:\/\/[^"'\s<>\\]+\.mp4[^"'\s<>\\]*/i);
      if (mp4Match) {
        let mp4Url = mp4Match[0];
        if (mp4Url.startsWith('//')) mp4Url = 'https:' + mp4Url;
        console.log('[filelions] ✅ MP4:', mp4Url.slice(0, 90));
        return { stream: mp4Url, kind: 'mp4', referer: url };
      }
    }

    if (!m3u8) {
      console.log('[filelions] ❌ No se encontró m3u8 ni mp4');
      return null;
    }

    console.log('[filelions] ✅ HLS:', m3u8.slice(0, 90));
    return {
      stream: m3u8,
      kind: 'hls',
      referer: url,   // ← FIX: referer debe ser el mismo dominio del embed
    };
  } catch (e) {
    console.error('[filelions] Error:', e.message);
    return null;
  }
}

module.exports = { extractFileLions };
