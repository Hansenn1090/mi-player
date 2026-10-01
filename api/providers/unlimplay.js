const axios = require('axios');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function scrapeUnlimplay(tmdbId, type = 'movie') {
  const found = {};
  if (!tmdbId) return found;

  const urls = [
    `https://unlimplay.com/f/embed/${type}/${tmdbId}`,
    `https://unlimplay.com/f/embed/movie/${tmdbId}`,
  ];

  for (const url of urls) {
    try {
      console.log('[unlimplay] Probando:', url);
      const { data: html } = await axios.get(url, {
        timeout: 15000,
        headers: {
          'User-Agent': UA,
          'Referer': 'https://unlimplay.com/',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'es-ES,es;q=0.9',
        },
        validateStatus: s => s >= 200 && s < 400,
        maxRedirects: 5,
      });

      if (!html || typeof html !== 'string') continue;

      // Buscar finalizePlayer({...})
      const regex1 = /finalizePlayer\s*\(\s*(\{[\s\S]*?\})\s*\)/;
      const match1 = html.match(regex1);

      if (match1 && match1[1]) {
        try {
          const data = JSON.parse(match1[1]);
          console.log('[unlimplay] JSON con', Object.keys(data).length, 'idiomas');
          for (const lang of Object.keys(data)) {
            if (!found[lang]) found[lang] = {};
            Object.assign(found[lang], data[lang]);
          }
          if (Object.keys(found).length > 0) {
            console.log('[unlimplay] ✅', Object.entries(found).map(([l, s]) => `${l}:${Object.keys(s).length}`).join(' '));
            return found;
          }
        } catch (e) {
          console.warn('[unlimplay] JSON parse error:', e.message);
        }
      }

      // Fallback: buscar URLs de servidores
      const serversRegex = /"(streamwish|filelions|voe|vidhide|doodstream|fastream|vidmoly|uqload|vidspeed|filemoon|streamtape|mixdrop|pelixplay)"\s*:\s*"(https?:\/\/[^"]+)"/gi;
      let m, count = 0;
      while ((m = serversRegex.exec(html)) !== null) {
        if (!found.latino) found.latino = {};
        if (!found.latino[m[1].toLowerCase()]) {
          found.latino[m[1].toLowerCase()] = m[2];
          count++;
        }
      }
      if (count > 0) {
        console.log('[unlimplay] ✅', count, 'servidores por regex');
        return found;
      }
    } catch (e) {
      console.warn('[unlimplay] Error:', url, e.message);
    }
  }

  console.log('[unlimplay] Sin servidores para TMDB', tmdbId);
  return found;
}

module.exports = { scrapeUnlimplay };
console.log('[unlimplay] Provider cargado');
