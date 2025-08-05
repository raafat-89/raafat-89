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
    SCAN_INTERVAL: 120000, // دورة الفحص الكاملة كل دقيقتين
    REPORT_INTERVAL: 300000, // إرسال تقرير كل 5 دقائق
    REQUIRED_DISCOUNT: 5,
    MAX_AD_AGE_SECONDS: 15,
    // --- قائمة المراقبة الموسعة (10x10) ---
    CRYPTO_ASSETS: ['USDT', 'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE', 'TRX', 'ADA', 'SHIB'],
    FIAT_CURRENCIES: ['TRY', 'AED', 'USD', 'EUR', 'SAR', 'QAR', 'KWD', 'OMR', 'BHD', 'JOD'],
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
const bot = new TelegramBot(CONFIG.TELEGRAM_BOT_TOKEN);
const app = express();
const PORT = process.env.PORT || 3000;

const client = axios.create();
axiosRetry(client, { retries: 3, retryDelay: () => 2000, retryCondition: () => true });

async function safeSendMessage(message) {
    try {
        await bot.sendMessage(CONFIG.TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error("Telegram send error:", error.message);
    }
}

app.get("/", (req, res) => res.send('Expanded P2P Bot is alive!'));
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    safeSendMessage('✅ **النسخة الموسعة (10x10) بدأت العمل!** أراقب الآن 3 منصات.');
});

async function getAllMarketPrices() {
    try {
        const cryptoIds = Object.values(CONFIG.COINGECKO_IDS).join(',');
        const fiatIds = CONFIG.FIAT_CURRENCIES.map(f => f.toLowerCase()).join(',');
        const response = await client.get(`https://api.coingecko.com/api/v3/simple/price?ids=${cryptoIds}&vs_currencies=${fiatIds}`);
        return response.data;
    } catch (error) {
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
        } else if (platform === 'Bybit') {
            const { data } = await client.post('https://api2.bybit.com/fiat/otc/item/online', { tokenId: asset, currencyId: fiat, side: "0", size: "5", page: "1" });
            ads = (data.result.items || []).map(item => ({ price: item.price, createTime: item.lastUpdateTime, nickName: item.nickName, advertiserNo: item.userId }));
        } else if (platform === 'KuCoin') {
            const { data } = await client.get(`https://www.kucoin.com/_api/otc/ad/list?currency=${asset}&side=SELL&legal=${fiat}&page=1&pageSize=5`);
            ads = (data.items || []).map(item => ({ price: item.floatPrice, createTime: item.createdAt, nickName: item.nickName, advertiserNo: null }));
        }
        
        if (ads.length > 0) {
            updateCheapestAdReport(ads[0], platform, asset, fiat);
        }
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
        const allPrices = await getAllMarketPrices();
        if (!allPrices) return;

        for (const fiat of CONFIG.FIAT_CURRENCIES) {
            for (const crypto of CONFIG.CRYPTO_ASSETS) {
                const cryptoId = CONFIG.COINGECKO_IDS[crypto];
                const fiatId = fiat.toLowerCase();
                const marketPrice = allPrices[cryptoId]?.[fiatId];
                if (!marketPrice) continue;
                
                const platforms = ['Binance', 'Bybit', 'KuCoin'];
                for (const platform of platforms) {
                    const ads = await checkP2P(platform, crypto, fiat);
                    for (const ad of ads) await processAndSendAlert(ad, platform, crypto, fiat, marketPrice);
                }
                
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
        reportMessage += `**✅ أرخص الأسعار التي تم العثور عليها:**\n`;
        for (const pair in reportData.cheapestAds) {
            const ad = reportData.cheapestAds[pair];
            reportMessage += `🔸 **${pair}**: ${ad.price} (${ad.platform})\n`;
        }
    } else {
        reportMessage += `ℹ️ لم يتم العثور على أي إعلانات في آخر دورة فحص.\n`;
    }
    if (reportData.errors.length > 0) {
        reportMessage += `\n**⚠️ مشاكل واجهتني:**\n`;
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
