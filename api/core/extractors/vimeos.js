// api/core/extractors/vimeos.js
const { extractStream: puppeteerExtract } = require('../puppeteer-extractor');

// User-Agent crucial para que Vimeos no bloquee la petición
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function extractVimeos(embedUrl) {
  if (!embedUrl || !/vimeos/i.test(embedUrl)) return null;

  console.log('[vimeos] Iniciando extracción rápida:', embedUrl);

  // ══════════════════════════════════════════════════════════════════
  // USAMOS DIRECTAMENTE PUPPETEER OPTIMIZADO
  // ══════════════════════════════════════════════════════════════════
  try {
    // Límite estricto de 15 segundos para evitar que el token caduque
    const result = await puppeteerExtract(embedUrl, {
      timeout: 15000,
      referer: 'https://vimeos.net/',
      userAgent: UA
    });

    if (result && result.stream) {
      console.log('[vimeos] ✅ Stream encontrado en tiempo real:', result.stream.slice(0, 80));
      
      // 🔥 IMPORTANTE: Devolvemos la cookie capturada por Puppeteer
      return {
        stream: result.stream,
        kind: 'hls',
        referer: 'https://vimeos.net/', // Vimeos exige estrictamente este Referer
        userAgent: UA,
        cookie: result.cookie || ''     // <--- AÑADIDO: Pasamos la cookie hacia arriba
      };
    }
  } catch (e) {
    console.warn('[vimeos] ❌ Error en Puppeteer:', e.message);
  }

  return null;
}

module.exports = { extractVimeos };
