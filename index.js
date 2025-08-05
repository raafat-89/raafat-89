const express = require('express');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const moment = require('moment-timezone');
require('dotenv').config();

// --- الإعدادات الرئيسية ---
const CONFIG = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
    SCAN_INTERVAL: 60000, // الفحص كل 60 ثانية
    REQUIRED_DISCOUNT: 5,
    MAX_AD_AGE_SECONDS: 15,
    CRYPTO_ASSETS: ['USDT', 'BTC', 'BNB', 'ETH', 'DOGE', 'SHIB'],
    FIAT_CURRENCIES: ['TRY', 'AED', 'IDR', 'KZT', 'AZN']
};

// --- تهيئة التطبيق والبوت ---
if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_CHAT_ID) {
    console.error("خطأ: متغيرات البيئة غير معرفة");
    process.exit(1);
}
const bot = new TelegramBot(CONFIG.TELEGRAM_BOT_TOKEN);
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => res.send('P2P Bot Final Version is alive!'));
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    bot.sendMessage(CONFIG.TELEGRAM_CHAT_ID, '✅ **النسخة النهائية من البوت بدأت العمل!** سأبدأ المراقبة الآن.').catch(err => console.error(err.message));
});

// --- الدوال المساعدة ---

// دالة ذكية لجلب السعر الفوري (تجرب باينانس ثم كوكوين)
async function getSpotPrice(asset, fiat) {
    // 1. محاولة جلب السعر من باينانس
    try {
        let pair = asset + fiat;
        const response = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${pair}`);
        console.log(`📈 Fetched price for ${pair} from Binance`);
        return parseFloat(response.data.price);
    } catch (error) {
        // 2. إذا فشل باينانس، جرب كوكوين
        console.log(`Binance failed for ${asset}/${fiat}. Trying KuCoin...`);
        try {
            let pair = `${asset}-${fiat}`;
            const response = await axios.get(`https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${pair}`);
            console.log(`📈 Fetched price for ${pair} from KuCoin`);
            return parseFloat(response.data.data.price);
        } catch (kucoinError) {
            console.error(`Could not get price for ${asset}/${fiat} from any source.`);
            return null;
        }
    }
}

async function processAndSendAlert(ad, platform, asset, fiat, marketPrice) {
    const price = parseFloat(ad.price);
    const createTime = new Date(ad.createTime).getTime();
    const ageInSeconds = (Date.now() - createTime) / 1000;

    if (ageInSeconds > CONFIG.MAX_AD_AGE_SECONDS) return;

    const discount = ((marketPrice - price) / marketPrice) * 100;

    if (discount >= CONFIG.REQUIRED_DISCOUNT) {
        const timeInTurkey = moment(createTime).tz('Europe/Istanbul').format('YYYY-MM-DD HH:mm:ss');
        let adLink = `https://p2p.binance.com/en/trade/${fiat}/${asset}`; // Default

        if (platform === 'Binance' && ad.advertiserNo) {
            adLink = `https://p2p.binance.com/en/advertiserDetail?advertiserNo=${ad.advertiserNo}`;
        }
        // يمكن إضافة روابط المنصات الأخرى هنا بنفس الطريقة

        const message = `
🔔 **فرصة جديدة على منصة ${platform}** 🔔

التاجر **${ad.nickName}** وضع إعلان لبيع **${asset}** مقابل **${fiat}**.

الخصم: **${discount.toFixed(2)}%**!

- **وقت الإعلان (بتوقيت تركيا):** ${timeInTurkey}
- **رابط مباشر:** [اضغط هنا](${adLink})
        `;
        try {
            await bot.sendMessage(CONFIG.TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' });
            console.log(`📤 Alert sent for ${asset}/${fiat} from ${platform}`);
        } catch (error) {
            console.error("Telegram send error:", error.message);
        }
    }
}

// --- دوال فحص المنصات ---
async function checkBinanceP2P(asset, fiat) {
    try {
        const { data } = await axios.post('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', { page: 1, rows: 5, asset, tradeType: 'SELL', fiat });
        return data.data.map(item => ({ price: item.adv.price, createTime: item.adv.createTime, nickName: item.advertiser.nickName, advertiserNo: item.advertiser.userNo }));
    } catch (error) { 
        console.error(`Binance P2P check failed for ${asset}/${fiat}: ${error.message}`);
        return []; 
    }
}
// يمكن إضافة دوال فحص Bybit و KuCoin هنا

// --- حلقة المراقبة الرئيسية ---
async function mainMonitoringLoop() {
    console.log(`\n--- [${moment().tz('Europe/Istanbul').format('HH:mm:ss')}] Starting new scan cycle ---`);
    
    for (const fiat of CONFIG.FIAT_CURRENCIES) {
        for (const crypto of CONFIG.CRYPTO_ASSETS) {
            const marketPrice = await getSpotPrice(crypto, fiat);
            if (!marketPrice) continue;
            
            const binanceAds = await checkBinanceP2P(crypto, fiat);
            for (const ad of binanceAds) await processAndSendAlert(ad, 'Binance', crypto, fiat, marketPrice);
            
            // يمكن استدعاء دوال فحص Bybit و KuCoin هنا
            
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
}

// بدء حلقة المراقبة
setInterval(mainMonitoringLoop, CONFIG.SCAN_INTERVAL);
mainMonitoringLoop();
