// api/core/utils.js
function calcularSimilitud(str1, str2) {
  const normalize = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const a = normalize(str1);
  const b = normalize(str2);

  if (a === b) return 1.0;
  if (a.length < 2 || b.length < 2) return 0.0;

  const firstBigrams = new Map();
  for (let i = 0; i < a.length - 1; i++) {
    const bigram = a.substring(i, i + 2);
    const count = firstBigrams.has(bigram) ? firstBigrams.get(bigram) + 1 : 1;
    firstBigrams.set(bigram, count);
  }

  let intersectionSize = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bigram = b.substring(i, i + 2);
    const count = firstBigrams.has(bigram) ? firstBigrams.get(bigram) : 0;
    if (count > 0) {
      firstBigrams.set(bigram, count - 1);
      intersectionSize++;
    }
  }
  return (2.0 * intersectionSize) / (a.length + b.length - 2);
}
