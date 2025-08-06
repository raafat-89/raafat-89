const express = require('express');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const TelegramBot = require('node-telegram-bot-api');
const moment = require('moment-timezone');
require('dotenv').config();

// الإعدادات الأساسية
const CONFIG = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  SCAN_INTERVAL: 75000, // 75 ثانية
  REQUIRED_DISCOUNT: 3,  // نسبة الخصم المطلوبة
  MAX_AD_AGE: 60,       // الحد الأقصى لعمر الإعلان (ثانية)
  PLATFORMS: ['Binance', 'Bybit', 'KuCoin'],
  ASSETS: {
    crypto: ['USDT', 'BTC', 'ETH'],
    fiat: ['TRY', 'USD', 'EUR']
  }
};

// إعدادات البروكسي (اختياري)
const proxyConfig = {
  host: process.env.PROXY_HOST,
  port: process.env.PROXY_PORT,
  username: process.env.PROXY_USERNAME,
  password: process.env.PROXY_PASSWORD
};

const agent = proxyConfig.host ? 
  new HttpsProxyAgent(`http://${proxyConfig.username}:${proxyConfig.password}@${proxyConfig.host}:${proxyConfig.port}`) : 
  null;

const client = axios.create({
  httpsAgent: agent,
  timeout: 15000
});

// تأكد من وجود متغيرات البيئة الأساسية
if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_CHAT_ID) {
  console.error('❌ يلزم تعيين TELEGRAM_BOT_TOKEN و TELEGRAM_CHAT_ID في ملف .env');
  process.exit(1);
}

const bot = new TelegramBot(CONFIG.TELEGRAM_BOT_TOKEN, { polling: true });
const app = express();
const PORT = process.env.PORT || 3000;

// وظائف مساعدة
async function safeSendMessage(text) {
  try {
    await bot.sendMessage(CONFIG.TELEGRAM_CHAT_ID, text, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('فشل إرسال الرسالة:', error.message);
  }
}

// مسارات API
app.get('/', (req, res) => {
  res.send('🟢 P2P Bot is running');
});

// أوامر البوت
bot.onText(/\/report/, (msg) => {
  if (msg.chat.id.toString() === CONFIG.TELEGRAM_CHAT_ID) {
    safeSendMessage(`📊 حالة البوت:\n- المنصات: ${CONFIG.PLATFORMS.join(', ')}\n- العملات: ${CONFIG.ASSETS.crypto.join(', ')}\n- العملات الورقية: ${CONFIG.ASSETS.fiat.join(', ')}`);
  }
});

// الوظائف الرئيسية
async function checkPlatform(platform, crypto, fiat) {
  try {
    let url, params;
    
    switch (platform) {
      case 'Binance':
        url = 'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search';
        params = { page: 1, rows: 10, asset: crypto, tradeType: 'SELL', fiat };
        break;
        
      case 'Bybit':
        url = 'https://api2.bybit.com/fiat/otc/item/online';
        params = { tokenId: crypto, currencyId: fiat, side: "0", size: "10" };
        break;
        
      case 'KuCoin':
        url = `https://www.kucoin.com/_api/otc/ad/list?currency=${crypto}&side=SELL&legal=${fiat}&page=1&pageSize=10`;
        break;
    }

    const response = platform === 'KuCoin' ? 
      await client.get(url) : 
      await client.post(url, params);

    return response.data?.data || response.data?.result?.items || response.data?.items || [];
    
  } catch (error) {
    console.error(`فشل في ${platform} لـ ${crypto}/${fiat}:`, error.message);
    return [];
  }
}

async function mainLoop() {
  console.log('--- بدء دورة الفحص ---');
  
  try {
    for (const platform of CONFIG.PLATFORMS) {
      for (const crypto of CONFIG.ASSETS.crypto) {
        for (const fiat of CONFIG.ASSETS.fiat) {
          const ads = await checkPlatform(platform, crypto, fiat);
          if (ads.length > 0) {
            console.log(`✅ ${platform}: وجدت ${ads.length} إعلان لـ ${crypto}/${fiat}`);
          }
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
  } catch (error) {
    await safeSendMessage(`❌ خطأ في الدورة الرئيسية: ${error.message}`);
  }
}

// بدء التشغيل
app.listen(PORT, () => {
  console.log(`✅ الخادم يعمل على المنفذ ${PORT}`);
  safeSendMessage('🔔 تم تشغيل البوت بنجاح!');
  
  // تشغيل الدورة الرئيسية فوراً ثم كل 75 ثانية
  mainLoop();
  setInterval(mainLoop, CONFIG.SCAN_INTERVAL);
});
