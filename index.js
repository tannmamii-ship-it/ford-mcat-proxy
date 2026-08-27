const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

let sessionCookies = null;
let isLoggingIn = false;

async function getCookies() {
    if (sessionCookies) return sessionCookies;
    
    if (isLoggingIn) {
        while (isLoggingIn) {
            await new Promise(r => setTimeout(r, 500));
        }
        return sessionCookies;
    }

    isLoggingIn = true;
    let browser = null;
    try {
        const executablePath = await chromium.executablePath();
        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: executablePath,
            headless: chromium.headless,
            ignoreHTTPSErrors: true,
        });

        const page = await browser.newPage();
        await page.goto('https://login.superservice.com/login/tr/?goto=https:%2F%2Flogin.superservice.com%2F', { 
            waitUntil: 'networkidle2',
            timeout: 60000 
        });

        await page.waitForSelector('input[name="username"]', { timeout: 15000 });
        await page.type('input[name="username"]', process.env.FORD_USER, { delay: 30 });
        await page.type('input[name="password"]', process.env.FORD_PASS, { delay: 30 });
        await page.click('#loginButton');

        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
        
        sessionCookies = await page.cookies();
        await browser.close();
        isLoggingIn = false;
        return sessionCookies;
    } catch (error) {
        isLoggingIn = false;
        if (browser) await browser.close();
        console.error("Giriş Hatası:", error);
        throw error;
    }
}

app.get('/favicon.ico', (req, res) => {
    res.sendFile(path.join(__dirname, 'favicon.ico'));
});

// Kök dizine gelenleri doğrudan Microcat kataloğuna yönlendir
app.get('/', (req, res) => {
    res.redirect('/content/microcat-epc/#/home/?appName=Microcat_EPC&subscription=DYN000000000B2F847&subscriptionAssignment=DYN0000000015ACE6E');
});

// Hedef sunucuyu doğrudan microcat-europe olarak ayarlayan Proxy Katmanı
app.use('/', async (req, res, next) => {
    try {
        const cookies = await getCookies();
        const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

        createProxyMiddleware({
            target: 'https://microcat-europe.superservice.com',
            changeOrigin: true,
            secure: false,
            onProxyReq: (proxyReq) => {
                proxyReq.setHeader('cookie', cookieHeader);
            },
            onProxyRes: (proxyRes) => {
                if (proxyRes.statusCode === 302 || proxyRes.statusCode === 401) {
                    sessionCookies = null;
                }

                const contentType = proxyRes.headers['content-type'] || '';
                if (contentType.includes('text/html')) {
                    let responseBody = Buffer.from([]);

                    proxyRes.write = function (chunk) {
                        responseBody = Buffer.concat([responseBody, chunk]);
                    };

                    proxyRes.end = function (chunk) {
                        if (chunk) {
                            responseBody = Buffer.concat([responseBody, chunk]);
                        }
                        
                        let bodyString = responseBody.toString('utf8');
                        
                        // Sekme başlığını Ford Microcat yap
                        if (bodyString.includes('<title>')) {
                            bodyString = bodyString.replace(/<title>.*?<\/title>/i, '<title>Ford Microcat</title>');
                        } else {
                            bodyString = bodyString.replace('<head>', '<head><title>Ford Microcat</title>');
                        }

                        proxyRes.setHeader('content-length', Buffer.byteLength(bodyString));
                        res.end(bodyString);
                    };
                }
            }
        })(req, res, next);

    } catch (err) {
        res.status(500).send("Proxy Bağlantı Hatası: " + err.message);
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Ford Proxy sunucusu ${PORT} portunda çalışıyor.`);
});
