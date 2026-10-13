// api/server.js
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const app = express();

// Importamos el registro de proveedores
const { getSourcesFromProviders } = require('./providers/registry');

app.use(express.json());
app.use(express.static(path.join(__dirname, '..'))); // Sirve player.html desde la raíz

const SECRET = process.env.API_SECRET || 'tu-clave-secreta-aqui';

// Generar token (igual que PlayLatinSRC)
function makeToken(payload) {
    const data = Buffer.from(JSON.stringify(payload)).toString('base64');
    const sig = crypto.createHmac('sha256', SECRET).update(data).digest('hex');
    return `${data}.${sig}`;
}

// Verificar token
function verifyToken(token) {
    try {
        const [data, sig] = token.split('.');
        const expected = crypto.createHmac('sha256', SECRET).update(data).digest('hex');
        if (sig !== expected) return null;
        return JSON.parse(Buffer.from(data, 'base64').toString());
    } catch { return null; }
}

// Endpoint para generar token (opcional, para el frontend)
app.post('/api/token', (req, res) => {
    const { id, type } = req.body || {};
    if (!id || !type) return res.status(400).json({ ok: false });
    res.json({ ok: true, token: makeToken({ id, type, ts: Date.now() }) });
});

// ============================================================
// ENDPOINT PRINCIPAL (idéntico a PlayLatinSRC)
// ============================================================
app.post('/api/embed-links', async (req, res) => {
    const { type, id, token } = req.body || {};

    if (!type || !id) {
        return res.status(400).json({ ok: false, error: 'Faltan parámetros' });
    }

    // Validación de token (si se envía)
    if (token) {
        const payload = verifyToken(token);
        if (!payload || payload.id !== id) {
            return res.status(403).json({ ok: false, error: 'Token inválido' });
        }
    }

    try {
        // Tu registro de proveedores hace la magia
        const sources = await getSourcesFromProviders(type, id);
        
        res.json({
            ok: true,
            id,
            type,
            sources
        });
    } catch (error) {
        console.error('Error en /api/embed-links:', error);
        res.status(500).json({ ok: false, error: 'Error interno' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor en http://localhost:${PORT}`));
