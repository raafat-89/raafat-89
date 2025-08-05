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
    SCAN_INTERVAL: 300000, // دورة الفحص الكاملة كل 5 دقائق
    REPORT_INTERVAL: 300000, // إرسال تقرير كل 5 دقائق (متزامن مع الفحص)
    REQUIRED_DISCOUNT: 5,
    MAX_AD_AGE_SECONDS: 20, // زيادة طفيفة لعمر الإعلان
    CRYPTO_ASSETS: ['USDT', 'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE', 'TRX', 'ADA', 'SHIB'],
    FIAT_CURRENCIES: ['TRY', 'AED', 'USD', 'EUR', 'SAR', 'QAR', 'KWD', 'OMR', 'BHD', 'JOD'],
    COINGECKO_IDS: {
        'USDT': 'tether', 'BTC': 'bitcoin', 'ETH': 'ethereum', 'BNB': 'binancecoin', 
        'SOL': 'solana', 'XRP': 'ripple', 'DOGE': 'dogecoin', 'TRX': 'tron', 
        'ADA': 'cardano', 'SHIB': 'shiba-inu'
    }
};

let reportData = { cheapestAds: {}, marketPrices: {}, errors: [] };

if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_CHAT_ID) {
    console.error("خطأ: متغيرات البيئة غير معرفة");
    process.exit(1);
}
const bot = new TelegramBot(CONFIG.TELEGRAM_BOT_TOKEN);
const app = express();
const PORT = process.env.PORT || 3000;

const client = axios.create();
axiosRetry(client, { retries: 2, retryDelay: () => 1500 });

async function safeSendMessage(message) {
    try {
        await bot.sendMessage(CONFIG.TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error("Telegram send error:", error.message);
    }
}

app.get("/", (req, res) => res.send('P2P Professional Bot v3.0 is alive!'));
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    safeSendMessage('✅ **النسخة الاحترافية v3.0 بدأت العمل!**');
});

async function getAllMarketPrices() {
    try {
        const cryptoIds = Object.values(CONFIG.COINGECKO_IDS).join(',');
        const fiatIds = CONFIG.FIAT_CURRENCIES.map(f => f.toLowerCase()).join(',');
        const response = await client.get(`https://api.coingecko.com/api/v3/simple/price?ids=${cryptoIds}&vs_currencies=${fiatIds}`);
        return response.data;
    } catch (error) {
        reportData.errors.push("فشل الاتصال بمصدر الأسعار CoinGecko");
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
    // ... (This function remains the same) ...
}

async function checkP2P(platform, asset, fiat) {
    try {
        let ads = [];
        // ... (This function remains the same) ...
        if (ads.length > 0) {
            updateCheapestAdReport(ads[0], platform, asset, fiat);
        }
        return ads;
    } catch (error) { 
        reportData.errors.push(`فشل فحص ${platform} لـ ${asset}/${fiat}`);
        return []; 
    }
}

async function mainMonitoringLoop() {
    try {
        const time = moment().tz('Europe/Istanbul').format('HH:mm');
        console.log(`\n--- [${time}] Starting new scan cycle ---`);
        reportData = { cheapestAds: {}, marketPrices: {}, errors: [] };
        
        await safeSendMessage(`*⏳ [${time}] بدء دورة فحص جديدة...*`);

        const allPrices = await getAllMarketPrices();
        if (!allPrices) {
            await sendStatusReport(); // إرسال تقرير فوراً لإظهار خطأ الأسعار
            return;
        }
        reportData.marketPrices = allPrices; // تخزين الأسعار لاستخدامها في التقرير

        for (const fiat of CONFIG.FIAT_CURRENCIES) {
            console.log(`-- Scanning for ${fiat} --`);
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
                
                await new Promise(resolve => setTimeout(resolve, 500)); // فاصل بسيط
            }
            await safeSendMessage(`*✅ تم الانتهاء من فحص عملة ${fiat}*`);
        }
        
        await sendStatusReport(); // إرسال التقرير الكامل في نهاية الدورة

    } catch (error) {
        console.error("!!! CRITICAL ERROR IN MAIN LOOP !!!", error);
        await safeSendMessage(`❌ **خطأ فادح أوقف البوت!** ❌\n\`${error.message}\``);
    }
}

async function sendStatusReport() {
    const time = moment().tz('Europe/Istanbul').format('HH:mm');
    let reportMessage = `**📊 تقرير الحالة - ${time} بتوقيت تركيا 📊**\n\n`;

    if (Object.keys(reportData.cheapestAds).length > 0) {
        reportMessage += `**✅ أرخص أسعار P2P التي تم العثور عليها:**\n`;
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
        reportMessage += `\n**⚠️ مشاكل واجهتني:**\n`;
        const errorsToShow = [...new Set(reportData.errors)];
        errorsToShow.slice(0, 5).forEach(err => {
            reportMessage += `- ${err}\n`;
        });
    }
    
    await safeSendMessage(reportMessage);
}

// بدء حلقة المراقبة (لا يوجد تقرير منفصل، التقرير جزء من دورة الفحص)
setInterval(mainMonitoringLoop, CONFIG.SCAN_INTERVAL);
mainMonitoringLoop();
