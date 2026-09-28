async resolveEmbed(server) {
  try {
    // Método 1: intento rápido con axios (sin Puppeteer)
    const axios = require('axios');
    const { data: html } = await axios.get(server.url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0',
        'Referer': 'https://www.poseidonhd2.co/',
      },
      validateStatus: s => s >= 200 && s < 400,
    });

    const htmlStr = typeof html === 'string' ? html : JSON.stringify(html);
    const patterns = [
      /["'](https?:\/\/[^"']*\.m3u8[^"']*)["']/i,
      /file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i,
      /source\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i,
      /["'](\/\/[^"']*\.m3u8[^"']*)["']/i,
    ];

    for (const re of patterns) {
      const match = htmlStr.match(re);
      if (match && match[1]) {
        let hlsUrl = match[1];
        if (hlsUrl.startsWith('//')) hlsUrl = 'https:' + hlsUrl;
        console.log(`[poseidonhd2] ✅ HLS encontrado con axios: ${hlsUrl.substring(0, 80)}`);
        return hlsUrl;
      }
    }

    // Método 2: SI NO ENCONTRÓ → usar Puppeteer
    console.log(`[poseidonhd2] ⚙️ Usando Puppeteer para extraer...`);
    const { extractM3u8FromEmbed } = require('../core/puppeteer-extractor');
    const hlsUrl = await extractM3u8FromEmbed(server.url);
    
    if (hlsUrl) {
      return hlsUrl;
    }

    console.log(`[poseidonhd2] ❌ No se pudo extraer, usando iframe`);
    return server.url;
  } catch (e) {
    console.warn(`[poseidonhd2] Error: ${e.message}`);
    return server.url;
  }
}
