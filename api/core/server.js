// api/core/server.js
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

// 1. Configuración de CORS
app.use(cors({
  origin: [
    'https://mi-player.netlify.app',
    /\.netlify\.app$/,
    /\.onrender\.com$/,
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: false,
}));

// ... Aquí van tus otras rutas ...

// 2. RUTA DEL PROXY (Corregida)
app.get('/api/proxy', async (req, res) => {
    const urlDestino = req.query.url;
    const refererDestino = req.query.referer || 'https://vimeos.net/';
    
    if (!urlDestino) return res.status(400).send('Falta el parámetro URL');

    try {
        const isM3U8 = urlDestino.includes('.m3u8');
        
        const response = await axios({
            method: 'get',
            url: urlDestino,
            // Usamos arraybuffer para binarios (.ts, .key) y text para .m3u8
            responseType: isM3U8 ? 'text' : 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36',
                'Referer': refererDestino,
                'Origin': 'https://vimeos.net' 
            }
        });

        if (isM3U8) {
            let contenidoM3U8 = response.data;
            
            // Extraer la URL base de forma segura
            const urlObj = new URL(urlDestino);
            const baseUrl = urlObj.href.substring(0, urlObj.href.lastIndexOf('/') + 1);
            const miProxy = `${req.protocol}://${req.get('host')}/api/proxy`;

            // Reescribir llaves de encriptación (si las hay)
            contenidoM3U8 = contenidoM3U8.replace(/URI="([^"]+)"/g, (match, p1) => {
                try {
                    const urlAbsoluta = new URL(p1, baseUrl).href;
                    return `URI="${miProxy}?url=${encodeURIComponent(urlAbsoluta)}&referer=${encodeURIComponent(refererDestino)}"`;
                } catch (e) { return match; }
            });

            // Reescribir segmentos de video (.ts)
            contenidoM3U8 = contenidoM3U8.split('\n').map(line => {
                // CRÍTICO: .trim() elimina los \r invisibles que rompen la URL
                const cleanLine = line.trim(); 
                
                if (cleanLine && !cleanLine.startsWith('#')) {
                    try {
                        const urlAbsoluta = new URL(cleanLine, baseUrl).href;
                        return `${miProxy}?url=${encodeURIComponent(urlAbsoluta)}&referer=${encodeURIComponent(refererDestino)}`;
                    } catch (e) {
                        return cleanLine; // Si falla, devolvemos la línea original
                    }
                }
                return cleanLine;
            }).join('\n');

            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            res.setHeader('Access-Control-Allow-Origin', '*');
            return res.send(contenidoM3U8);
        } else {
            // Devolver archivos binarios (.ts o .key)
            res.setHeader('Content-Type', response.headers['content-type'] || 'video/MP2T');
            res.setHeader('Access-Control-Allow-Origin', '*');
            return res.send(Buffer.from(response.data));
        }
    } catch (error) {
        console.error("Error en Proxy:", error.message);
        // Si Vimeos devuelve 403 o 404, es porque el token ya expiró
        res.status(500).send('Error interno del proxy: Token posiblemente expirado');
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Servidor escuchando en puerto ${PORT}`);
});
