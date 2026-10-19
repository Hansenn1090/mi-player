const { join } = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Guarda el navegador en la carpeta .cache del proyecto para Render
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
