const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const zlib = require('zlib');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

let sessionCookies = [];
let isReady = false;
let loginInProgress = false;

async function startAutomatedLogin() {
    if (loginInProgress || isReady) return;
    loginInProgress = true;
    let browser = null;
    
    try {
        console.log("Arka planda Puppeteer başlatılıyor...");
        const executablePath = await chromium.executablePath();
        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: executablePath,
            headless: chromium.headless,
            ignoreHTTPSErrors: true,
        });

        const page = await browser.newPage();
        
        // Hızlıca login sayfasına git (networkidle0 yerine domcontentloaded kullanarak bekleme süresini azaltıyoruz)
        await page.goto('https://login.superservice.com/login/tr/?goto=https:%2F%2Flogin.superservice.com%2F', { waitUntil: 'domcontentloaded', timeout: 60000 });

        // Elementleri doğrudan DOM üzerinden manipüle et (En hızlı ve hatasız yöntem)
        await page.waitForSelector('#username', { timeout: 30000 });
        await page.evaluate(() => {
            document.querySelector('#username').value = 'manfordb2b@yandex.com';
            document.querySelector('#passwordInput').value = '0326Aoyp.';
            document.querySelector('#loginButton').click();
        });

        // Tıklamadan sonra orijinal paneli geçip doğrudan Microcat'e bağlanmayı bekle
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => console.log("İlk yönlendirme beklendi (Timeout olabilir)"));
        await page.goto('https://microcat-europe.superservice.com/content/microcat-epc/#/home/?appName=Microcat_EPC&subscription=DYN000000000B2F847&subscriptionAssignment=DYN0000000015ACE6E', { waitUntil: 'domcontentloaded', timeout: 60000 });

        // Tüm oturum çerezlerini al
        sessionCookies = await page.cookies();
        isReady = true;
        console.log("Giriş başarılı, hedef sisteme bağlandı!");
        
    } catch (error) {
        console.error("Otomasyon hatası:", error);
        isReady = false;
    } finally {
        loginInProgress = false;
        if (browser) await browser.close();
    }
}

app.get('/favicon.ico', (req, res) => {
    res.sendFile(path.join(__dirname, 'favicon.ico'));
});

// Durum Kontrol Rotası
app.get('/api/status', (req, res) => {
    res.json({ ready: isReady, inProgress: loginInProgress });
});

// Ana Sayfa (Loading Ekranı)
app.use((req, res, next) => {
    if (!isReady && !req.path.startsWith('/api/')) {
        startAutomatedLogin();
        return res.send(`
            <!DOCTYPE html>
            <html lang="tr">
            <head>
                <meta charset="UTF-8">
                <title>Ford Microcat Başlatılıyor...</title>
                <style>
                    body { margin: 0; display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100vh; background-color: #f4f6f9; font-family: Arial, sans-serif; }
                    img { width: 100px; height: 100px; margin-bottom: 20px; }
                    h2 { color: #2c3e50; margin-bottom: 5px; }
                    p { color: #7f8c8d; }
                    #status-text { margin-top: 15px; font-weight: bold; color: #e67e22; }
                </style>
            </head>
            <body>
                <img src="https://i.gifer.com/ZKZg.gif" alt="Yükleniyor" />
                <h2>Sisteme Güvenli Giriş Yapılıyor...</h2>
                <p>Lütfen bekleyin, bu işlem yaklaşık 15-30 saniye sürebilir.</p>
                <div id="status-text">Sunucu bağlanıyor...</div>
                <script>
                    let checkCount = 0;
                    const interval = setInterval(() => {
                        fetch('/api/status').then(r => r.json()).then(data => {
                            checkCount++;
                            if (data.ready) {
                                clearInterval(interval);
                                document.getElementById('status-text').innerText = "Oturum açıldı, yönlendiriliyorsunuz...";
                                document.getElementById('status-text').style.color = "#27ae60";
                                setTimeout(() => {
                                    window.location.href = '/content/microcat-epc/#/home/?appName=Microcat_EPC&subscription=DYN000000000B2F847&subscriptionAssignment=DYN0000000015ACE6E';
                                }, 1000);
                            } else if (checkCount > 20) {
                                document.getElementById('status-text').innerText = "Beklenenden uzun sürüyor, lütfen biraz daha bekleyin...";
                                document.getElementById('status-text').style.color = "#c0392b";
                            }
                        }).catch(() => {});
                    }, 3000);
                </script>
            </body>
            </html>
        `);
    }

    if (isReady && req.path === '/') {
        return res.redirect('/content/microcat-epc/#/home/?appName=Microcat_EPC&subscription=DYN000000000B2F847&subscriptionAssignment=DYN0000000015ACE6E');
    }

    next();
});

// Proxy Katmanı
app.use('/', createProxyMiddleware({
    target: 'https://microcat-europe.superservice.com',
    changeOrigin: true,
    secure: false,
    autoRewrite: true, 
    hostRewrite: true, 
    onProxyReq: (proxyReq) => {
        if (sessionCookies.length > 0) {
            const cookieStr = sessionCookies.map(c => `${c.name}=${c.value}`).join('; ');
            proxyReq.setHeader('cookie', cookieStr);
        }
    },
    onProxyRes: (proxyRes, req, res) => {
        if ([301, 302, 307, 308].includes(proxyRes.statusCode)) {
            const location = proxyRes.headers['location'];
            if (location && location.includes('login.superservice.com')) {
                isReady = false; 
                proxyRes.headers['location'] = '/';
            }
        }

        const isHtml = proxyRes.headers['content-type'] && proxyRes.headers['content-type'].includes('text/html');

        if (isHtml) {
            delete proxyRes.headers['content-length'];

            const _write = res.write;
            const _end = res.end;
            let bodyChunks = [];

            res.write = function (chunk) { bodyChunks.push(Buffer.from(chunk)); };
            res.end = function (chunk) {
                if (chunk) bodyChunks.push(Buffer.from(chunk));
                
                let buffer = Buffer.concat(bodyChunks);
                const encoding = proxyRes.headers['content-encoding'];

                try {
                    if (encoding === 'gzip') buffer = zlib.gunzipSync(buffer);
                    else if (encoding === 'deflate') buffer = zlib.inflateSync(buffer);
                    else if (encoding === 'br') buffer = zlib.brotliDecompressSync(buffer);
                    delete proxyRes.headers['content-encoding'];
                } catch (e) {
                    console.error("Zlib açma hatası:", e);
                }

                let html = buffer.toString('utf8');

                const customCSS = `
                    <style>
                        .footer.ng-star-inserted,
                        .topbar-right,
                        .epc-menu-bar-button.ng-star-inserted,
                        epc-header-secondary-toggle,
                        #newJobButton,
                        .mat-tooltip-trigger.epc-menu-bar-button.ng-star-inserted,
                        epc-part-transfer-button,
                        li.ng-star-inserted,
                        #mat-tab-label-1-1,
                        .vehicle-display-row.action-tabs,
                        #illustrationToolsPrintButton {
                            display: none !important;
                            visibility: hidden !important;
                            opacity: 0 !important;
                        }
                    </style>
                `;

                html = html.replace(/<title>.*?<\/title>/i, '<title>Ford Microcat</title>');
                if (html.includes('</head>')) {
                    html = html.replace('</head>', customCSS + '</head>');
                } else {
                    html = customCSS + html;
                }

                const finalBuffer = Buffer.from(html, 'utf8');
                res.setHeader('content-length', finalBuffer.length);
                _write.call(res, finalBuffer);
                _end.call(res);
            };
        }
    }
}));

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Ford Proxy sunucusu ${PORT} portunda başarıyla başlatıldı.`);
});
