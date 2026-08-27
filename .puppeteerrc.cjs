const {join} = require('path');

module.exports = {
  // Chrome'u projenin içine kaydetmesini söylüyoruz
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
