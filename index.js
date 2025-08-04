Skip to content
Navigation Menu
raafat-89

Code
Pull requests
Actions
Commit 7dfe73a
raafat-89
raafat-89
authored
3 minutes ago
Verified
Update index.js
main
1 parent 
ecd0f4c
 commit 
7dfe73a
1 file changed
Search within code
 
Customizable line height
The default line height has been increased for improved accessibility. You can choose to enable a more compact line height from the view settings menu.

‎index.js
+121
-39
Lines changed: 121 additions & 39 deletions
Original file line number	Diff line number	Diff line change
@@ -1,60 +1,142 @@
const express = require('express');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const moment = require('moment-timezone');
require('dotenv').config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
// --- الإعدادات الرئيسية ---
const CONFIG = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
    SCAN_INTERVAL: 60000, // الفحص كل 60 ثانية لتقليل خطر الحظر
    REQUIRED_DISCOUNT: 5,
    MAX_AD_AGE_SECONDS: 15,
    CRYPTO_ASSETS: ['USDT', 'BTC', 'BNB', 'ETH', 'DOGE', 'SHIB'],
    FIAT_CURRENCIES: ['TRY', 'AED', 'IDR', 'KZT', 'AZN']
};

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("Error: Environment variables are not set.");
// --- تهيئة التطبيق والبوت ---
if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_CHAT_ID) {
    console.error("خطأ: متغيرات البيئة غير معرفة");
    process.exit(1);
}
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);
const bot = new TelegramBot(CONFIG.TELEGRAM_BOT_TOKEN);
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => res.send('Diagnostic Bot is running.'));
app.get("/", (req, res) => res.send('Comprehensive P2P Bot is alive!'));
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    bot.sendMessage(TELEGRAM_CHAT_ID, '✅ **بوت التشخيص بدأ العمل.** سأحاول الآن الاتصال بباينانس.').catch(err => console.error(err.message));
    bot.sendMessage(CONFIG.TELEGRAM_CHAT_ID, '✅ **بوت المراقبة الشامل بدأ العمل!** أراقب الآن Binance, Bybit, و KuCoin.').catch(err => console.error(err.message));
});

async function runTest() {
    console.log("Attempting to fetch data from Binance P2P for USDT/TRY...");
// --- الدوال المساعدة ---
async function getBinanceSpotPrice(asset, fiat) {
    try {
        const response = await axios.post(
            'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search',
            {
                page: 1,
                rows: 5,
                payTypes: [],
                asset: 'USDT',
                tradeType: 'SELL',
                fiat: 'TRY'
            },
            {
                headers: { 'Content-Type': 'application/json' }
            }
        );
        const ads = response.data.data;
        if (ads && ads.length > 0) {
            console.log(`Success! Found ${ads.length} ads.`);
            const firstAdPrice = ads[0].adv.price;
            const message = `🎉 **نجح الاختبار!** 🎉\n\nتمكنت من الاتصال بباينانس وجلب الإعلانات بنجاح.\n\nعدد الإعلانات التي وجدتها لـ USDT/TRY هو: ${ads.length}\nسعر أول إعلان هو: ${firstAdPrice} TRY`;
            await bot.sendMessage(TELEGRAM_CHAT_ID, message);
        } else {
            console.log("Request was successful, but no ads were found.");
            await bot.sendMessage(TELEGRAM_CHAT_ID, '⚠️ **تنبيه:** تم الاتصال بباينانس بنجاح، لكن لم أجد أي إعلانات لـ USDT/TRY في الوقت الحالي.');
        let pair = asset + fiat;
        if (['DOGE', 'SHIB'].includes(asset) && fiat !== 'USDT') {
             const assetToUsdtResponse = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${asset}USDT`);
             const usdtToFiatResponse = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=USDT${fiat}`);
             if(assetToUsdtResponse.data.price && usdtToFiatResponse.data.price) {
                return assetToUsdtResponse.data.price * usdtToFiatResponse.data.price;
             }
        }
        const response = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${pair}`);
        return parseFloat(response.data.price);
    } catch (error) {
        console.error("Test failed. Error fetching data:", error.message);
        await bot.sendMessage(TELEGRAM_CHAT_ID, `❌ **فشل الاختبار!** ❌\n\nلم أتمكن من جلب البيانات من باينانس. الخطأ هو:\n\`${error.message}\``, { parse_mode: 'Markdown' });
        return null;
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
        let adLink = `https://p2p.binance.com/en/trade/${fiat}/${asset}`; // Default link
        if (platform === 'Binance' && ad.advertiserNo) {
            adLink = `https://p2p.binance.com/en/advertiserDetail?advertiserNo=${ad.advertiserNo}`;
        } else if (platform === 'Bybit') {
            adLink = `https://www.bybit.com/fiat/trade/otc/?actionType=1&token=${asset}&fiat=${fiat}&paymentMethod=`;
        } else if (platform === 'KuCoin') {
            adLink = `https://www.kucoin.com/otc/buy/${asset}-${fiat}`;
        }
        const message = `
🔔 **فرصة جديدة على منصة ${platform}** 🔔
منذ أقل من ${CONFIG.MAX_AD_AGE_SECONDS} ثانية، التاجر **${ad.nickName}** وضع إعلان لبيع عملة **${asset}** مقابل **${fiat}**.
سعر العملة أقل من سعرها على Binance Spot بنسبة **${discount.toFixed(2)}%**!
- **وقت الإعلان (بتوقيت تركيا):** ${timeInTurkey}
- **رابط مباشر:** [اضغط هنا](${adLink})
        `;
        try {
            await bot.sendMessage(CONFIG.TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' });
            console.log(`📤 تم إرسال تنبيه من ${platform} للزوج ${asset}/${fiat}`);
        } catch (error) {
            console.error("خطأ في إرسال رسالة تليغرام:", error.message);
        }
    }
}
// --- دوال فحص المنصات ---
async function checkBinanceP2P(asset, fiat) {
    try {
        const { data } = await axios.post('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', { page: 1, rows: 5, payTypes: [], asset, tradeType: 'SELL', fiat });
        return data.data.map(item => ({ price: item.adv.price, createTime: item.adv.createTime, nickName: item.advertiser.nickName, advertiserNo: item.advertiser.userNo }));
    } catch (error) { return []; }
}
async function checkBybitP2P(asset, fiat) {
    try {
        const { data } = await axios.post('https://api2.bybit.com/fiat/otc/item/online', { tokenId: asset, currencyId: fiat, side: "0", size: "5", page: "1" });
        return data.result.items.map(item => ({ price: item.price, createTime: item.lastUpdateTime, nickName: item.nickName }));
    } catch (error) { return []; }
}
async function checkKuCoinP2P(asset, fiat) {
    try {
        const { data } = await axios.get(`https://www.kucoin.com/_api/otc/ad/list?currency=${asset}&side=SELL&legal=${fiat}&page=1&pageSize=5`, { headers: { 'User-Agent': 'Mozilla/5.0' }});
        return data.items.map(item => ({ price: item.floatPrice, createTime: item.createdAt, nickName: item.nickName }));
    } catch (error) { return []; }
}
// --- حلقة المراقبة الرئيسية ---
async function mainMonitoringLoop() {
    console.log(`\n--- [${moment().tz('Europe/Istanbul').format('HH:mm:ss')}] بدء دورة فحص شاملة ---`);
    
    for (const fiat of CONFIG.FIAT_CURRENCIES) {
        for (const crypto of CONFIG.CRYPTO_ASSETS) {
            const marketPrice = await getBinanceSpotPrice(crypto, fiat);
            if (!marketPrice) continue;
            console.log(`🔍 Checking ${crypto}/${fiat}...`);
            
            const binanceAds = await checkBinanceP2P(crypto, fiat);
            for (const ad of binanceAds) await processAndSendAlert(ad, 'Binance', crypto, fiat, marketPrice);
            
            const bybitAds = await checkBybitP2P(crypto, fiat);
            for (const ad of bybitAds) await processAndSendAlert(ad, 'Bybit', crypto, fiat, marketPrice);
            
            const kucoinAds = await checkKuCoinP2P(crypto, fiat);
            for (const ad of kucoinAds) await processAndSendAlert(ad, 'KuCoin', crypto, fiat, marketPrice);
            await new Promise(resolve => setTimeout(resolve, 2000)); // فاصل بين كل زوج عملات
        }
    }
}

// تشغيل الاختبار مرة واحدة بعد 10 ثواني من بدء التشغيل
setTimeout(runTest, 10000);
// بدء حلقة المراقبة
setInterval(mainMonitoringLoop, CONFIG.SCAN_INTERVAL);
mainMonitoringLoop();
0 commit comments
Comments
0
 (0)
Comment
You're receiving notifications because you're subscribed to this thread.

