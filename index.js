const express = require('express');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const moment = require('moment-timezone');
require('dotenv').config();

// --- الإعدادات الرئيسية ---
const CONFIG = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
    SCAN_INTERVAL: 30000, // الفحص كل 30 ثانية لتجنب الحظر
    REQUIRED_DISCOUNT: 19,
    MAX_AD_AGE_SECONDS: 10,
    CRYPTO_ASSETS: ['USDT', 'BTC', 'BNB', 'ETH', 'DOGE', 'SHIB'],
    FIAT_CURRENCIES: ['TRY', 'AED', 'IDR', 'KZT', 'AZN']
};

// --- تهيئة التطبيق والبوت ---
if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_CHAT_ID) {
    console.error("خطأ: الرجاء التأكد من تعريف متغيرات البيئة");
    process.exit(1);
}
const bot = new TelegramBot(CONFIG.TELEGRAM_BOT_TOKEN);
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => res.send('Advanced P2P Bot is alive!'));
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    bot.sendMessage(CONFIG.TELEGRAM_CHAT_ID, '✅ **البوت المطور بدأ العمل الآن!** سأقوم بمراقبة شاملة للعملات التي حددتها.').catch(err => console.error(err.message));
});

// --- الدوال المساعدة ---

// دالة لجلب السعر الفوري من باينانس
async function getBinanceSpotPrice(asset, fiat) {
    try {
        // بعض العملات مثل DOGE و SHIB لا يتم تداولها مباشرة مقابل كل العملات الورقية
        // لذا، نحولها أولاً إلى USDT ثم إلى العملة الورقية
        let pair = asset + fiat;
        if (['DOGE', 'SHIB'].includes(asset) && fiat !== 'USDT') {
             const assetToUsdtResponse = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${asset}USDT`);
             const usdtToFiatResponse = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=USDT${fiat}`);
             return assetToUsdtResponse.data.price * usdtToFiatResponse.data.price;
        }
        
        const response = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${pair}`);
        return parseFloat(response.data.price);
    } catch (error) {
        // console.error(`لا يوجد سعر فوري للزوج ${asset}/${fiat}: ${error.message}`);
        return null;
    }
}

// دالة لمعالجة وإرسال التنبيهات
async function processAndSendAlert(ad, platform, asset, fiat, marketPrice) {
    const price = parseFloat(ad.price);
    const createTime = new Date(ad.createTime).getTime();
    const ageInSeconds = (Date.now() - createTime) / 1000;

    if (ageInSeconds > CONFIG.MAX_AD_AGE_SECONDS) return;

    const discount = ((marketPrice - price) / marketPrice) * 100;

    if (discount >= CONFIG.REQUIRED_DISCOUNT) {
        const timeInTurkey = moment(createTime).tz('Europe/Istanbul').format('YYYY-MM-DD HH:mm:ss');
        
        // إنشاء رابط الإعلان
        let adLink = `https://p2p.binance.com/en/trade/${fiat}/${asset}`; // رابط عام كحل احتياطي
        if(platform === 'Binance' && ad.advertiserNo) {
            adLink = `https://p2p.binance.com/en/advertiserDetail?advertiserNo=${ad.advertiserNo}`;
        }

        const message = `
🔔 **فرصة جديدة على منصة ${platform}** 🔔

منذ أقل من 10 ثواني، التاجر **${ad.nickName}** وضع إعلان لبيع عملة **${asset}** مقابل **${fiat}**.

سعر العملة أقل من سعرها على Binance Spot بنسبة **${discount.toFixed(2)}%**!

- **وقت الإعلان (بتوقيت تركيا):** ${timeInTurkey}
- **رابط الإعلان المباشر:** [اضغط هنا](${adLink})
        `;
        try {
            await bot.sendMessage(CONFIG.TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' });
            console.log(`📤 تم إرسال تنبيه من ${platform} للزوج ${asset}/${fiat}`);
        } catch (error) {
            console.error("خطأ في إرسال رسالة تليغرام:", error.message);
        }
    }
}

// --- دوال فحص المنصات (معدلة لتقبل أزواج العملات) ---

async function checkBinanceP2P(asset, fiat) {
    try {
        const { data } = await axios.post('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', { page: 1, rows: 5, payTypes: [], asset, tradeType: 'SELL', fiat });
        return data.data.map(item => ({ price: item.adv.price, createTime: item.adv.createTime, nickName: item.advertiser.nickName, advertiserNo: item.advertiser.userNo }));
    } catch (error) { return []; }
}

// --- حلقة المراقبة الرئيسية ---
async function mainMonitoringLoop() {
    console.log(`\n--- [${moment().tz('Europe/Istanbul').format('HH:mm:ss')}] بدء دورة فحص جديدة ---`);
    
    for (const fiat of CONFIG.FIAT_CURRENCIES) {
        for (const crypto of CONFIG.CRYPTO_ASSETS) {
            
            const marketPrice = await getBinanceSpotPrice(crypto, fiat);
            if (!marketPrice) {
                continue; // تخطي الزوج إذا لم يكن له سعر فوري
            }
            
            // فحص باينانس
            const binanceAds = await checkBinanceP2P(crypto, fiat);
            for (const ad of binanceAds) {
                await processAndSendAlert(ad, 'Binance', crypto, fiat, marketPrice);
            }
            
            // يمكن إضافة Bybit و KuCoin هنا بنفس الطريقة مستقبلاً
            
            await new Promise(resolve => setTimeout(resolve, 1000)); // فاصل بسيط بين الطلبات لتجنب الحظر
        }
    }
}

// بدء حلقة المراقبة وتكرارها
setInterval(mainMonitoringLoop, CONFIG.SCAN_INTERVAL);
mainMonitoringLoop();
