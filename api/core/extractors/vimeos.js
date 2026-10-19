// api/core/extractors/vimeos.js
const axios = require('axios');
const { extractStream: puppeteerExtract } = require('../puppeteer-extractor');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function extractVimeos(embedUrl) {
  if (!embedUrl || !/vimeos/i.test(embedUrl)) return null;

  console.log('[vimeos] Iniciando extracción:', embedUrl);

  // ══════════════════════════════════════════════════════════════════
  // 1) INTENTO RÁPIDO CON AXIOS (Busca el .m3u8 directo en el HTML)
  // ══════════════════════════════════════════════════════════════════
  try {
    const { data: html } = await axios.get(embedUrl, {
      timeout: 10000,
      headers: {
        'User-Agent': UA,
        'Referer': 'https://vimeos.net/',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    // Buscar patrón de HLS (.m3u8)
    const m3u8Match = html.match(/https?:\/\/[^"'\s<>\\]+\.m3u8[^"'\s<>\\]*/i);
    if (m3u8Match) {
      let url = m3u8Match[0];
      if (url.startsWith('//')) url = 'https:' + url;
      console.log('[vimeos] ✅ Stream HLS encontrado (axios):', url.slice(0, 100));
      return { stream: url, kind: 'hls', referer: embedUrl };
    }

    // Buscar patrón de MP4 directo
    const mp4Match = html.match(/https?:\/\/[^"'\s<>\\]+\.mp4[^"'\s<>\\]*/i);
    if (mp4Match) {
      let url = mp4Match[0];
      if (url.startsWith('//')) url = 'https:' + url;
      console.log('[vimeos] ✅ Stream MP4 encontrado (axios):', url.slice(0, 100));
      return { stream: url, kind: 'mp4', referer: embedUrl };
    }

    console.log('[vimeos] ⚠️ Axios no encontró el stream (JS dinámico). Usando Puppeteer...');

  } catch (e) {
    console.warn('[vimeos] Axios falló:', e.message, '- Usando Puppeteer...');
  }

  // ══════════════════════════════════════════════════════════════════
  // 2) FALLBACK CON PUPPETEER (Ejecuta el JS e intercepta la red)
  // ══════════════════════════════════════════════════════════════════
  try {
    const result = await puppeteerExtract(embedUrl);
    if (result && result.stream) {
      console.log('[vimeos] ✅ Stream encontrado (Puppeteer):', result.stream.slice(0, 100));
      return {
        stream: result.stream,
        kind: 'hls', // Vimeos siempre usa HLS
        referer: embedUrl
      };
    }
  } catch (e) {
    console.warn('[vimeos] Error en Puppeteer:', e.message);
  }

  console.warn('[vimeos] ❌ No se pudo extraer el stream');
  return null;
}

module.exports = { extractVimeos };
