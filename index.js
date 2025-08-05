// ✅ P2P Monitoring Bot - Enhanced Version const express = require('express'); const axios = require('axios'); const { HttpsProxyAgent } = require('https-proxy-agent'); const TelegramBot = require('node-telegram-bot-api'); const moment = require('moment-timezone'); require('dotenv').config();

// --- الإعدادات الرئيسية --- const CONFIG = { TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID, SCAN_INTERVAL: 45000, // فحص كل 45 ثانية REQUIRED_DISCOUNT: 3, MAX_AD_AGE_SECONDS: 60, // عمر الإعلان الأقصى CRYPTO_ASSETS: ['USDT', 'BTC', 'ETH'], FIAT_CURRENCIES: ['TRY', 'AED', 'USD'], COINGECKO_IDS: { 'USDT': 'tether', 'BTC': 'bitcoin', 'ETH': 'ethereum' } };

const proxyConfig = { host: process.env.PROXY_HOST, port: process.env.PROXY_PORT, username: process.env.PROXY_USERNAME, password: process.env.PROXY_PASSWORD };

const agent = (proxyConfig.host) ? new HttpsProxyAgent(http://${proxyConfig.username}:${proxyConfig.password}@${proxyConfig.host}:${proxyConfig.port}) : null; const client = axios.create({ httpsAgent: agent, httpAgent: agent });

let reportData = { cheapestAds: {}, errors: [], marketPrices: {} };

if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_CHAT_ID) process.exit(1); const bot = new TelegramBot(CONFIG.TELEGRAM_BOT_TOKEN, { polling: true }); const app = express(); const PORT = process.env.PORT || 3000;

async function safeSendMessage(message) { try { await bot.sendMessage(CONFIG.TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' }); } catch (error) { console.error('Telegram error:', error.message); } }

app.get("/", (req, res) => res.send('✅ P2P Monitoring Bot is alive!')); app.listen(PORT, () => { console.log(Server running on port ${PORT}); safeSendMessage(✅ *البوت بدأ العمل (كل ${CONFIG.SCAN_INTERVAL / 1000} ثانية)*); });

async function getAllMarketPrices() { try { const cryptoIds = Object.values(CONFIG.COINGECKO_IDS).join(','); const fiatIds = CONFIG.FIAT_CURRENCIES.map(f => f.toLowerCase()).join(','); const response = await client.get(https://api.coingecko.com/api/v3/simple/price?ids=${cryptoIds}&vs_currencies=${fiatIds}); return response.data; } catch (error) { reportData.errors.push("❌ فشل الاتصال بـ CoinGecko"); return null; } }

function updateCheapestAdReport(ad, platform, asset, fiat) { const pairKey = ${asset}/${fiat}; const adPrice = parseFloat(ad.price); if (!reportData.cheapestAds[pairKey] || adPrice < reportData.cheapestAds[pairKey].price) { reportData.cheapestAds[pairKey] = { price: adPrice, nickName: ad.nickName, platform: platform }; } }

async function processAndSendAlert(ad, platform, asset, fiat, marketPrice) { const price = parseFloat(ad.price); if (!price || !marketPrice) return; const createTime = new Date(ad.createTime).getTime(); const ageInSeconds = (Date.now() - createTime) / 1000; if (ageInSeconds < 0 || ageInSeconds > CONFIG.MAX_AD_AGE_SECONDS) return; const discount = ((marketPrice - price) / marketPrice) * 100; if (discount >= CONFIG.REQUIRED_DISCOUNT) { const timeInTurkey = moment(createTime).tz('Europe/Istanbul').format('YYYY-MM-DD HH:mm:ss'); const adLink = https://p2p.binance.com/en/advertiserDetail?advertiserNo=${ad.advertiserNo}; const message = 🔔 *فرصة على ${platform}* التاجر: *${ad.nickName}* ${asset}/${fiat} بخصم *${discount.toFixed(2)}%* ⏱️ وقت الإعلان: ${timeInTurkey} 🔗 [رابط الإعلان](${adLink}); await safeSendMessage(message); } }

async function checkP2P(platform, asset, fiat) { try { let ads = []; if (platform === 'Binance') { const { data } = await client.post('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', { page: 1, rows: 5, asset, tradeType: 'SELL', fiat }); ads = (data.data || []).map(item => ({ price: item.adv.price, createTime: item.adv.createTime, nickName: item.advertiser.nickName, advertiserNo: item.advertiser.userNo })); } if (ads.length > 0) updateCheapestAdReport(ads[0], platform, asset, fiat); return ads; } catch (error) { reportData.errors.push(⚠️ فشل فحص ${platform} لـ ${asset}/${fiat}); return []; } }

async function mainMonitoringLoop() { try { reportData = { cheapestAds: {}, errors: [], marketPrices: {} }; const allPrices = await getAll

