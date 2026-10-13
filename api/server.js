// api/server.js
const express = require('express');
const path = require('path');
const app = express();

// Importamos el registro de proveedores que crearemos en el paso 2
const { getSourcesFromProviders } = require('./providers/registry');

app.use(express.json());

// Servir el frontend (player.html está en la raíz, según tus capturas)
app.use(express.static(path.join(__dirname, '..')));

// ============================================================
// ENDPOINT PRINCIPAL
// ============================================================
app.post('/api/embed-links', async (req, res) => {
    const { type, id, token } = req.body || {};

    if (!type || !id) {
        return res.status(400).json({ ok: false, error: 'Faltan parámetros: type e id' });
    }

    try {
        // Llamamos al registro de proveedores
        const sources = await getSourcesFromProviders(type, id);
        
        res.json({
            ok: true,
            id,
            type,
            sources
        });
    } catch (error) {
        console.error('Error general:', error);
        res.status(500).json({ ok: false, error: 'Error interno del servidor' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor en http://localhost:${PORT}`));
