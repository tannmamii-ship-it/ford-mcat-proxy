const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

app.get('/favicon.ico', (req, res) => {
    res.sendFile(path.join(__dirname, 'favicon.ico'));
});

app.get('/', async (req, res) => {
    let browser = null;
    try {
        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
            ignoreHTTPSErrors: true,
        });

        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(60000);

        await page.goto('https://login.superservice.com/login/tr/?goto=https:%2F%2Flogin.superservice.com%2F', { 
            waitUntil: 'networkidle2' 
        });

        await page.waitForSelector('input[name="username"]', { visible: true });
        await page.type('input[name="username"]', process.env.FORD_USER);
        
        await page.waitForSelector('input[name="password"]', { visible: true });
        await page.type('input[name="password"]', process.env.FORD_PASS);

        await page.click('#loginButton');

        await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});

        await page.evaluate(() => {
            let link = document.querySelector("link[rel*='icon']") || document.createElement('link');
            link.type = 'image/x-icon';
            link.rel = 'shortcut icon';
            link.href = '/favicon.ico';
            document.getElementsByTagName('head')[0].appendChild(link);

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
        if (browser !== null) {
            await browser.close();
        }
        console.error(error);
        res.status(500).send('Giriş yapılırken hata oluştu: ' + error.message);
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Ford Proxy sunucusu ${PORT} portunda çalışıyor.`);
});
