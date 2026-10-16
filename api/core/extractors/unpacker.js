'use strict';

// ══════════════════════════════════════════════════════════════════════════
// Desempaquetador de JavaScript ofuscado (Dean Edwards Packer)
// Formato: eval(function(p,a,c,k,e,d){...}('CODE',BASE,COUNT,'W1|W2|...'.split('|'),0,{}))
// ══════════════════════════════════════════════════════════════════════════

function unpack(packed) {
  if (!packed) return packed;

  // ═══ FIX #1: regex que maneja comillas escapadas (\' y \") ═══
  const patterns = [
    // Comillas simples
    /}\s*\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'\s*\.\s*split\s*\(\s*['"]\|['"]\s*\)/,
    // Comillas dobles
    /}\s*\(\s*"((?:[^"\\]|\\.)*)"\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*"((?:[^"\\]|\\.)*)"\s*\.\s*split\s*\(\s*['"]\|['"]\s*\)/,
  ];

  let m = null;
  for (const re of patterns) {
    m = packed.match(re);
    if (m) break;
  }
  if (!m) return packed;

  // Des-escapar comillas dentro del código packed
  const code = m[1].replace(/\\'/g, "'").replace(/\\"/g, '"');
  const base = parseInt(m[2], 10);
  const count = parseInt(m[3], 10);
  const words = m[4].split('|');

  return decode(code, base, count, words);
}

// ═══ FIX #2: decode con validación estricta del token ═══
function decode(p, base, count, kArr) {
  return p.replace(/\b[0-9a-zA-Z]+\b/g, (token) => {
    // Convertir de base `base` a número entero
    const num = parseInt(token, base);
    if (isNaN(num)) return token;

    // Verificar que la representación canónica coincida
    // (evita reemplazar 'foo' cuando 'foo' casualmente es parseable)
    if (num.toString(base) !== token.toLowerCase()) return token;

    // Rango válido
    if (num < 0 || num >= kArr.length) return token;

    // Solo reemplaza si hay palabra no vacía en el diccionario
    const word = kArr[num];
    if (word === undefined || word === '') return token;

    return word;
  });
}

// ═══ FIX #3: extractM3U8 normaliza \/ y añade más patrones ═══
function extractM3U8(code) {
  if (!code) return null;

  // Normalizar \/ → / (común en players ofuscados)
  const normalized = code.replace(/\\\//g, '/');

  const patterns = [
    // URLs completas
    /https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*/i,
    /https?:\/\/[^\s"'<>\\]+master\.txt[^\s"'<>\\]*/i,
    /https?:\/\/[^\s"'<>\\]+index\.m3u8[^\s"'<>\\]*/i,
    // Configuración JW Player: file: "..."  /  sources: [{ file: "..." }]
    /["']file["']\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i,
    /["']file["']\s*:\s*["']([^"']+master\.txt[^"']*)["']/i,
    /["']src["']\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i,
    /["']source["']\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i,
    // Sin extensión pero con patrón reconocible
    /["']file["']\s*:\s*["']([^"']+(?:master|index|playlist)[^"']*)["']/i,
  ];

  for (const re of patterns) {
    const m = normalized.match(re);
    if (m) {
      let url = m[1] || m[0];
      if (url.startsWith('//')) url = 'https:' + url;
      return url;
    }
  }
  return null;
}

module.exports = { unpack, extractM3U8 };
