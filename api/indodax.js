const crypto = require('crypto');
const fetch = require('node-fetch');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const API_KEY = process.env.INDODAX_API_KEY;
const SECRET_KEY = process.env.INDODAX_SECRET_KEY;
const PUBLIC_BASE = 'https://indodax.com/api';
const TRADE_BASE = 'https://indodax.com/tapi';

// Helper: normalize pair (btcidr → btc_idr)
function normPair(pair) {
  // Already has underscore
  if (pair.includes('_')) return pair;
  // btcidr → btc_idr, ethinr → eth_idr, etc.
  return pair.replace(/^(\w+?)(idr|btc|eth|usdt)$/i, '$1_$2').toLowerCase();
}

// ── PUBLIC API (no auth) ─────────────────────────────────────────
async function getTicker(pair = 'btcidr') {
  const np = normPair(pair);
  const res = await fetch(`${PUBLIC_BASE}/summaries`);
  const data = await res.json();
  const ticker = data.tickers?.[np];
  if (!ticker) throw new Error(`Pair ${np} not found`);
  return { last: ticker.last, buy: ticker.buy, sell: ticker.sell, high: ticker.high, low: ticker.low, vol_idr: ticker.vol_idr };
}

async function getOrderBook(pair = 'btcidr') {
  const cleanPair = pair.replace('_', '').toLowerCase();
  const res = await fetch(`${PUBLIC_BASE}/depth/${cleanPair}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
  });
  return res.json();
}

async function getTrades(pair = 'btcidr') {
  const np = normPair(pair);
  const res = await fetch(`${PUBLIC_BASE}/${np}/trades`);
  return res.json();
}

// ── TRADE API (HMAC-SHA512) ──────────────────────────────────────
async function privateRequest(method, params = {}) {
  const nonce = Date.now();
  const body = new URLSearchParams({ method, nonce, ...params }).toString();
  const sign = crypto.createHmac('sha512', SECRET_KEY).update(body).digest('hex');

  const res = await fetch(TRADE_BASE, {
    method: 'POST',
    headers: {
      'Key': API_KEY,
      'Sign': sign,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const data = await res.json();
  if (data.success !== 1) throw new Error(`Indodax API error: ${data.error}`);
  return data.return;
}

async function getInfo() {
  return privateRequest('getInfo');
}

async function trade({ pair, type, price, amount }) {
  // type: 'buy' | 'sell'
  // amount: IDR for buy, coin for sell
  const np = normPair(pair);
  const params = { pair: np, type, price };
  if (type === 'buy') {
    params.idr = Math.floor(amount);
  } else {
    const coinKey = np.replace('_idr', '').replace('_btc', '').replace('_usdt', '');
    params[coinKey] = amount;
  }
  return privateRequest('trade', params);
}

async function openOrders(pair) {
  return privateRequest('openOrders', pair ? { pair } : {});
}

async function cancelOrder({ pair, orderId, type }) {
  return privateRequest('cancelOrder', { pair, order_id: orderId, type });
}

async function orderHistory(pair) {
  return privateRequest('orderHistory', { pair });
}

module.exports = { getTicker, getOrderBook, getTrades, getInfo, trade, openOrders, cancelOrder, orderHistory, privateRequest };
