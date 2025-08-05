const express = require('express');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const moment = require('moment-timezone');
require('dotenv').config();

// --- الإعدادات الرئيسية ---
const CONFIG = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
    SCAN_INTERVAL: 90000,
    REPORT_INTERVAL: 300000,
    REQUIRED_DISCOUNT: 5,
    MAX_AD_AGE_SECONDS: 15,
    CRYPTO_ASSETS: ['USDT', 'BTC', 'BNB', 'ETH', 'DOGE', 'SHIB'],
    FIAT_CURRENCIES: ['TRY', 'AED', 'IDR', 'KZT', 'AZN'],
    COINGECKO_IDS: {
        'USDT': 'tether', 'BTC': 'bitcoin', 'BNB': 'binancecoin', 'ETH': 'ethereum', 'DOGE': 'dogecoin', 'SHIB': 'shiba-inu'
    }
};

// --- ذاكرة مؤقتة للتقارير ---
let reportData = { cheapestAds: {}, errors: [] };

// --- تهيئة التطبيق والبوت ---
if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_CHAT_ID) {
    console.error("خطأ: متغيرات البيئة غير معرفة");
    process.exit(1);
}
const bot = new TelegramBot(CONFIG.TELEGRAM_BOT_TOKEN);
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => res.send('Smart P2P Bot (Waterfall Price) is alive!'));
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    bot.sendMessage(CONFIG.TELEGRAM_CHAT_ID, '✅ **النسخة الذكية (بمصادر أسعار متعددة) بدأت العمل!**').catch(err => console.error(err.message));
});

// --- الدوال المساعدة ---

// دالة الشلال الذكية لجلب السعر
async function getSpotPrice(asset, fiat) {
    // المحاولة الأولى: Binance
    try {
        const response = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${asset}${fiat}`);
        if (response.data.price) return parseFloat(response.data.price);
    } catch (e) { /* تجاهل الخطأ والمتابعة */ }

    // المحاولة الثانية: KuCoin
    try {
        const response = await axios.get(`https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${asset}-${fiat}`);
        if (response.data.data.price) return parseFloat(response.data.data.price);
    } catch (e) { /* تجاهل الخطأ والمتابعة */ }

    // المحاولة الثالثة: Bybit
    try {
        const response = await axios.get(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${asset}${fiat}`);
        if (response.data.result.list[0].lastPrice) return parseFloat(response.data.result.list[0].lastPrice);
    } catch (e) { /* تجاهل الخطأ والمتابعة */ }
    
    // المحاولة الرابعة والأخيرة: CoinGecko
    try {
        const cryptoId = CONFIG.COINGECKO_IDS[asset];
        const fiatId = fiat.toLowerCase();
        const response = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${cryptoId}&vs_currencies=${fiatId}`);
        const price = response.data[cryptoId]?.[fiatId];
        if (price) return price;
    } catch(e) { /* تجاهل الخطأ والمتابعة */ }
    
    // إذا فشلت كل المحاولات
    reportData.errors.push(`فشل جلب سعر السوق لـ ${asset}/${fiat} من كل المصادر`);
    return null;
}

function updateCheapestAdReport(ad, platform, asset, fiat) {
    // ... (هذه الدالة تبقى كما هي) ...
}

async function processAndSendAlert(ad, platform, asset, fiat, marketPrice) {
    // ... (هذه الدالة تبقى كما هي) ...
}

// --- دوال فحص المنصات ---
async function checkP2P(platform, asset, fiat) {
    // ... (هذه الدالة تبقى كما هي) ...
}

// --- حلقة المراقبة الرئيسية ---
async function mainMonitoringLoop() {
    console.log(`\n--- Starting new scan cycle ---`);
    reportData = { cheapestAds: {}, errors: [] };

    for (const fiat of CONFIG.FIAT_CURRENCIES) {
        for (const crypto of CONFIG.CRYPTO_ASSETS) {
            const marketPrice = await getSpotPrice(crypto, fiat); // استخدام الدالة الجديدة الذكية
            if (!marketPrice) {
                 await new Promise(resolve => setTimeout(resolve, 2000));
                 continue;
            }
            
            const binanceAds = await checkP2P('Binance', crypto, fiat);
            for (const ad of binanceAds) await processAndSendAlert(ad, 'Binance', crypto, fiat, marketPrice);
            
            // يمكن إضافة Bybit و KuCoin هنا
            
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
}

// --- دالة إرسال التقرير الدوري ---
async function sendStatusReport() {
    // ... (هذه الدالة تبقى كما هي) ...
}

// بدء حلقة المراقبة وحلقة التقارير
setInterval(mainMonitoringLoop, CONFIG.SCAN_INTERVAL);
setInterval(sendStatusReport, CONFIG.REPORT_INTERVAL);
mainMonitoringLoop();
