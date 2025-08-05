const express = require('express');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const moment = require('moment-timezone');
require('dotenv').config();

// --- الإعدادات الرئيسية ---
const CONFIG = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
    SCAN_INTERVAL: 120000, // الفحص كل دقيقتين للتشخيص
    REQUIRED_DISCOUNT: 5,
    MAX_AD_AGE_SECONDS: 15,
    CRYPTO_ASSETS: ['USDT', 'BTC'], // تقليل عدد العملات للتركيز في التشخيص
    FIAT_CURRENCIES: ['TRY', 'AED'] // تقليل عدد العملات للتركيز في التشخيص
};

// --- تهيئة التطبيق والبوت ---
if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_CHAT_ID) {
    console.error("خطأ: متغيرات البيئة غير معرفة");
    process.exit(1);
}
const bot = new TelegramBot(CONFIG.TELEGRAM_BOT_TOKEN);
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => res.send('Final Diagnostic Bot is running!'));
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    bot.sendMessage(CONFIG.TELEGRAM_CHAT_ID, '✅ **بوت التشخيص المفصل بدأ العمل.** سأرسل لك الآن تقريراً عن كل خطوة.').catch(err => console.error(err.message));
});

// دالة آمنة لإرسال الرسائل
async function safeSendMessage(message) {
    try {
        await bot.sendMessage(CONFIG.TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error("Failed to send message:", error.message);
    }
}

// --- الدوال المساعدة ---
async function getBinanceSpotPrice(asset, fiat) {
    try {
        const response = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${asset}${fiat}`);
        return parseFloat(response.data.price);
    } catch (error) {
        await safeSendMessage(`⚠️ فشل جلب سعر السوق للزوج *${asset}/${fiat}*.`);
        return null;
    }
}

async function checkP2P(platform, asset, fiat) {
     try {
        let ads = [];
        if (platform === 'Binance') {
            const { data } = await axios.post('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', { page: 1, rows: 5, asset, tradeType: 'SELL', fiat });
            ads = data.data || [];
        }
        // يمكن إضافة Bybit و KuCoin هنا لاحقاً بنفس الطريقة

        await safeSendMessage(`✅ فحص *${platform}* للزوج *${asset}/${fiat}*: تم العثور على *${ads.length}* إعلان.`);
        return ads;

    } catch (error) { 
        await safeSendMessage(`❌ خطأ في فحص *${platform}* للزوج *${asset}/${fiat}*.`);
        return []; 
    }
}

// --- حلقة المراقبة الرئيسية ---
async function mainMonitoringLoop() {
    const startTime = moment().tz('Europe/Istanbul').format('HH:mm:ss');
    await safeSendMessage(`--- [${startTime}] بدء دورة فحص جديدة ---`);

    for (const fiat of CONFIG.FIAT_CURRENCIES) {
        for (const crypto of CONFIG.CRYPTO_ASSETS) {

            await safeSendMessage(`*🔍 جارٍ فحص ${crypto}/${fiat}...*`);

            const marketPrice = await getBinanceSpotPrice(crypto, fiat);
            if (!marketPrice) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                continue; 
            }
            await safeSendMessage(`📈 سعر السوق لـ *${crypto}/${fiat}* هو: *${marketPrice}*`);

            // فحص المنصات
            await checkP2P('Binance', crypto, fiat);
            // await checkP2P('Bybit', crypto, fiat);
            // await checkP2P('KuCoin', crypto, fiat);

            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
     const endTime = moment().tz('Europe/Istanbul').format('HH:mm:ss');
     await safeSendMessage(`--- [${endTime}] انتهاء دورة الفحص ---`);
}

// بدء حلقة المراقبة
setInterval(mainMonitoringLoop, CONFIG.SCAN_INTERVAL);
mainMonitoringLoop();
