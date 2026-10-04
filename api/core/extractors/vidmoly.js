const axios = require('axios');
const cheerio = require('cheerio');
const { unpack, extractM3U8 } = require('./unpacker');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

async function extractVidmoly(embedUrl) {
  try {
    console.log('[vidmoly] Extrayendo:', embedUrl.slice(0, 80));

    const { data: html } = await axios.get(embedUrl, {
      timeout: 15000,
      headers: {
        'User-Agent': UA,
        'Referer': embedUrl,
        'Accept': 'text/html,application/xhtml+xml,*/*',
      },
    });

    // 1. Buscar m3u8 directo
    let m3u8 = extractM3U8(html);

    // 2. Buscar en el JSON embebido (Vidmoly usa jwplayer con "file":"...")
    if (!m3u8) {
      const match = html.match(/"file"\s*:\s*"([^"]+\.m3u8[^"]*)"/);
      if (match) m3u8 = match[1].replace(/\\/g, '');
    }

    // 3. Buscar en scripts ofuscados
    if (!m3u8) {
      const $ = cheerio.load(html);
      const scripts = $('script').map((i, el) => $(el).html()).get();
      for (const script of scripts) {
        if (!script) continue;
        const code = script.includes('eval(function(p,a,c,k,e,d)')
          ? unpack(script)
          : script;
        const found = extractM3U8(code);
        if (found) { m3u8 = found; break; }
        const fileMatch = code.match(/"file"\s*:\s*"([^"]+\.m3u8[^"]*)"/);
        if (fileMatch) { m3u8 = fileMatch[1].replace(/\\/g, ''); break; }
      }
    }

    if (!m3u8) {
      console.log('[vidmoly] No se encontró m3u8');
      return null;
    }

    console.log('[vidmoly] OK:', m3u8.slice(0, 80));
    return {
      stream: m3u8,
      kind: 'hls',
      referer: new URL(embedUrl).origin + '/',
    };
  } catch (e) {
    console.error('[vidmoly] Error:', e.message);
    return null;
  }
}

module.exports = { extractVidmoly };
