// 1. إضافة التوثيق في بداية الملف
/**
 * @file P2P Golden Bot v6.0
 * @description بوت مراقبة صفقات P2P مع تنبيهات فورية
 * @author raafat-89
 * @version 6.0.1
 */

// 2. تحسين الإعدادات
const CONFIG = {
  TELEGRAM: {
    TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    CHAT_ID: process.env.TELEGRAM_CHAT_ID,
    REPORT_COMMAND: '/report'
  },
  SCANNING: {
    INTERVAL_MS: 75000,
    REQUEST_DELAY: 500,
    MAX_CONCURRENT_REQUESTS: 3
  },
  TRADING: {
    REQUIRED_DISCOUNT: 3,
    MAX_AD_AGE_SECONDS: 60,
    PLATFORMS: ['Binance', 'Bybit', 'KuCoin']
  },
  ASSETS: {
    CRYPTO: ['USDT', 'BTC', 'ETH', 'BNB', 'SOL'],
    FIAT: ['TRY', 'AED', 'USD', 'EUR', 'SAR'],
    COINGECKO_MAPPING: {
      USDT: 'tether',
      BTC: 'bitcoin',
      ETH: 'ethereum',
      BNB: 'binancecoin',
      SOL: 'solana'
    }
  }
};

// 3. تحسين معالجة الأخطاء
class BotError extends Error {
  constructor(message, context = {}) {
    super(message);
    this.context = context;
    this.timestamp = new Date();
  }
}

// 4. تحسين نظام التسجيل (Logging)
const logger = {
  info: (msg) => console.log(`[INFO] ${new Date().toISOString()} - ${msg}`),
  error: (msg, err) => console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`, err)
};

// 5. تحسين وظيفة الفحص الرئيسية
async function scanPlatform(platform, crypto, fiat) {
  try {
    logger.info(`Checking ${platform} for ${crypto}/${fiat}`);
    const ads = await checkP2P(platform, crypto, fiat);
    
    if (ads.length > 0) {
      updateCheapestAdReport(ads[0], platform, crypto, fiat);
      await processAds(ads, platform, crypto, fiat);
    }
    
    return ads.length;
  } catch (error) {
    throw new BotError(`Failed to scan ${platform}`, { crypto, fiat, error });
  }
}
