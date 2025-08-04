const express = require('express');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("Error: Environment variables are not set.");
    process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => res.send('Diagnostic Bot is running.'));
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    bot.sendMessage(TELEGRAM_CHAT_ID, '✅ **بوت التشخيص بدأ العمل.** سأحاول الآن الاتصال بباينانس.').catch(err => console.error(err.message));
});

async function runTest() {
    console.log("Attempting to fetch data from Binance P2P for USDT/TRY...");
    try {
        const response = await axios.post(
            'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search',
            {
                page: 1,
                rows: 5,
                payTypes: [],
                asset: 'USDT',
                tradeType: 'SELL',
                fiat: 'TRY'
            },
            {
                headers: { 'Content-Type': 'application/json' }
            }
        );

        const ads = response.data.data;
        if (ads && ads.length > 0) {
            console.log(`Success! Found ${ads.length} ads.`);
            const firstAdPrice = ads[0].adv.price;
            const message = `🎉 **نجح الاختبار!** 🎉\n\nتمكنت من الاتصال بباينانس وجلب الإعلانات بنجاح.\n\nعدد الإعلانات التي وجدتها لـ USDT/TRY هو: ${ads.length}\nسعر أول إعلان هو: ${firstAdPrice} TRY`;
            await bot.sendMessage(TELEGRAM_CHAT_ID, message);
        } else {
            console.log("Request was successful, but no ads were found.");
            await bot.sendMessage(TELEGRAM_CHAT_ID, '⚠️ **تنبيه:** تم الاتصال بباينانس بنجاح، لكن لم أجد أي إعلانات لـ USDT/TRY في الوقت الحالي.');
        }

    } catch (error) {
        console.error("Test failed. Error fetching data:", error.message);
        await bot.sendMessage(TELEGRAM_CHAT_ID, `❌ **فشل الاختبار!** ❌\n\nلم أتمكن من جلب البيانات من باينانس. الخطأ هو:\n\`${error.message}\``, { parse_mode: 'Markdown' });
    }
}

// تشغيل الاختبار مرة واحدة بعد 10 ثواني من بدء التشغيل
setTimeout(runTest, 10000);
