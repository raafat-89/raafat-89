const express = require('express');
const axios =require('axios');
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
    CRYPTO_ASSETS: ['USDT', 'BTC', 'BNB', 'ETH', 'DOGE', 'SHIB'],
    FIAT_CURRENCIES: ['TRY', 'AED', 'IDR', 'KZT', 'AZN'],
    COINGECKO_IDS: {
        'USDT': 'tether', 'BTC': 'bitcoin', 'BNB': 'binancecoin', 'ETH': 'ethereum', 'DOGE': 'dogecoin', 'SHIB': 'shiba-inu'
    }
};

// --- ذاكرة مؤقتة للتقارير والأخطاء ---
let reportData = {
    cheapestAds: {},
    errors: []
};

// --- تهيئة التطبيق والبوت ---
if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_CHAT_ID) {
    console.error("خطأ: متغيرات البيئة غير معرفة");
    process.exit(1);
}
const bot = new TelegramBot(CONFIG.TELEGRAM_BOT_TOKEN);
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => res.send('P2P Bot with Smart Reports is alive!'));
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    bot.sendMessage(CONFIG.TELEGRAM_CHAT_ID, '✅ **النسخة النهائية (مع التقارير الذكية) بدأت العمل!**').catch(err => console.error(err.message));
});

// --- الدوال المساعدة ---
async function getMarketPrice(asset, fiat) {
    try {
        const cryptoId = CONFIG.COINGECKO_IDS[asset];
        const fiatId = fiat.toLowerCase();
        const response = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${cryptoId}&vs_currencies=${fiatId}`);
        const price = response.data[cryptoId]?.[fiatId];
        if (price) return price;
        reportData.errors.push(`فشل جلب سعر السوق لـ ${asset}/${fiat}`);
        return null;
    } catch (error) {
        reportData.errors.push(`فشل جلب سعر السوق لـ ${asset}/${fiat}`);
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

// --- دوال فحص المنصات ---
async function checkP2P(platform, asset, fiat) {
    try {
        let ads = [];
        if (platform === 'Binance') {
            const { data } = await axios.post('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', { page: 1, rows: 10, asset, tradeType: 'SELL', fiat });
            ads = data.data.map(item => ({ price: item.adv.price, createTime: item.adv.createTime, nickName: item.advertiser.nickName, advertiserNo: item.advertiser.userNo }));
        }
        // يمكن إضافة Bybit و KuCoin هنا
        
        if (ads.length > 0) {
            updateCheapestAdReport(ads[0], platform, asset, fiat);
        }
        return ads;
    } catch (error) { 
        reportData.errors.push(`فشل فحص ${platform} للزوج ${asset}/${fiat}`);
        return []; 
    }
}

// --- حلقة المراقبة الرئيسية ---
async function mainMonitoringLoop() {
    console.log(`\n--- Starting new scan cycle ---`);
    // تفريغ بيانات الدورة السابقة
    reportData = { cheapestAds: {}, errors: [] };

    for (const fiat of CONFIG.FIAT_CURRENCIES) {
        for (const crypto of CONFIG.CRYPTO_ASSETS) {
            const marketPrice = await getMarketPrice(crypto, fiat);
            if (!marketPrice) {
                 await new Promise(resolve => setTimeout(resolve, 2000));
                 continue;
            }
            
            const binanceAds = await checkP2P('Binance', crypto, fiat);
            for (const ad of binanceAds) await processAndSendAlert(ad, 'Binance', crypto, fiat, marketPrice);
            
            // يمكن استدعاء فحص Bybit و KuCoin هنا
            
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
     console.log(`--- Scan cycle finished ---`);
}

// --- دالة إرسال التقرير الدوري ---
async function sendStatusReport() {
    const time = moment().tz('Europe/Istanbul').format('HH:mm');
    let reportMessage = `**📊 تقرير الحالة - ${time} بتوقيت تركيا 📊**\n\n`;

    // قسم الأسعار الناجحة
    if (Object.keys(reportData.cheapestAds).length > 0) {
        reportMessage += `**✅ أرخص الأسعار التي تم العثور عليها:**\n`;
        for (const pair in reportData.cheapestAds) {
            const ad = reportData.cheapestAds[pair];
            reportMessage += `🔸 **${pair}**: ${ad.price} (${ad.platform})\n`;
        }
    } else {
        reportMessage += `ℹ️ لم يتم العثور على أي إعلانات في آخر دورة فحص.\n`;
    }

    // قسم الأخطاء
    if (reportData.errors.length > 0) {
        reportMessage += `\n**⚠️ مشاكل واجهتني في آخر دورة فحص:**\n`;
        // عرض أول 5 أخطاء فقط لتجنب الرسائل الطويلة جداً
        const errorsToShow = reportData.errors.slice(0, 5);
        errorsToShow.forEach(err => {
            reportMessage += `- ${err}\n`;
        });
    }

    try {
        await bot.sendMessage(CONFIG.TELEGRAM_CHAT_ID, reportMessage, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error("Failed to send status report:", error.message);
    }
}

// بدء حلقة المراقبة وحلقة التقارير
setInterval(mainMonitoringLoop, CONFIG.SCAN_INTERVAL);
setInterval(sendStatusReport, CONFIG.REPORT_INTERVAL);
mainMonitoringLoop();
