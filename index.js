const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

let globalBrowser = null;
let globalPage = null;
let browserInitializing = null;

// Oturumu güvenli bir şekilde başlatan ve kilitleyen fonksiyon
async function getActivePage() {
    if (globalBrowser && globalPage && globalBrowser.isConnected() === true) {
        return globalPage;
    }

    if (browserInitializing) {
        return await browserInitializing;
    }

    browserInitializing = (async () => {
        try {
            if (globalBrowser) {
                try { await globalBrowser.close(); } catch (e) {}
            }

            const executablePath = await chromium.executablePath();

            globalBrowser = await puppeteer.launch({
                args: chromium.args,
                defaultViewport: chromium.defaultViewport,
                executablePath: executablePath,
                headless: chromium.headless,
                ignoreHTTPSErrors: true,
            });

            globalPage = await globalBrowser.newPage();
            globalPage.setDefaultNavigationTimeout(60000);
            return globalPage;
        } finally {
            browserInitializing = null;
        }
    })();

    return await browserInitializing;
}

// Favicon sunucusu
app.get('/favicon.ico', (req, res) => {
    res.sendFile(path.join(__dirname, 'favicon.ico'));
});

// Ana Sayfa ve Oturum Açma
app.get('/', async (req, res) => {
    try {
        const page = await getActivePage();
        
        // Eğer henüz giriş yapılmadıysa veya login sayfasındaysak
        if (!page.url().includes('infomedia') || page.url().includes('login')) {
            await page.goto('https://login.superservice.com/login/tr/?goto=https:%2F%2Flogin.superservice.com%2F', { 
                waitUntil: 'domcontentloaded' 
            });

            // Kullanıcı adı alanının gelmesini güvenli bir şekilde bekle
            try {
                await page.waitForSelector('input[name="username"]', { timeout: 15000 });
            } catch (e) {
                // Zaten giriş yapılmışsa veya başka bir ekrandaysak devam et
            }

            // Sayfa context çakışmalarını önlemek için doğrudan type ve click kullanıyoruz
            const userInput = await page.$('input[name="username"]');
            if (userInput) {
                await page.type('input[name="username"]', process.env.FORD_USER, { delay: 50 });
                await page.type('input[name="password"]', process.env.FORD_PASS, { delay: 50 });
                
                await Promise.all([
                    page.click('#loginButton'),
                    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {})
                ]);
            }
        }

        // Eğer hala ana sayfada değilsek bir kez daha ana pangeye yönlendir
        if (!page.url().includes('infomedia')) {
            await page.goto('https://login.superservice.com/', { waitUntil: 'networkidle2' }).catch(() => {});
        }

        const htmlContent = await page.evaluate(() => {
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

            document.querySelectorAll('a').forEach(el => {
                const href = el.getAttribute('href');
                if (href && !href.startsWith('javascript') && !href.startsWith('#') && !href.startsWith('/navigate')) {
                    let absoluteUrl = href;
                    if (href.startsWith('/')) {
                        absoluteUrl = window.location.origin + href;
                    } else if (!href.startsWith('http')) {
                        absoluteUrl = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1) + href;
                    }
                    el.setAttribute('href', '/navigate?url=' + encodeURIComponent(absoluteUrl));
                    el.removeAttribute('target');
                }
            });

            return document.documentElement.outerHTML;
        });

        res.send(htmlContent);

    } catch (error) {
        console.error("Ana sayfa hatası:", error);
        res.status(500).send('Giriş yapılırken hata oluştu: ' + error.message);
    }
});

// Tıklanan alt sayfaları ve katalogları aktif oturum üzerinden açan rota
app.get('/navigate', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.redirect('/');

    try {
        const page = await getActivePage();
        await page.goto(targetUrl, { waitUntil: 'networkidle2' });

        const htmlContent = await page.evaluate(() => {
            document.querySelectorAll('a').forEach(el => {
                const href = el.getAttribute('href');
                if (href && !href.startsWith('javascript') && !href.startsWith('#') && !href.startsWith('/navigate')) {
                    let absoluteUrl = href;
                    if (href.startsWith('/')) {
                        absoluteUrl = window.location.origin + href;
                    } else if (!href.startsWith('http')) {
                        absoluteUrl = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1) + href;
                    }
                    el.setAttribute('href', '/navigate?url=' + encodeURIComponent(absoluteUrl));
                    el.removeAttribute('target');
                }
            });
            return document.documentElement.outerHTML;
        });

        res.send(htmlContent);

    } catch (error) {
        console.error("Yönlendirme hatası:", error);
        res.status(500).send('Sayfa yüklenirken hata oluştu: ' + error.message);
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Ford Proxy sunucusu ${PORT} portunda çalışıyor.`);
});
