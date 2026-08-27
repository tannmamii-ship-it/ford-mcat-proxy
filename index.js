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

// 1. Arka Planda Gizlice Giriş Yapan Fonksiyon
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
        
        // Giriş sayfasına git
        await page.goto('https://login.superservice.com/login/tr/?goto=https:%2F%2Flogin.superservice.com%2F', { waitUntil: 'networkidle2' });

        // Senin verdiğin ID'ler ve bilgilerle formu doldur
        await page.type('#username', 'manfordb2b@yandex.com', { delay: 50 });
        await page.type('#passwordInput', '0326Aoyp.', { delay: 50 });
        await page.click('#loginButton');

        // Yönlendirmeyi bekle ve doğrudan asıl katalog adresine git (Başlat butonuna basmakla zaman kaybetmeden)
        await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
        await page.goto('https://microcat-europe.superservice.com/content/microcat-epc/#/home/?appName=Microcat_EPC&subscription=DYN000000000B2F847&subscriptionAssignment=DYN0000000015ACE6E', { waitUntil: 'networkidle2' });

        // Tüm oturum çerezlerini (anahtarları) al
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

// 2. Favicon
app.get('/favicon.ico', (req, res) => {
    res.sendFile(path.join(__dirname, 'favicon.ico'));
});

// 3. Durum Kontrol Rotası (Ekranda GIF dönerken burayı kontrol edecek)
app.get('/api/status', (req, res) => {
    res.json({ ready: isReady });
});

// 4. Ana Sayfa (Loading Ekranı) ve Proxy Yönlendirici
app.use((req, res, next) => {
    // Eğer oturum açılmadıysa Yükleniyor ekranını (GIF) göster
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
                </style>
            </head>
            <body>
                <img src="https://i.gifer.com/ZKZg.gif" alt="Yükleniyor" />
                <h2>Sisteme Güvenli Giriş Yapılıyor...</h2>
                <p>Lütfen bekleyin, katalog hazırlanıyor. Bu işlem birkaç saniye sürebilir.</p>
                <script>
                    const interval = setInterval(() => {
                        fetch('/api/status').then(r => r.json()).then(data => {
                            if (data.ready) {
                                clearInterval(interval);
                                // Hazır olunca URL'i değiştirmeden proxy'e yönlendir
                                window.location.href = '/content/microcat-epc/#/home/?appName=Microcat_EPC&subscription=DYN000000000B2F847&subscriptionAssignment=DYN0000000015ACE6E';
                            }
                        });
                    }, 2000);
                </script>
            </body>
            </html>
        `);
    }

    // İstek kök dizine geldiyse ve hazırsak direkt kataloğa fırlat (kendi sitemiz içinde)
    if (isReady && req.path === '/') {
        return res.redirect('/content/microcat-epc/#/home/?appName=Microcat_EPC&subscription=DYN000000000B2F847&subscriptionAssignment=DYN0000000015ACE6E');
    }

    next();
});

// 5. Kesin ve Kusursuz Proxy Katmanı
app.use('/', createProxyMiddleware({
    target: 'https://microcat-europe.superservice.com',
    changeOrigin: true,
    secure: false,
    autoRewrite: true, // Adres çubuğunu bizim domaninde tutar
    hostRewrite: true, 
    onProxyReq: (proxyReq) => {
        // Çerezleri enjekte et
        if (sessionCookies.length > 0) {
            const cookieStr = sessionCookies.map(c => `${c.name}=${c.value}`).join('; ');
            proxyReq.setHeader('cookie', cookieStr);
        }
    },
    onProxyRes: (proxyRes, req, res) => {
        // Tarayıcının orijinal siteye kaçmasını önleyen bariyer
        if ([301, 302, 307, 308].includes(proxyRes.statusCode)) {
            const location = proxyRes.headers['location'];
            if (location && location.includes('login.superservice.com')) {
                isReady = false; // Oturum düşmüş demektir, başa sar
                proxyRes.headers['location'] = '/';
            }
        }

        // HTML dosyasının arasına girip senin yasaklı CSS listeni gömeceğiz
        const isHtml = proxyRes.headers['content-type'] && proxyRes.headers['content-type'].includes('text/html');

        if (isHtml) {
            delete proxyRes.headers['content-length']; // Boyut değişeceği için siliyoruz

            const _write = res.write;
            const _end = res.end;
            let bodyChunks = [];

            res.write = function (chunk) { bodyChunks.push(Buffer.from(chunk)); };
            res.end = function (chunk) {
                if (chunk) bodyChunks.push(Buffer.from(chunk));
                
                let buffer = Buffer.concat(bodyChunks);
                const encoding = proxyRes.headers['content-encoding'];

                // Sıkıştırılmış veriyi açıyoruz (Bu yüzden hata veriyordu, çözdük!)
                try {
                    if (encoding === 'gzip') buffer = zlib.gunzipSync(buffer);
                    else if (encoding === 'deflate') buffer = zlib.inflateSync(buffer);
                    else if (encoding === 'br') buffer = zlib.brotliDecompressSync(buffer);
                    delete proxyRes.headers['content-encoding']; // Açtığımız için başlığı sil
                } catch (e) {
                    console.error("Zlib açma hatası:", e);
                }

                let html = buffer.toString('utf8');

                // İstediğin yasaklı elemanlar listesi (Tamamen gizler)
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

                // Başlığı Ford Microcat yap ve CSS'i Head etiketine göm
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
