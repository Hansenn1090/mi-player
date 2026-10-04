// ══════════════════════════════════════════════════════════════════════════
// Desempaquetador de JavaScript ofuscado (Dean Edwards Packer)
// Uso: unpack(packedCode) → devuelve el código original legible
// ══════════════════════════════════════════════════════════════════════════

function unpack(packed) {
  try {
    // Buscar el patrón: }('CODE',N,N,'WORDS'.split('|'),0,{})
    const match = packed.match(
      /}\s*\(\s*'([^']+)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([^']+)'\.split\s*\(\s*'\|'\s*\)\s*,\s*0\s*,\s*\{\s*\}\s*\)/
    );
    if (!match) {
      // Probar variante con comillas dobles
      const match2 = packed.match(
        /}\s*\(\s*"([^"]+)"\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*"([^"]+)"\.split\s*\(\s*"\|"\s*\)\s*,\s*0\s*,\s*\{\s*\}\s*\)/
      );
      if (!match2) return packed;
      return decode(match2[1], parseInt(match2[2]), parseInt(match2[3]), match2[4]);
    }
    return decode(match[1], parseInt(match[2]), parseInt(match[3]), match[4]);
  } catch (e) {
    return packed;
  }
}

function decode(p, a, c, k) {
  const kArr = k.split('|');
  const base = a;

  function encode(num) {
    return num.toString(base);
  }

  let result = p.replace(/\b\w+\b/g, function (word) {
    const idx = kArr.indexOf(word);
    if (idx !== -1) return kArr[idx];
    // Convertir a número en base a → índice
    const num = parseInt(word, base);
    if (!isNaN(num) && kArr[num] !== undefined && kArr[num] !== '') {
      return kArr[num];
    }
    return word;
  });

  return result;
}

// Extraer todos los .m3u8 de un bloque de código (desempaquetado o no)
function extractM3U8(code) {
  const patterns = [
    /https?:\/\/[^\s"']+\.m3u8[^\s"']*/gi,
    /https?:\/\/[^\s"']+master\.txt[^\s"']*/gi,
    /https?:\/\/[^\s"']+index\.m3u8[^\s"']*/gi,
  ];
  for (const re of patterns) {
    const m = code.match(re);
    if (m && m.length > 0) return m[0].replace(/\\/g, '');
  }
  return null;
}

module.exports = { unpack, extractM3U8 };
