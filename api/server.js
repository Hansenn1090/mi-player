// ══════════════════════════════════════════════════════════════════════════
// /api/extract-stream — Extrae el HLS real desde un embed usando Puppeteer
// Se usa para servidores que requieren clic/espera (StreamWish, Vidmoly)
// ══════════════════════════════════════════════════════════════════════════
app.get('/api/extract-stream', async (req, res) => {
  const embedUrl = req.query.url;
  if (!embedUrl) return res.status(400).json({ error: 'Falta url' });

  try {
    const { extractStream } = require('./core/puppeteer-extractor');
    const result = await extractStream(embedUrl);
    if (!result || !result.stream) return res.status(404).json({ error: 'No extraído' });
    res.json(result);
  } catch (err) {
    console.error('[extract-stream] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
