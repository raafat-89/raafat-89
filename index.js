const express = require('express');
const axios = require('axios');
const axiosRetry = require('axios-retry').default;
const TelegramBot = require('node-telegram-bot-api');
const moment = require('moment-timezone');
require('dotenv').config();
const fs = require('fs');

// --- الإعدادات ---
let CONFIG = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
    SCAN_INTERVAL: 90000,
    REPORT_INTERVAL: 300000,
    REQUIRED_DISCOUNT: 3,
    MAX_AD_AGE_SECONDS: 15,
    CRYPTO_ASSETS: ['USDT', 'BTC', 'ETH'],
    FIAT_CURRENCIES: ['TRY', 'AED', 'USD'],
    COINGECKO_IDS: {
        'USDT': 'tether', 'BTC': 'bitcoin', 'ETH': 'ethereum', 'BNB': 'binancecoin', 
        'SOL': 'solana', 'XRP': 'ripple', 'DOGE': 'dogecoin', 'TRX': 'tron', 
        'ADA': 'cardano', 'SHIB': 'shiba-inu'
    }
};

let reportData = { cheapestAds: {}, errors: [] };

if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_CHAT_ID) {
    console.error("خطأ: متغيرات البيئة غير معرفة");
    process.exit(1);
}
const bot = new TelegramBot(CONFIG.TELEGRAM_BOT_TOKEN, { polling: true });
const app = express();
const PORT = process.env.PORT || 3000;

const client = axios.create();
axiosRetry(client, { retries: 2, retryDelay: () => 1500 });

async function safeSendMessage(message) {
    try {
        await bot.sendMessage(CONFIG.TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' });
    } catch (error) { console.error("Telegram send error:", error.message); }
}

app.get("/", (req, res) => res.send('P2P Bot with Control Panel is alive!'));
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    safeSendMessage(`✅ **النسخة المطورة (مع لوحة التحكم) بدأت العمل!**\nأرسل /status لرؤية الإعدادات.`);
});

// --- قسم الأوامر (لوحة التحكم) ---
bot.onText(/\/status/, (msg) => {
    let statusMessage = `*📊 الإعدادات الحالية:*\n\n`;
    statusMessage += `*نسبة الخصم:* ${CONFIG.REQUIRED_DISCOUNT}%\n`;
    statusMessage += `*العملات الرقمية:* ${CONFIG.CRYPTO_ASSETS.join(', ')}\n`;
    statusMessage += `*العملات الورقية:* ${CONFIG.FIAT_CURRENCIES.join(', ')}`;
    safeSendMessage(statusMessage);
});

bot.onText(/\/set_discount (.+)/, (msg, match) => {
    const newDiscount = parseFloat(match[1]);
    if (!isNaN(newDiscount) && newDiscount > 0) {
        CONFIG.REQUIRED_DISCOUNT = newDiscount;
        safeSendMessage(`✅ تم تغيير نسبة الخصم إلى *${newDiscount}%*`);
    } else {
        safeSendMessage(`❌ صيغة خاطئة. الرجاء استخدام: /set_discount 3`);
    }
});

// ... (يمكن إضافة بقية الأوامر هنا بنفس الطريقة)

// ... (بقية الكود الخاص بالمراقبة والتقارير يبقى كما هو)
// For brevity, I am omitting the rest of the monitoring code, but you should use the last full version we created.
// This is just to show how the new command handling part is added.

// --- FULL CODE TO PASTE ---
async function getAllMarketPrices() {
    try {
        const cryptoIds = CONFIG.CRYPTO_ASSETS.map(c => CONFIG.COINGECKO_IDS[c]).filter(Boolean).join(',');
        const fiatIds = CONFIG.FIAT_CURRENCIES.map(f => f.toLowerCase()).join(',');
        const response = await client.get(`https://api.coingecko.com/api/v3/simple/price?ids=${cryptoIds}&vs_currencies=${fiatIds}`);
        return response.data;
    } catch (error) {
        reportData.errors.push("فشل الاتصال بـ CoinGecko");
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
    const price = parseFloat(ad.price);
    if (!price || !marketPrice) return;
    const createTime = new Date(ad.createTime).getTime();
    const ageInSeconds = (Date.now() - createTime) / 1000;
    if (ageInSeconds > CONFIG.MAX_AD_AGE_SECONDS) return;
    const discount = ((marketPrice - price) / marketPrice) * 100;
    if (discount >= CONFIG.REQUIRED_DISCOUNT) {
        const timeInTurkey = moment(createTime).tz('Europe/Istanbul').format('YYYY-MM-DD HH:mm:ss');
        let adLink = `https://p2p.binance.com/en/advertiserDetail?advertiserNo=${ad.advertiserNo}`;
        const message = `🔔 **فرصة جديدة على ${platform}** 🔔\nالتاجر **${ad.nickName}** يعرض **${asset}** مقابل **${fiat}**.\nخصم: **${discount.toFixed(2)}%**!\n- **وقت الإعلان (تركيا):** ${timeInTurkey}\n- **رابط مباشر:** [اضغط هنا](${adLink})`;
        await safeSendMessage(message);
    }
}

async function checkP2P(platform, asset, fiat) {
    try {
        let ads = [];
        if (platform === 'Binance') {
            const { data } = await client.post('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', { page: 1, rows: 5, asset, tradeType: 'SELL', fiat });
            ads = (data.data || []).map(item => ({ price: item.adv.price, createTime: item.adv.createTime, nickName: item.advertiser.nickName, advertiserNo: item.advertiser.userNo }));
        }
        if (ads.length > 0) updateCheapestAdReport(ads[0], platform, asset, fiat);
        return ads;
    } catch (error) { 
        reportData.errors.push(`فشل فحص ${platform} لـ ${asset}/${fiat}`);
        return []; 
    }
}

async function mainMonitoringLoop() {
    try {
        console.log(`\n--- Starting new scan cycle ---`);
        reportData = { cheapestAds: {}, errors: [] };
        const allPrices = await getAllMarketPrices();
        if (!allPrices) { await sendStatusReport(); return; }
        reportData.marketPrices = allPrices;
        for (const fiat of CONFIG.FIAT_CURRENCIES) {
            for (const crypto of CONFIG.CRYPTO_ASSETS) {
                const cryptoId = CONFIG.COINGECKO_IDS[crypto];
                const fiatId = fiat.toLowerCase();
                const marketPrice = allPrices[cryptoId]?.[fiatId];
                if (!marketPrice) continue;
                const binanceAds = await checkP2P('Binance', crypto, fiat);
                for (const ad of binanceAds) await processAndSendAlert(ad, 'Binance', crypto, fiat, marketPrice);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    } catch (error) {
        console.error("!!! CRITICAL ERROR IN MAIN LOOP !!!", error);
        await safeSendMessage(`❌ **خطأ فادح أوقف البوت!** ❌\n\`${error.message}\``);
    }
}

async function sendStatusReport() {
    const time = moment().tz('Europe/Istanbul').format('HH:mm');
    let reportMessage = `**📊 تقرير الحالة - ${time} بتوقيت تركيا 📊**\n\n`;
    if (Object.keys(reportData.cheapestAds).length > 0) {
        reportMessage += `**✅ أرخص الأسعار:**\n`;
        for (const pair in reportData.cheapestAds) {
            const ad = reportData.cheapestAds[pair];
            const [asset, fiat] = pair.split('/');
            const marketPrice = reportData.marketPrices[CONFIG.COINGECKO_IDS[asset]]?.[fiat.toLowerCase()];
            const marketPriceStr = marketPrice ? `| سعر السوق: ${marketPrice.toFixed(2)}` : '';
            reportMessage += `🔸 **${pair}**: ${ad.price} (${ad.platform}) ${marketPriceStr}\n`;
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
