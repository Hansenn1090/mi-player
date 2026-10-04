const axios = require('axios');
const cheerio = require('cheerio');
const { unpack, extractM3U8 } = require('./unpacker');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

async function extractStreamWish(embedUrl) {
  try {
    console.log('[streamwish] Extrayendo:', embedUrl.slice(0, 80));

    const { data: html } = await axios.get(embedUrl, {
      timeout: 15000,
      headers: {
        'User-Agent': UA,
        'Referer': embedUrl,
        'Accept': 'text/html,application/xhtml+xml,*/*',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      },
    });

    // 1. Buscar m3u8 directo en el HTML
    let m3u8 = extractM3U8(html);

    // 2. Si no, buscar en los scripts
    if (!m3u8) {
      const $ = cheerio.load(html);
      const scripts = $('script').map((i, el) => $(el).html()).get();
      for (const script of scripts) {
        if (!script) continue;
        // Desempaquetar si tiene eval-packer
        const code = script.includes('eval(function(p,a,c,k,e,d)')
          ? unpack(script)
          : script;
        const found = extractM3U8(code);
        if (found) { m3u8 = found; break; }
      }
    }

    if (!m3u8) {
      console.log('[streamwish] No se encontró m3u8');
      return null;
    }

    console.log('[streamwish] OK:', m3u8.slice(0, 80));
    return {
      stream: m3u8,
      kind: 'hls',
      referer: new URL(embedUrl).origin + '/',
    };
  } catch (e) {
    console.error('[streamwish] Error:', e.message);
    return null;
  }
}

module.exports = { extractStreamWish };
