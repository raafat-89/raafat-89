const express = require('express');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const moment = require('moment-timezone');
require('dotenv').config();

// --- الإعدادات الرئيسية ---
const CONFIG = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
    SCAN_INTERVAL: 90000, // الفحص كل 90 ثانية للتشخيص
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

app.get("/", (req, res) => res.send('Diagnostic Bot v2 is running!'));
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    bot.sendMessage(CONFIG.TELEGRAM_CHAT_ID, '✅ **بوت التشخيص النهائي بدأ العمل.** سأرسل لك تحديثات عن كل خطوة.').catch(err => console.error(err.message));
});

// --- الدوال المساعدة ---
async function getBinanceSpotPrice(asset, fiat) {
    try {
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
        // إرسال رسالة خطأ عند فشل جلب السعر
        bot.sendMessage(CONFIG.TELEGRAM_CHAT_ID, `⚠️ فشل جلب سعر السوق للزوج ${asset}/${fiat}.`).catch(e => console.error(e.message));
        return null;
    }
}

// دالة فحص باينانس
async function checkBinanceP2P(asset, fiat) {
    try {
        const { data } = await axios.post('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', { page: 1, rows: 5, payTypes: [], asset, tradeType: 'SELL', fiat });
        return data.data || []; // تأكد من إرجاع مصفوفة دائماً
    } catch (error) { 
        bot.sendMessage(CONFIG.TELEGRAM_CHAT_ID, `❌ خطأ في فحص Binance للزوج ${asset}/${fiat}.`).catch(e => console.error(e.message));
        return []; 
    }
}

// --- حلقة المراقبة الرئيسية ---
async function mainMonitoringLoop() {
    const startTime = moment().tz('Europe/Istanbul').format('HH:mm:ss');
    await bot.sendMessage(CONFIG.TELEGRAM_CHAT_ID, `--- [${startTime}] بدء دورة فحص جديدة ---`).catch(e => console.error(e.message));
    
    let alertSentForTest = false; // للتأكد من إرسال تنبيه اختباري مرة واحدة فقط

    for (const fiat of CONFIG.FIAT_CURRENCIES) {
        for (const crypto of CONFIG.CRYPTO_ASSETS) {
            
            await bot.sendMessage(CONFIG.TELEGRAM_CHAT_ID, `🔍 جارٍ فحص ${crypto}/${fiat}...`).catch(e => console.error(e.message));
            
            const marketPrice = await getBinanceSpotPrice(crypto, fiat);
            if (!marketPrice) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                continue; 
            }

            const binanceAds = await checkBinanceP2P(crypto, fiat);

            if(binanceAds.length > 0) {
                 await bot.sendMessage(CONFIG.TELEGRAM_CHAT_ID, `✅ تم العثور على ${binanceAds.length} إعلان لـ ${crypto}/${fiat} على Binance.`).catch(e => console.error(e.message));
                 
                 // --- اختبار إرسال التنبيه ---
                 if (crypto === 'USDT' && fiat === 'TRY' && !alertSentForTest) {
                     const firstAd = binanceAds[0].adv;
                     const testMessage = `🎉 **اختبار آلية التنبيه ناجح!**\n\nهذه رسالة تجريبية تؤكد أن البوت قادر على إرسال التنبيهات.\n\n- التاجر: ${firstAd.nickName}\n- السعر: ${firstAd.price}`;
                     await bot.sendMessage(CONFIG.TELEGRAM_CHAT_ID, testMessage, { parse_mode: 'Markdown' });
                     alertSentForTest = true;
                 }

            } else {
                 await bot.sendMessage(CONFIG.TELEGRAM_CHAT_ID, `ℹ️ لم يتم العثور على إعلانات لـ ${crypto}/${fiat} على Binance.`).catch(e => console.error(e.message));
            }
            
            await new Promise(resolve => setTimeout(resolve, 2000)); // فاصل بين كل زوج عملات
        }
    }
     const endTime = moment().tz('Europe/Istanbul').format('HH:mm:ss');
     await bot.sendMessage(CONFIG.TELEGRAM_CHAT_ID, `--- [${endTime}] انتهاء دورة الفحص ---`).catch(e => console.error(e.message));
}

// بدء حلقة المراقبة
setInterval(mainMonitoringLoop, CONFIG.SCAN_INTERVAL);
mainMonitoringLoop();
