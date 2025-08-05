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
    CRYPTO_ASSETS: ['USDT', 'BTC', 'BNB', 'ETH', 'DOGE', 'SHIB'],
    FIAT_CURRENCIES: ['TRY', 'AED', 'IDR', 'KZT', 'AZN'],
    COINGECKO_IDS: {
        'USDT': 'tether', 'BTC': 'bitcoin', 'BNB': 'binancecoin', 'ETH': 'ethereum', 'DOGE': 'dogecoin', 'SHIB': 'shiba-inu'
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

app.get("/", (req, res) => res.send('Smart P2P Bot (Waterfall Price) is alive!'));
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    bot.sendMessage(CONFIG.TELEGRAM_CHAT_ID, '✅ **النسخة الذكية (بمصادر أسعار متعددة) بدأت العمل!**').catch(err => console.error(err.message));
});

async function getSpotPrice(asset, fiat) {
    const fiatLower = fiat.toLowerCase();
    
    // 1. Binance
    try {
        const response = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${asset}${fiat}`);
        if (response.data.price) {
            console.log(`Price source for ${asset}/${fiat}: Binance`);
            return parseFloat(response.data.price);
        }
    } catch (e) {}

    // 2. KuCoin
    try {
        const response = await axios.get(`https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${asset}-${fiat}`);
        if (response.data.data.price) {
            console.log(`Price source for ${asset}/${fiat}: KuCoin`);
            return parseFloat(response.data.data.price);
        }
    } catch (e) {}

    // 3. Bybit
    try {
        const response = await axios.get(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${asset}${fiat}`);
        if (response.data.result.list[0].lastPrice) {
            console.log(`Price source for ${asset}/${fiat}: Bybit`);
            return parseFloat(response.data.result.list[0].lastPrice);
        }
    } catch (e) {}
    
    // 4. CoinGecko
    try {
        const cryptoId = CONFIG.COINGECKO_IDS[asset];
        const response = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${cryptoId}&vs_currencies=${fiatLower}`);
        const price = response.data[cryptoId]?.[fiatLower];
        if (price) {
            console.log(`Price source for ${asset}/${fiat}: CoinGecko`);
            return price;
        }
    } catch(e) {}
    
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
    // ... (This function remains the same as the last full version) ...
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
    for (const fiat of CONFIG.FIAT_CURRENCIES) {
        for (const crypto of CONFIG.CRYPTO_ASSETS) {
            const marketPrice = await getSpotPrice(crypto, fiat);
            if (!marketPrice) {
                 await new Promise(resolve => setTimeout(resolve, 2000));
                 continue;
            }
            const binanceAds = await checkP2P('Binance', crypto, fiat);
            for (const ad of binanceAds) await processAndSendAlert(ad, 'Binance', crypto, fiat, marketPrice);
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
}

async function sendStatusReport() {
    // ... (This function remains the same as the last full version) ...
}

setInterval(mainMonitoringLoop, CONFIG.SCAN_INTERVAL);
setInterval(sendStatusReport, CONFIG.REPORT_INTERVAL);
mainMonitoringLoop();
