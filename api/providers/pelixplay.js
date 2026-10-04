const axios = require('axios');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
const BASE = 'https://pelixplay.app';

// ══════════════════════════════════════════════════════════════════════
// pelixplay.app expone una API interna en /api.php
// Endpoint: ?action=details&id={tmdbId}&type={movie|tv}
// Devuelve all_embeds con StreamWish, Vidmoly, FileLions, VOE, etc.
// ══════════════════════════════════════════════════════════════════════
async function scrapePelixplay(title, year, tmdbId, type) {
  const found = { latino: {}, subtitulado: {} };

  if (!tmdbId) {
    console.log('[pelixplay] Sin tmdbId, saltando');
    return found;
  }

  console.log('[pelixplay] Consultando API con tmdbId:', tmdbId);

  try {
    const apiUrl = `${BASE}/api.php?action=details&id=${encodeURIComponent(tmdbId)}&type=${type || 'movie'}`;

    const { data } = await axios.get(apiUrl, {
      timeout: 15000,
      headers: {
        'User-Agent': UA,
        'Referer': `${BASE}/embed/embed-final.html?id=${tmdbId}`,
        'Origin': BASE,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      },
      validateStatus: s => s >= 200 && s < 400,
    });

    if (!data || !data.ok) {
      console.log('[pelixplay] API respondió ok=false');
      return found;
    }

    // La API devuelve all_embeds agrupado por idioma
    const allEmbeds = data.all_embeds || {};
    const defaultLang = data.language || 'latino';
    if (!allEmbeds[defaultLang] && data.embeds) {
      allEmbeds[defaultLang] = data.embeds;
    }

    // Recorrer los idiomas y servidores
    for (const [lang, servers] of Object.entries(allEmbeds)) {
      const targetLang = (lang === 'latino' || lang === 'español' || lang === 'castellano')
        ? 'latino'
        : 'subtitulado';

      for (const [serverName, urls] of Object.entries(servers)) {
        const urlList = Array.isArray(urls) ? urls : [urls];
        const firstUrl = urlList[0];
        if (!firstUrl) continue;

        const norm = normalizeName(serverName);
        if (!norm) {
          console.log(`[pelixplay] Ignorando servidor no permitido: ${serverName}`);
          continue;
        }

        if (!found[targetLang][norm]) {
          found[targetLang][norm] = firstUrl;
          console.log(`[pelixplay] OK ${targetLang}/${norm}: ${String(firstUrl).slice(0, 80)}`);
        }
      }
    }

    return found;
  } catch (e) {
    console.warn('[pelixplay] Error:', e.message);
    return found;
  }
}

function normalizeName(name) {
  const base = String(name).toLowerCase().replace(/[\s_-]+\d+$/, '');
  if (['streamwish', 'hglink', 'flaswish', 'wishfast', 'awish', 'embedwish'].includes(base)) return 'StreamWish';
  if (['vidmoly'].includes(base)) return 'Vidmoly';
  if (['filelions', 'vidhide', 'vidhidepro', 'minochinos', 'callistanise', 'filemoon'].includes(base)) return 'FileLions';
  return null;
}

module.exports = {
  scrapePelixplay,
  search: async (title, year, tmdbId, type) => scrapePelixplay(title, year, tmdbId, type)
};

console.log('[pelixplay] Provider cargado (API mode)');
