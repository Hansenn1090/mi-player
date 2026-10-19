// api/core/server.js
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

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

// 2. RUTA DEL PROXY (Blindada para Vimeos)
app.get('/api/proxy', async (req, res) => {
    const urlDestino = req.query.url;
    const refererDestino = req.query.referer || 'https://vimeos.net/';
    
    if (!urlDestino) return res.status(400).send('Falta el parámetro URL');

    try {
        // Detectar si es un manifiesto (m3u8 o txt)
        const isM3U8 = urlDestino.includes('.m3u8') || urlDestino.includes('.txt');
        
        const response = await axios({
            method: 'get',
            url: urlDestino,
            // SIEMPRE arraybuffer para evitar corrupción de texto o binarios
            responseType: 'arraybuffer',
            // CRÍTICO: Evitar que Axios siga redirecciones y pierda el Referer
            maxRedirects: 0, 
            validateStatus: (status) => status >= 200 && status < 400,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Referer': refererDestino,
                'Origin': 'https://vimeos.net',
                'Accept': '*/*'
            }
        });

        // Si Vimeos responde con una redirección (301 o 302), la seguimos manualmente
        if (response.status >= 300 && response.status < 400 && response.headers.location) {
            const redirectUrl = response.headers.location;
            // Volvemos a llamar a nuestro propio proxy con la nueva URL
            return res.redirect(`/api/proxy?url=${encodeURIComponent(redirectUrl)}&referer=${encodeURIComponent(refererDestino)}`);
        }

        if (isM3U8) {
            // Convertir ArrayBuffer a String (UTF-8)
            let contenidoM3U8 = Buffer.from(response.data).toString('utf8');
            
            // Extraer la URL base de forma segura
            const urlObj = new URL(urlDestino);
            const baseUrl = urlObj.href.substring(0, urlObj.href.lastIndexOf('/') + 1);
            const miProxy = `${req.protocol}://${req.get('host')}/api/proxy`;

            // Reescribir llaves de encriptación
            contenidoM3U8 = contenidoM3U8.replace(/URI="([^"]+)"/g, (match, p1) => {
                try {
                    const urlAbsoluta = new URL(p1, baseUrl).href;
                    return `URI="${miProxy}?url=${encodeURIComponent(urlAbsoluta)}&referer=${encodeURIComponent(refererDestino)}"`;
                } catch (e) { return match; }
            });

            // Reescribir segmentos de video (.ts)
            contenidoM3U8 = contenidoM3U8.split('\n').map(line => {
                const cleanLine = line.trim(); 
                
                if (cleanLine && !cleanLine.startsWith('#')) {
                    try {
                        const urlAbsoluta = new URL(cleanLine, baseUrl).href;
                        return `${miProxy}?url=${encodeURIComponent(urlAbsoluta)}&referer=${encodeURIComponent(refererDestino)}`;
                    } catch (e) {
                        return cleanLine; 
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
        console.error(`[Proxy Error] URL: ${urlDestino.substring(0, 50)}... | Status:`, error.response ? error.response.status : error.message);
        res.status(500).send('Error interno del proxy');
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Servidor escuchando en puerto ${PORT}`);
});
