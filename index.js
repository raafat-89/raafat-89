// index.js
const express = require('express');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const CONFIG = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
    SCAN_INTERVAL: 15000, // الفحص كل 4 ثواني
    REQUIRED_DISCOUNT: 19, // نسبة الخصم المطلوبة
    MAX_AD_AGE_SECONDS: 15, // تجاهل الإعلانات الأقدم من 15 ثانية
    ASSET: 'USDT',
    FIAT: 'USD'
};

if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_CHAT_ID) {
    console.error("خطأ: الرجاء التأكد من تعريف متغيرات البيئة");
    process.exit(1);
}

const bot = new TelegramBot(CONFIG.TELEGRAM_BOT_TOKEN);
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => res.send('P2P Bot is alive!'));
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    bot.sendMessage(CONFIG.TELEGRAM_CHAT_ID, '✅ البوت بدأ العمل الآن وسيبدأ في مراقبة الأسواق.').catch(err => console.error("Telegram startup message failed:", err.message));
});

async function getMarketPrice(symbol = 'tether') {
    try {
        const response = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${symbol}&vs_currencies=usd`);
        return response.data[symbol]?.usd;
    } catch (error) {
        console.error("خطأ في جلب سعر السوق:", error.message);
        return null;
    }
}

async function processAndSendAlert(ad, platform, marketPrice) {
    const price = parseFloat(ad.price);
    const createTime = new Date(ad.createTime).getTime();
    const ageInSeconds = (Date.now() - createTime) / 1000;

    if (ageInSeconds > CONFIG.MAX_AD_AGE_SECONDS) return;

    const discount = ((marketPrice - price) / marketPrice) * 100;

    if (discount >= CONFIG.REQUIRED_DISCOUNT) {
        const message = `
🔔 **فرصة جديدة على منصة ${platform}** 🔔

- **السعر:** ${price.toFixed(4)} ${CONFIG.FIAT}
- **الخصم:** **${discount.toFixed(2)}%**
- **الكمية:** ${parseFloat(ad.surplusAmount).toFixed(2)} ${CONFIG.ASSET}
- **التاجر:** ${ad.nickName}
        `;
        try {
            await bot.sendMessage(CONFIG.TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' });
            console.log(`📤 تم إرسال تنبيه من ${platform} بخصم ${discount.toFixed(2)}%`);
        } catch (error) {
            console.error("خطأ في إرسال رسالة تليغرام:", error.message);
        }
    }
}

async function checkBinanceP2P() {
    try {
        const { data } = await axios.post('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', { page: 1, rows: 20, asset: CONFIG.ASSET, tradeType: 'SELL', fiat: CONFIG.FIAT });
        return data.data.map(item => ({ price: item.adv.price, createTime: item.adv.createTime, surplusAmount: item.adv.surplusAmount, nickName: item.advertiser.nickName }));
    } catch (error) { console.error("Binance Error:", error.message); return []; }
}

async function checkBybitP2P() {
    try {
        const { data } = await axios.post('https://api2.bybit.com/fiat/otc/item/online', { tokenId: CONFIG.ASSET, currencyId: CONFIG.FIAT, side: "0", size: "20", page: "1" });
        return data.result.items.map(item => ({ price: item.price, createTime: item.lastUpdateTime, surplusAmount: item.lastQuantity, nickName: item.nickName }));
    } catch (error) { console.error("Bybit Error:", error.message); return []; }
}

async function checkKuCoinP2P() {
    try {
        const { data } = await axios.get(`https://www.kucoin.com/_api/otc/ad/list?currency=${CONFIG.ASSET}&side=SELL&legal=${CONFIG.FIAT}&page=1&pageSize=20`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        return data.items.map(item => ({ price: item.floatPrice, createTime: item.createdAt, surplusAmount: item.currencyBalanceQuantity, nickName: item.nickName }));
    } catch (error) { console.error("KuCoin Error:", error.message); return []; }
}

async function mainMonitoringLoop() {
    const marketPrice = await getMarketPrice();
    if (!marketPrice) return;
    
    const checks = [
        { name: 'Binance', func: checkBinanceP2P },
        { name: 'Bybit', func: checkBybitP2P },
        { name: 'KuCoin', func: checkKuCoinP2P }
    ];

    for (const check of checks) {
        const ads = await check.func();
        for (const ad of ads) {
            await processAndSendAlert(ad, check.name, marketPrice);
        }
    }
}

setInterval(mainMonitoringLoop, CONFIG.SCAN_INTERVAL);
mainMonitoringLoop();
