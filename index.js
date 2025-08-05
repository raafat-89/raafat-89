const express = require('express');
const axios = require('axios');
const axiosRetry = require('axios-retry').default;
const TelegramBot = require('node-telegram-bot-api');
const moment = require('moment-timezone');
require('dotenv').config();

// --- الإعدادات الرئيسية ---
const CONFIG = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
    SCAN_INTERVAL: 90000, // دورة الفحص الكاملة كل 90 ثانية
    REPORT_INTERVAL: 300000, // إرسال تقرير كل 5 دقائق
    REQUIRED_DISCOUNT: 5,
    MAX_AD_AGE_SECONDS: 15,
    CRYPTO_ASSETS: ['USDT', 'BTC', 'ETH'], // قائمة المراقبة المركزة
    FIAT_CURRENCIES: ['TRY', 'AED', 'USD'], // قائمة المراقبة المركزة
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

// إعداد axios مع ميزة إعادة المحاولة
const client = axios.create();
axiosRetry(client, {
    retries: 3,
    retryDelay: (retryCount) => {
        console.log(`Request failed, attempt #${retryCount}. Retrying in 2 seconds...`);
        return 2000;
    },
    retryCondition: () => true,
});

async function safeSendMessage(message) {
    try {
        await bot.sendMessage(CONFIG.TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error("Telegram send error:", error.message);
    }
}

app.get("/", (req, res) => res.send('P2P Focused Bot is alive!'));
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    safeSendMessage('✅ **النسخة النهائية والمستقرة بدأت العمل!** (قائمة مركزة)');
});

async function getSpotPrice(asset, fiat) {
    const sources = [
        { name: 'Binance', url: `https://api.binance.com/api/v3/ticker/price?symbol=${asset}${fiat}`, path: 'price' },
        { name: 'KuCoin', url: `https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${asset}-${fiat}`, path: 'data.price' }
    ];

    for (const source of sources) {
        try {
            const response = await client.get(source.url);
            const price = source.path.split('.').reduce((o, i) => o && o[i], response.data);
            if (price) {
                console.log(`Price source for ${asset}/${fiat}: ${source.name}`);
                return parseFloat(price);
            }
        } catch (e) {
            console.log(`${source.name} failed for ${asset}/${fiat}.`);
        }
    }
    
    reportData.errors.push(`فشل جلب سعر السوق لـ ${asset}/${fiat}`);
    return null;
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
        console.log(`📤 Alert sent for ${asset}/${fiat} from ${platform}`);
    }
}

async function checkP2P(platform, asset, fiat) {
    try {
        let ads = [];
        if (platform === 'Binance') {
            const { data } = await axios.post('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', { page: 1, rows: 10, asset, tradeType: 'SELL', fiat });
            ads = data.data.map(item => ({ price: item.adv.price, createTime: item.adv.createTime, nickName: item.advertiser.nickName, advertiserNo: item.advertiser.userNo }));
        }
        // يمكن إضافة Bybit و KuCoin هنا
        if (ads.length > 0) updateCheapestAdReport(ads[0], platform, asset, fiat);
        return ads;
    } catch (error) { 
        reportData.errors.push(`فشل فحص ${platform} للزوج ${asset}/${fiat}`);
        return []; 
    }
}

async function mainMonitoringLoop() {
    try {
        console.log(`\n--- Starting new scan cycle ---`);
        reportData = { cheapestAds: {}, errors: [] };
        for (const fiat of CONFIG.FIAT_CURRENCIES) {
            for (const crypto of CONFIG.CRYPTO_ASSETS) {
                const marketPrice = await getSpotPrice(crypto, fiat);
                if (!marketPrice) {
                     await new Promise(resolve => setTimeout(resolve, 1000));
                     continue;
                }
                const binanceAds = await checkP2P('Binance', crypto, fiat);
                for (const ad of binanceAds) await processAndSendAlert(ad, 'Binance', crypto, fiat, marketPrice);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    } catch (error) {
        console.error("!!! CRITICAL ERROR IN MAIN LOOP !!!", error);
        await safeSendMessage(`❌ **خطأ فادح أوقف البوت!** ❌\n\nالخطأ:\n\`${error.message}\`\n\nسأحاول إعادة التشغيل.`);
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
        reportMessage += `ℹ️ لم يتم العثور على إعلانات.\n`;
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

// بدء الحلقات
setInterval(mainMonitoringLoop, CONFIG.SCAN_INTERVAL);
setInterval(sendStatusReport, CONFIG.REPORT_INTERVAL);
mainMonitoringLoop();
