const express = require('express');
const puppeteer = require('puppeteer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Favicon dosyasını sunmak için
app.get('/favicon.ico', (req, res) => {
    res.sendFile(path.join(__dirname, 'favicon.ico'));
});

// Ana adrese ( / ) girildiğinde otomasyon çalışsın
app.get('/', async (req, res) => {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu'
            ]
        });

        const page = await browser.newPage();
        
        // 1. Ford Login sayfasına git
        await page.goto('https://login.superservice.com/login/tr/?goto=https:%2F%2Flogin.superservice.com%2F', { 
            waitUntil: 'networkidle2',
            timeout: 60000 
        });

        // 2. Render Environment Variables'dan bilgileri alıp doldur
        await page.waitForSelector('input[name="username"]', { visible: true });
        await page.type('input[name="username"]', process.env.FORD_USER);
        
        await page.waitForSelector('input[name="password"]', { visible: true });
        await page.type('input[name="password"]', process.env.FORD_PASS);

        // 3. Giriş butonuna bas
        await page.click('#loginButton');

        // 4. Giriş sonrası yönlendirmeyi bekle
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});

        // 5. Sayfa içine özel favicon ve yasaklı alanları gizleyen CSS'i enjekte ediyoruz
        await page.evaluate(() => {
            // Favicon ekleme
            let link = document.querySelector("link[rel*='icon']") || document.createElement('link');
            link.type = 'image/x-icon';
            link.rel = 'shortcut icon';
            link.href = '/favicon.ico';
            document.getElementsByTagName('head')[0].appendChild(link);

            // Yasaklı alanları gizleme CSS'i
            const style = document.createElement('style');
            style.innerHTML = `
                div.footer.ng-star-inserted,
                .topbar-right,
                .epc-menu-bar-button.ng-star-inserted,
                epc-header-secondary-toggle,
                #newJobButton,
                .mat-tooltip-trigger.epc-menu-bar-button.ng-star-inserted,
                epc-part-transfer-button,
                #mat-tab-label-1-1,
                .vehicle-display-row.action-tabs,
                #illustrationToolsPrintButton {
                    display: none !important;
                    visibility: hidden !important;
                }
            `;
            document.head.appendChild(style);
        });

        const htmlContent = await page.content();
        await browser.close();

        res.send(htmlContent);

    } catch (error) {
        if (browser) await browser.close();
        console.error(error);
        res.status(500).send('Giriş yapılırken hata oluştu: ' + error.message);
    }
});

app.listen(PORT, () => {
    console.log(`Ford Proxy sunucusu ${PORT} portunda çalışıyor.`);
});
