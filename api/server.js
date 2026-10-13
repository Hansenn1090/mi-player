// api/server.js
const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

// ─── Endpoint existente (el que ya usabas) ───────────────────────
// Si ya tienes lógica para /api/servers en tu server.js actual,
// NO la borres. Solo añade el bloque de abajo, y asegúrate de que
// ambos devuelvan el MISMO formato: { meta, servers }

// ─── NUEVO: /api/embed-links (alias al mismo formato) ────────────
// Sirve por si algún día quieres migrar al formato de PlayLatinSRC
const { getSourcesFromProviders } = require('./providers/registry');

app.post('/api/embed-links', async (req, res) => {
    const { type, id } = req.body || {};
    if (!type || !id) {
        return res.status(400).json({ ok: false, error: 'Faltan type/id' });
    }
    try {
        const servers = await getSourcesFromProviders(type, id);
        res.json({ ok: true, id, type, servers });
    } catch (err) {
        console.error('embed-links:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ─── Health check (Render lo usa) ────────────────────────────────
app.get('/', (_req, res) => res.send('OK'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor en :${PORT}`));
