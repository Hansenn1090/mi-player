const axios = require('axios');
const cheerio = require('cheerio');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
const BASE = 'https://pelixplay.app';

// ══════════════════════════════════════════════════════════════════════
// Extrae los servidores de pelixplay.app
// API interna que usa pelixplay: /api.php?action=details&id=XXX&type=movie
// ══════════════════════════════════════════════════════════════════════
async function search(title, year, tmdbId, type) {
  try {
    const apiParams = new URLSearchParams({
      action: 'details',
      id: tmdbId,
      type: type || 'movie',
    });

    // 1) Consultar la API pública de pelixplay
    const apiUrl = `${BASE}/api.php?${apiParams.toString()}`;
    const res = await axios.get(apiUrl, {
      headers: {
        'User-Agent': UA,
        'Referer': `${BASE}/`,
        'Accept': 'application/json',
      },
      timeout: 15000,
    });

    const data = res.data;
    if (!data || !data.ok) return null;

    // 2) Normalizar la respuesta
    const result = { latino: {}, subtitulado: {} };

    // pelixplay devuelve all_embeds o embeds según la versión
    const allEmbeds = data.all_embeds || { [data.language || 'latino']: data.embeds || {} };

    for (const [lang, servers] of Object.entries(allEmbeds)) {
      const targetLang = (lang === 'latino' || lang === 'español') ? 'latino' : 'subtitulado';
      for (const [serverName, urls] of Object.entries(servers)) {
        const urlList = Array.isArray(urls) ? urls : [urls];
        const firstUrl = urlList[0];
        if (!firstUrl) continue;

        // Normalizar el nombre del servidor
        const norm = normalizeName(serverName);
        if (norm) {
          result[targetLang][norm] = firstUrl;
        }
      }
    }

    return result;
  } catch (err) {
    console.error('[pelixplay]', err.message);
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════════
// Normaliza el nombre del servidor al que espera el registry
// ══════════════════════════════════════════════════════════════════════
function normalizeName(name) {
  const base = String(name).toLowerCase().replace(/[\s_-]+\d+$/, '');
  if (['streamwish', 'hglink', 'flaswish', 'wishfast', 'awish'].includes(base)) return 'StreamWish';
  if (['vidmoly'].includes(base)) return 'Vidmoly';
  if (['filelions', 'vidhide', 'vidhidepro', 'minochinos', 'callistanise'].includes(base)) return 'FileLions';
  return null; // Ignorar los demás
}

module.exports = { search };
