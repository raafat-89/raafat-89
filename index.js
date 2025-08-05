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
    CRYPTO_ASSETS: ['USDT', 'BTC', 'ETH'],
    FIAT_CURRENCIES: ['TRY', 'AED', 'USD'],
    COINGECKO_IDS: {
        'USDT': 'tether', 'BTC': 'bitcoin', 'ETH': 'ethereum'
    }
};

let reportData = { cheapestAds: {}, errors: [] };

if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_CHAT_ID) {
    console.error("خطأ: متغيرات البيئة غير معرفة");
    process.exit(1);
}
const bot = new TelegramBot(CONFIG.TELEGRAM_BOT_TOKEN);
const app = express();
const PORT = process.env.PORT || 3000;

async function safeSendMessage(message) {
    try {
        await bot.sendMessage(CONFIG.TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error("Telegram send error:", error.message);
    }
}

app.get("/", (req, res) => res.send('P2P Bot Final Optimized Version is alive!'));
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    safeSendMessage('✅ **النسخة النهائية والمحسّنة بدأت العمل!**');
});

// دالة محسنة لجلب كل الأسعار في طلب واحد
async function getAllMarketPrices() {
    try {
        const cryptoIds = Object.values(CONFIG.COINGECKO_IDS).join(',');
        const fiatIds = CONFIG.FIAT_CURRENCIES.map(f => f.toLowerCase()).join(',');
        
        const response = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${cryptoIds}&vs_currencies=${fiatIds}`);
        
        console.log("Successfully fetched all market prices from CoinGecko in one call.");
        return response.data;
    } catch (error) {
        console.error(`Major failure in fetching prices from CoinGecko: ${error.message}`);
        reportData.errors.push("فشل الاتصال بمصدر الأسعار الرئيسي CoinGecko");
        return null;
    }
}

function updateCheapestAdReport(ad, platform, asset, fiat) {
    const pairKey = `${asset}/${fiat}`;
    const adPrice = parseFloat(ad.price);
    if (!reportData.cheapestAds[pairKey] || adPrice < reportData.cheapestAds[pairKey].price) {
        reportData.cheapestAds[pairKey] = { price: adPrice, nickName: ad.nickName, platform: platform };
    }
}

async function processAndSendAlert(ad, platform, asset, fiat, marketPrice) {
    // ... (هذه الدالة تبقى كما هي لإرسال التنبيهات الفورية) ...
}

async function checkP2P(platform, asset, fiat) {
    try {
        let ads = [];
        if (platform === 'Binance') {
            const { data } = await axios.post('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', { page: 1, rows: 10, asset, tradeType: 'SELL', fiat });
            ads = data.data.map(item => ({ price: item.adv.price, createTime: item.adv.createTime, nickName: item.advertiser.nickName, advertiserNo: item.advertiser.userNo }));
        }
        if (ads.length > 0) updateCheapestAdReport(ads[0], platform, asset, fiat);
        return ads;
    } catch (error) { 
        reportData.errors.push(`فشل فحص ${platform} للزوج ${asset}/${fiat}`);
        return []; 
    }
}

async function mainMonitoringLoop() {
    console.log(`\n--- Starting new scan cycle ---`);
    reportData = { cheapestAds: {}, errors: [] };

    const allPrices = await getAllMarketPrices();
    if (!allPrices) {
        console.log("Skipping scan cycle due to price fetch failure.");
        return;
    }

    for (const fiat of CONFIG.FIAT_CURRENCIES) {
        for (const crypto of CONFIG.CRYPTO_ASSETS) {
            const cryptoId = CONFIG.COINGECKO_IDS[crypto];
            const fiatId = fiat.toLowerCase();
            const marketPrice = allPrices[cryptoId]?.[fiatId];

            if (!marketPrice) {
                reportData.errors.push(`لا يوجد سعر لـ ${crypto}/${fiat} في CoinGecko`);
                continue;
            }
            
            const binanceAds = await checkP2P('Binance', crypto, fiat);
            for (const ad of binanceAds) await processAndSendAlert(ad, 'Binance', crypto, fiat, marketPrice);
            
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
}

async function sendStatusReport() {
    const time = moment().tz('Europe/Istanbul').format('HH:mm');
    let reportMessage = `**📊 تقرير الحالة - ${time} بتوقيت تركيا 📊**\n\n`;
    if (Object.keys(reportData.cheapestAds).length > 0) {
        reportMessage += `**✅ أرخص الأسعار:**\n`;
        for (const pair in reportData.cheapestAds) {
            const ad = reportData.cheapestAds[pair];
            reportMessage += `🔸 **${pair}**: ${ad.price} (${ad.platform})\n`;
        }
    } else {
        reportMessage += `ℹ️ لم يتم العثور على أي إعلانات في آخر دورة فحص.\n`;
    }
    if (reportData.errors.length > 0) {
        reportMessage += `\n**⚠️ مشاكل:**\n`;
        const errorsToShow = [...new Set(reportData.errors)];
        errorsToShow.slice(0, 5).forEach(err => {
            reportMessage += `- ${err}\n`;
        });
    }
    await safeSendMessage(reportMessage);
}

setInterval(mainMonitoringLoop, CONFIG.SCAN_INTERVAL);
setInterval(sendStatusReport, CONFIG.REPORT_INTERVAL);
mainMonitoringLoop();
