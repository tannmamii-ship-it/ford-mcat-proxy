const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/ford', async (req, res) => {
    let browser;
    try {
        // Render üzerinde Chromium'un sorunsuz çalışması için gerekli argümanlar
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

        // 2. Kullanıcı adı ve şifreyi Render Environment Variables'dan güvenli bir şekilde çekiyoruz
        await page.waitForSelector('input[name="username"]', { visible: true });
        await page.type('input[name="username"]', process.env.FORD_USER);
        
        await page.waitForSelector('input[name="password"]', { visible: true });
        await page.type('input[name="password"]', process.env.FORD_PASS);

        // 3. Giriş butonuna bas
        await page.click('#loginButton');

        // 4. Giriş sonrası yönlendirmeyi ve ana sayfanın yüklenmesini bekliyoruz
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});

        // Eğer açılışta ek bir butona basılması gerekiyorsa buraya eklenebilir.
        // Katalog sayfasına ulaştıktan sonra istenmeyen elementleri temizlemek için CSS enjekte ediyoruz:
        await page.evaluate(() => {
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

        // 5. Temizlenmiş ve giriş yapılmış sayfayı müşteriye sunuyoruz
        const htmlContent = await page.content();
        await browser.close();

        res.send(htmlContent);

    } catch (error) {
        if (browser) await browser.close();
        console.error(error);
        res.status(500).send('Giriş yapılırken veya sayfa yüklenirken bir hata oluştu: ' + error.message);
    }
});

app.listen(PORT, () => {
    console.log(`Ford Proxy sunucusu ${PORT} portunda çalışıyor.`);
});