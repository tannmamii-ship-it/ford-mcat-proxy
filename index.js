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
let systemLogs = [];

// Canlı Log Sistemi
function addLog(msg) {
    const time = new Date().toLocaleTimeString('tr-TR');
    const logMsg = `[${time}] ${msg}`;
    systemLogs.push(logMsg);
    console.log(logMsg);
    if (systemLogs.length > 20) systemLogs.shift(); // Sadece son 20 işlemi tut
}

async function startAutomatedLogin() {
    if (loginInProgress || isReady) return;
    loginInProgress = true;
    systemLogs = []; 
    let browser = null;
    
    try {
        addLog("Adım 1: Sanal tarayıcı (Puppeteer) başlatılıyor...");
        const executablePath = await chromium.executablePath();
        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: executablePath,
            headless: chromium.headless,
            ignoreHTTPSErrors: true,
        });

        addLog("Adım 2: Ford giriş sayfasına bağlanılıyor...");
        const page = await browser.newPage();
        
        await page.goto('https://login.superservice.com/login/tr/?goto=https:%2F%2Flogin.superservice.com%2F', { waitUntil: 'domcontentloaded', timeout: 60000 });
        addLog("Adım 3: Sayfa yüklendi. Form aranıyor...");

        await page.waitForSelector('#username', { timeout: 30000 });
        addLog("Adım 4: Form bulundu, bilgiler giriliyor...");
        
        await page.evaluate(() => {
            document.querySelector('#username').value = 'manfordb2b@yandex.com';
            document.querySelector('#passwordInput').value = '0326Aoyp.';
            document.querySelector('#loginButton').click();
        });
        addLog("Adım 5: Giriş yap butonuna tıklandı.");

        addLog("Adım 6: Sistemin yönlendirmesi bekleniyor...");
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => addLog("Uyarı: İlk yönlendirme geç cevap verdi, zorla devam ediliyor."));
        
        addLog("Adım 7: Doğrudan Microcat kataloğuna geçiş yapılıyor...");
        await page.goto('https://microcat-europe.superservice.com/content/microcat-epc/#/home/?appName=Microcat_EPC&subscription=DYN000000000B2F847&subscriptionAssignment=DYN0000000015ACE6E', { waitUntil: 'domcontentloaded', timeout: 60000 });

        addLog("Adım 8: Oturum anahtarları kopyalanıyor...");
        sessionCookies = await page.cookies();
        isReady = true;
        addLog("BAŞARILI! Hedef sisteme bağlandı. Ekrana aktarılıyor...");
        
    } catch (error) {
        addLog("HATA OLUŞTU: " + error.message);
        isReady = false;
    } finally {
        loginInProgress = false;
        if (browser) await browser.close();
    }
}

app.get('/favicon.ico', (req, res) => {
    res.sendFile(path.join(__dirname, 'favicon.ico'));
});

// Arayüzün saniye saniye bilgi çektiği API
app.get('/api/status', (req, res) => {
    res.json({ ready: isReady, logs: systemLogs });
});

// Yükleme Ekranı (Siyah Terminal Tasarımı)
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
                    body { background-color: #121212; color: #00ff00; font-family: 'Courier New', Courier, monospace; padding: 30px; margin: 0; }
                    h2 { color: #ffffff; border-bottom: 1px solid #333; padding-bottom: 10px; margin-top: 0; }
                    #log-container { background-color: #000; padding: 15px; border-radius: 5px; height: 350px; overflow-y: auto; font-size: 15px; margin-bottom: 20px; border: 1px solid #333; }
                    .log-line { margin: 8px 0; }
                </style>
            </head>
            <body>
                <h2>🚀 Ford Microcat Sistemine Bağlanılıyor...</h2>
                <div id="log-container">Bağlantı kuruluyor... Lütfen bekleyin.</div>
                <script>
                    const logContainer = document.getElementById('log-container');
                    
                    const interval = setInterval(() => {
                        fetch('/api/status')
                            .then(r => r.json())
                            .then(data => {
                                if (data.logs && data.logs.length > 0) {
                                    logContainer.innerHTML = data.logs.map(log => '<div class="log-line">' + log + '</div>').join('');
                                    logContainer.scrollTop = logContainer.scrollHeight;
                                }
                                
                                if (data.ready) {
                                    clearInterval(interval);
                                    logContainer.innerHTML += '<div class="log-line" style="color: yellow;">[BAŞARILI] YÖNLENDİRİLİYORSUNUZ...</div>';
                                    setTimeout(() => {
                                        window.location.href = '/content/microcat-epc/#/home/?appName=Microcat_EPC&subscription=DYN000000000B2F847&subscriptionAssignment=DYN0000000015ACE6E';
                                    }, 1500);
                                }
                            })
                            .catch(e => console.error("Durum kontrol hatası", e));
                    }, 1500);
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
                    console.error("Zlib hatası:", e);
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
    console.log(`Ford Proxy sunucusu ${PORT} portunda çalışıyor.`);
});
