const express = require('express');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const TelegramBot = require('node-telegram-bot-api');
const moment = require('moment-timezone');
require('dotenv').config();

// --- الإعدادات الرئيسية ---
const CONFIG = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
    SCAN_INTERVAL: 150000, // دورة الفحص الكاملة كل 2.5 دقيقة (لضمان الاستقرار)
    REPORT_INTERVAL: 300000, // تقرير كل 5 دقائق
    REQUIRED_DISCOUNT: 3,
    MAX_AD_AGE_SECONDS: 60,
    CRYPTO_ASSETS: ['USDT', 'BTC', 'ETH', 'BNB', 'SOL'],
    FIAT_CURRENCIES: ['TRY', 'AED', 'USD', 'EUR', 'SAR'],
    COINGECKO_IDS: {
        'USDT': 'tether', 'BTC': 'bitcoin', 'ETH': 'ethereum', 'BNB': 'binancecoin', 'SOL': 'solana'
    }
};

const proxyConfig = {
    host: process.env.PROXY_HOST,
    port: process.env.PROXY_PORT,
    username: process.env.PROXY_USERNAME,
    password: process.env.PROXY_PASSWORD
};

const agent = (proxyConfig.host) ? new HttpsProxyAgent(`http://${proxyConfig.username}:${proxyConfig.password}@${proxyConfig.host}:${proxyConfig.port}`) : null;
const client = axios.create({ httpsAgent: agent, httpAgent: agent, timeout: 10000 });
let reportData = { cheapestAds: {}, errors: [], marketPrices: {} };

if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_CHAT_ID) { process.exit(1); }
const bot = new TelegramBot(CONFIG.TELEGRAM_BOT_TOKEN, { polling: true });
const app = express();
const PORT = process.env.PORT || 3000;

async function safeSendMessage(message) { try { await bot.sendMessage(CONFIG.TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' }); } catch (error) { console.error(error.message); } }

app.get("/", (req, res) => res.send('P2P Stable Bot v5.1 is alive!'));
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    safeSendMessage(`✅ **النسخة 5.1 المستقرة بدأت العمل!**`);
});

bot.onText(/\/report/, (msg) => {
    if (msg.chat.id.toString() === CONFIG.TELEGRAM_CHAT_ID) {
        sendStatusReport();
    }
});

async function getAllMarketPrices() {
    try {
        const cryptoIds = Object.values(CONFIG.COINGECKO_IDS).join(',');
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
    const createTime = new Date(parseInt(ad.createTime)).getTime();
    const ageInSeconds = (Date.now() - createTime) / 1000;
    if (isNaN(ageInSeconds) || ageInSeconds < 0 || ageInSeconds > CONFIG.MAX_AD_AGE_SECONDS) return;
    const discount = ((marketPrice - price) / marketPrice) * 100;
    if (discount >= CONFIG.REQUIRED_DISCOUNT) {
        const timeInTurkey = moment(createTime).tz('Europe/Istanbul').format('YYYY-MM-DD HH:mm:ss');
        let adLink = `https://p2p.binance.com/en/trade/${fiat}/${asset}`;
        if (platform === 'Binance' && ad.advertiserNo) adLink = `https://p2p.binance.com/en/advertiserDetail?advertiserNo=${ad.advertiserNo}`;
        if (platform === 'Bybit') adLink = `https://www.bybit.com/fiat/trade/otc/?actionType=1&token=${asset}&fiat=${fiat}`;
        if (platform === 'KuCoin') adLink = `https://www.kucoin.com/otc/buy/${asset}-${fiat}`;
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
        reportData = { cheapestAds: {}, errors: [], marketPrices: {} };
        const allPrices = await getAllMarketPrices();
        if (!allPrices) return;
        reportData.marketPrices = allPrices;
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
                    await new Promise(resolve => setTimeout(resolve, 500)); // فاصل بسيط بين المنصات
                }
            }
        }
    } catch (error) {
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
        reportMessage += `ℹ️ لم يتم العثور على أي إعلانات.\n`;
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
