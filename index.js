const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

let globalBrowser = null;
let globalPage = null;

// Oturumu başlatan ve aktif tutan ana fonksiyon
async function getActivePage() {
    if (!globalBrowser || !globalPage || globalBrowser.isConnected() === false) {
        globalBrowser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
            ignoreHTTPSErrors: true,
        });
        globalPage = await globalBrowser.newPage();
        globalPage.setDefaultNavigationTimeout(60000);
    }
    return globalPage;
}

// Favicon sunucusu
app.get('/favicon.ico', (req, res) => {
    res.sendFile(path.join(__dirname, 'favicon.ico'));
});

// Ana Sayfa ve Oturum Açma
app.get('/', async (req, res) => {
    try {
        const page = await getActivePage();
        
        // Eğer henüz giriş yapılmadıysa giriş sayfasına git
        if (!page.url().includes('superservice.com') || page.url().includes('login')) {
            await page.goto('https://login.superservice.com/login/tr/?goto=https:%2F%2Flogin.superservice.com%2F', { 
                waitUntil: 'networkidle2' 
            });

            // Kullanıcı adı ve şifre alanları varsa doldur
            const userInput = await page.$('input[name="username"]');
            if (userInput) {
                await page.type('input[name="username"]', process.env.FORD_USER);
                await page.type('input[name="password"]', process.env.FORD_PASS);
                await page.click('#loginButton');
                await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
            }
        }

        // Sayfa içeriğini alıp linkleri ve arayüzü proxy'ye uyarlıyoruz
        const htmlContent = await page.evaluate(() => {
            // Favicon ekleme
            let link = document.querySelector("link[rel*='icon']") || document.createElement('link');
            link.type = 'image/x-icon';
            link.rel = 'shortcut icon';
            link.href = '/favicon.ico';
            document.getElementsByTagName('head')[0].appendChild(link);

            // Gereksiz/yasaklı alanları gizleme CSS'i
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

            // Tüm linkleri ve butonları proxy üzerinden yönlendirecek şekilde güncelliyoruz
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
                    el.removeAttribute('target'); // Yeni sekmede açılmasını engeller
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
            // Yeni açılan sayfadaki linkleri de proxy yönlendirmesine uygun hale getir
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
