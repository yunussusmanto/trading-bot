require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const indodax = require('./api/indodax');
const engine = require('./strategy/engine');
const backtest = require('./strategy/backtest');
const db = require('./api/db');

// Persistent storage of manual order IDs to distinguish manual from auto orders
const MANUAL_ORDERS_FILE = path.join(__dirname, 'manual_orders.json');
let manualOrderIds = new Set();
try {
  if (fs.existsSync(MANUAL_ORDERS_FILE)) {
    const data = JSON.parse(fs.readFileSync(MANUAL_ORDERS_FILE, 'utf8'));
    manualOrderIds = new Set(data.map(String));
  }
} catch (e) {
  console.error('Error loading manual orders:', e);
}

function saveManualOrders() {
  try {
    fs.writeFileSync(MANUAL_ORDERS_FILE, JSON.stringify([...manualOrderIds]), 'utf8');
  } catch (e) {
    console.error('Error saving manual orders:', e);
  }
}

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

async function sendDiscord(text) {
  if (!DISCORD_WEBHOOK_URL) return;
  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text.replace(/<[^>]*>?/gm, '') }) // strip HTML
    });
  } catch (err) {
    console.error('Discord notification error:', err.message);
  }
}

async function sendTelegram(text) {
  sendDiscord(text); // Call Discord alongside Telegram
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' })
    });
  } catch (err) {
    console.error('Telegram notification error:', err.message);
  }
}

// ── Telegram Command Listener (/status, /balance, /stop) ─────────
let lastTelegramUpdateId = 0;
async function pollTelegramCommands() {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates?offset=${lastTelegramUpdateId + 1}&timeout=2`);
    const data = await res.json();
    if (!data.ok || !data.result) return;

    for (const update of data.result) {
      lastTelegramUpdateId = update.update_id;
      const msg = update.message;
      if (!msg || !msg.text) continue;

      // Security check: only allow commands from the authorized chat ID
      const senderChatId = String(msg.chat.id);
      if (senderChatId !== String(TELEGRAM_CHAT_ID)) {
        console.warn(`[TELEGRAM] Unauthorized command from chat ID ${senderChatId} ignored.`);
        continue;
      }

      const text = msg.text.trim();
      if (text === '/status') {
        const activeList = Object.entries(bots).filter(([, b]) => b.running);
        if (!activeList.length) {
          sendTelegram('🤖 <b>Status Robot:</b>\nTidak ada bot yang sedang berjalan.');
        } else {
          const listText = activeList.map(([p, b]) => `• <b>${p.toUpperCase()}</b> [${b.mode.toUpperCase()}/${b.strategy}]\n  SL: ${b.config.stopLossPercent || 0}% | TP: ${b.config.takeProfitPercent || 0}% | Trailing: ${b.config.trailingPercent || 0}%`).join('\n\n');
          sendTelegram(`🤖 <b>Status Bot Aktif (${activeList.length}):</b>\n\n${listText}`);
        }
      } else if (text === '/balance') {
        try {
          const info = await indodax.getInfo();
          const bal = info.balance || {};
          const textBal = Object.entries(bal)
            .filter(([, v]) => parseFloat(v) > 0)
            .map(([c, v]) => `• <b>${c.toUpperCase()}</b>: ${c === 'idr' ? 'Rp ' + parseFloat(v).toLocaleString('id-ID') : parseFloat(v).toFixed(6)}`)
            .join('\n');
          sendTelegram(`💰 <b>Saldo Indodax Saat Ini:</b>\n\n${textBal || 'Saldo kosong'}`);
        } catch (e) {
          sendTelegram(`❌ Gagal mengambil saldo: ${e.message}`);
        }
      } else if (text === '/stop') {
        Object.keys(bots).forEach(p => {
          if (bots[p].interval) clearInterval(bots[p].interval);
          bots[p].running = false;
        });
        sendTelegram('⏹ <b>Seluruh bot telah di-STOP via Telegram.</b>');
      } else if (text === '/killall') {
        Object.keys(bots).forEach(p => {
          if (bots[p].interval) clearInterval(bots[p].interval);
          bots[p].running = false;
        });
        sendTelegram('🚨 <b>EMERGENCY KILL SWITCH ACTIVATED via Telegram. All bots stopped!</b>');
      } else if (text === '/help' || text === '/start') {
        sendTelegram('🤖 <b>Indodax Trading Bot Commands:</b>\n\n• /status - Cek status bot aktif\n• /balance - Cek saldo Indodax real-time\n• /stop - Stop semua bot running\n• /killall - Emergency Kill Switch');
      }
    }
  } catch (_) {}
}

setInterval(pollTelegramCommands, 4000);

// ── Daily Audit Summary Report (Sent at 23:59 WIB / 16:59 UTC) ───
let lastReportDate = '';
setInterval(async () => {
  const now = new Date();
  const utcHours = now.getUTCHours();
  const utcMinutes = now.getUTCMinutes();
  const dateStr = now.toDateString();

  // 23:59 WIB = 16:59 UTC
  if (utcHours === 16 && utcMinutes === 59 && lastReportDate !== dateStr) {
    lastReportDate = dateStr;
    const allTrades = await db.getTrades(200);
    const todayTrades = allTrades.filter(t => new Date(t.timestamp).toDateString() === dateStr);
    const winTrades = todayTrades.filter(t => t.pnl > 0);
    const totalPnl = todayTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const winRate = todayTrades.length ? ((winTrades.length / todayTrades.length) * 100).toFixed(1) : 0;

    let balSummary = '';
    try {
      const info = await indodax.getInfo();
      balSummary = `\n💰 Saldo IDR: Rp ${parseFloat(info.balance?.idr || 0).toLocaleString('id-ID')}`;
    } catch (_) {}

    sendTelegram(`📊 <b>LAPORAN HARIAN TRADING (23:59 WIB)</b>\n\n• Tanggal: ${dateStr}\n• Total Eksekusi: ${todayTrades.length} trade\n• Win Rate: ${winRate}%\n• Total PnL Hari Ini: <b>Rp ${Math.round(totalPnl).toLocaleString('id-ID')}</b>${balSummary}\n\n<i>Robot terus berjaga 24 jam di VPS.</i>`);
  }
}, 30000);

// ── Equity Curve Snapshot (Every 30 minutes) ─────────────────────
setInterval(async () => {
  try {
    const info = await indodax.getInfo();
    if (info && info.balance) {
      let totalValue = 0;
      // Note: for simplicity, we treat all IDR equivalent, in a real app you'd need prices for coins
      // Here we will just estimate total IDR for simplicity or if the user wants true equity, 
      // we need to multiply coin balances by current prices. We will fetch tickers.
      
      const resSummary = await fetch('https://indodax.com/api/summaries');
      const data = await resSummary.json();
      const tickers = data.tickers || {};
      
      for (const [coin, val] of Object.entries(info.balance)) {
        const amount = parseFloat(val);
        if (amount > 0) {
          if (coin === 'idr') {
            totalValue += amount;
          } else {
            const ticker = tickers[`${coin}_idr`];
            if (ticker && ticker.last) {
              totalValue += amount * parseFloat(ticker.last);
            }
          }
        }
      }
      await db.addEquitySnapshot(totalValue);
    }
  } catch(e) {
    console.error('Equity snapshot error:', e.message);
  }
}, 30 * 60 * 1000);

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'R@sendriya#2024';

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});
app.use(session({
  name: process.env.SESSION_NAME || 'trading_bot_sid',
  secret: process.env.SESSION_SECRET || 'trading-bot-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 },
}));

// Auth middlewares
function requireAuth(req, res, next) {
  if (req.session && req.session.loggedIn) {
    return next();
  }
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized. Harap login terlebih dahulu.' });
  }
  res.redirect('/login');
}

function requirePermission(permName) {
  return (req, res, next) => {
    if (!req.session || !req.session.loggedIn) {
      return res.status(401).json({ error: 'Unauthorized. Harap login terlebih dahulu.' });
    }
    const user = req.session.user || { role: 'admin', permissions: { panel_robot: true, panel_manual: true, panel_orders: true, panel_reports: true, panel_admin: true } };
    if (user.role === 'admin' || user.username === 'admin') return next();
    const perms = user.permissions || {};
    if (perms[permName] !== false) return next();
    return res.status(403).json({ error: `Akses ditolak. Anda tidak memiliki izin untuk fitur (${permName}).` });
  };
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.loggedIn) {
    return res.status(401).json({ error: 'Unauthorized. Harap login terlebih dahulu.' });
  }
  const user = req.session.user || { role: 'admin' };
  const perms = user.permissions || {};
  if (user.role === 'admin' || user.username === 'admin' || perms.panel_admin === true) {
    return next();
  }
  return res.status(403).json({ error: 'Akses khusus Administrator.' });
}

// Login page
app.get('/login', (req, res) => {
  if (req.session?.loggedIn) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'dashboard', 'login.html'));
});

// Login POST (Multi-user DB + Env Fallback)
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username dan password wajib diisi' });
    }

    // 1. Check PostgreSQL users table
    const dbUser = await db.getUserByUsername(username);
    if (dbUser) {
      if (!dbUser.is_active) {
        return res.status(403).json({ error: 'Akun Anda dinonaktifkan. Hubungi Administrator.' });
      }
      if (db.verifyPassword(password, dbUser.password_hash)) {
        req.session.loggedIn = true;
        req.session.user = {
          id: dbUser.id,
          username: dbUser.username,
          role: dbUser.role,
          permissions: dbUser.permissions || {}
        };
        return res.json({ ok: true, user: req.session.user });
      }
    }

    // 2. Fallback check for root ADMIN_USER / ADMIN_PASS
    if (username === ADMIN_USER && password === ADMIN_PASS) {
      req.session.loggedIn = true;
      req.session.user = {
        id: 1,
        username: 'admin',
        role: 'admin',
        permissions: { panel_robot: true, panel_manual: true, panel_orders: true, panel_reports: true, panel_admin: true }
      };
      return res.json({ ok: true, user: req.session.user });
    }

    res.status(401).json({ error: 'Username atau password salah' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

// Profile / Current User Info Endpoint (Fresh DB lookup for real-time permission sync)
app.get('/api/me', async (req, res) => {
  if (!req.session || !req.session.loggedIn) {
    return res.json({ loggedIn: false });
  }
  try {
    if (req.session.user?.id) {
      const freshUser = await db.getUserById(req.session.user.id);
      if (freshUser && freshUser.is_active) {
        req.session.user = {
          id: freshUser.id,
          username: freshUser.username,
          role: freshUser.role,
          permissions: freshUser.permissions || {}
        };
      }
    }
  } catch (e) {
    console.warn('Fresh user lookup info:', e.message);
  }
  const user = req.session.user || {
    id: 1,
    username: 'admin',
    role: 'admin',
    permissions: {}
  };
  res.json({ loggedIn: true, user });
});

// Admin User Management Routes
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const users = await db.getAllUsers();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const { username, password, role, permissions } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username dan password wajib diisi' });
    }
    const existing = await db.getUserByUsername(username);
    if (existing) {
      return res.status(400).json({ error: 'Username sudah digunakan' });
    }
    const user = await db.createUser({ username, password, role, permissions });
    res.json({ ok: true, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { password, role, permissions, is_active } = req.body;
    const updated = await db.updateUser(userId, { password, role, permissions, is_active });
    res.json({ ok: true, user: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    await db.deleteUser(userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Protect all routes below
app.use(requireAuth);
app.use(express.static(path.join(__dirname, 'dashboard')));

// ── State ────────────────────────────────────────────────────────
const bots = {}; // { pair: { running, mode, strategy, config, priceHistory, interval } }
// DCA positions: { pair: { entries: [{price, coinAmount, idrAmount, time}], avgEntry, totalCoin, totalIdr, peakPrice, ... } }
const positions = {};
const pendingApprovals = {}; // { id: { pair, signal, price, resolve } }
const lastTradeTime = {}; // { pair: timestamp }
const lastLoggedAlert = {}; // { key: timestamp }

// ── Rate Limiter ─────────────────────────────────────────────────
let lastApiCall = 0;
async function waitRateLimit() {
  const now = Date.now();
  const timeSinceLast = now - lastApiCall;
  if (timeSinceLast < 200) {
    await new Promise(r => setTimeout(r, 200 - timeSinceLast));
  }
  lastApiCall = Date.now();
}

// ── WebSocket broadcast ──────────────────────────────────────────
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}

// ── Real-Time Ticker Broadcast (Every 2 Seconds) ────────────────
setInterval(async () => {
  if (wss.clients.size === 0) return;
  try {
    const res = await fetch('https://indodax.com/api/summaries');
    const data = await res.json();
    if (data.tickers) {
      broadcast({ type: 'ticker_all', tickers: data.tickers, timestamp: Date.now() });
    }
  } catch (_) {}
}, 2000);

// ── Global Position Safety Monitor (Monitors ALL positions in positions_state.json) ──
async function checkOrphanPositions() {
  const activePairs = Object.keys(positions);
  for (const pair of activePairs) {
    const pos = positions[pair];
    if (!pos) continue;
    try {
      // Cooldown check to prevent spamming failed orders
      const lastTime = lastTradeTime[pair] || 0;
      if (Date.now() - lastTime < 60000) continue;

      await waitRateLimit();
      const ticker = await indodax.getTicker(pair);
      if (!ticker || !ticker.last) continue;
      const currentPrice = parseFloat(ticker.last);
      const avgEntry = pos.avgEntry || pos.entryPrice;
      if (!avgEntry) continue;

      if (currentPrice > (pos.peakPrice || avgEntry)) pos.peakPrice = currentPrice;

      const baseTp = pos.takeProfitPercent || 3;
      const tpPrice = avgEntry * (1 + baseTp / 100);

      // Check if price reached Take Profit (+3%)
      if (currentPrice >= tpPrice) {
        const reason = `Auto Take Profit triggered @ Rp ${currentPrice.toLocaleString('id-ID')} (+${(((currentPrice-avgEntry)/avgEntry)*100).toFixed(2)}%)`;
        console.log(`🚀 [SELL TRIGGERED FOR ${pair.toUpperCase()}] Current: ${currentPrice} >= TP: ${tpPrice}. Selling now!`);
        const cfg = bots[pair]?.config || { paperMode: false, mode: 'auto' };
        await executeOrder(pair, 'SELL', currentPrice, cfg, reason);
      }
    } catch (e) {
      console.error(`checkOrphanPositions error for ${pair}:`, e.message);
    }
  }
}
setInterval(checkOrphanPositions, 8000);

// ── Bot Loop ─────────────────────────────────────────────────────
async function botTick(pair) {
  const bot = bots[pair];
  if (!bot || !bot.running) return;

  try {
    await waitRateLimit();
    const ticker = await indodax.getTicker(pair);
    // Use mid price for analysis, but execution uses buy/sell price (slippage protection)
    const price = parseFloat(ticker.last);
    bot.lastTicker = ticker; // Store full ticker for execution
    bot.priceHistory.push(price);
    if (bot.priceHistory.length > 200) bot.priceHistory.shift();

    broadcast({ type: 'price', pair, price, timestamp: Date.now() });

    // Live stream OrderBook on tick
    try {
      await waitRateLimit();
      const depth = await indodax.getOrderBook(pair);
      broadcast({ type: 'orderbook', pair, depth });
    } catch (_) {}

    // ── Check Position SL / TP / Trailing Stop (DCA-aware) ─────────
    const pos = positions[pair];
    if (pos) {
      const avgEntry = pos.avgEntry || pos.entryPrice;
      if (price > (pos.peakPrice || avgEntry)) pos.peakPrice = price;

      // Calculate initial SL price
      let slPrice = (pos.stopLossPercent || 0) > 0 ? avgEntry * (1 - pos.stopLossPercent / 100) : 0;
      
      // Trailing SL: if stopLossPercent is 0 (no cut loss), trailing SL must NEVER drop below avgEntry (only lock profit)
      if ((pos.trailingPercent || 0) > 0 && pos.peakPrice > avgEntry) {
        const trailSL = pos.peakPrice * (1 - pos.trailingPercent / 100);
        // Only allow trailing SL if stopLoss > 0 OR if trailSL >= avgEntry (in profit)
        if (pos.stopLossPercent > 0 || trailSL >= avgEntry) {
          if (trailSL > slPrice) slPrice = trailSL;
        }
      }
      // Dynamic TP Scaling based on DCA slot count (+0.5% per extra DCA slot for bigger bounce gains)
      let baseTp = pos.takeProfitPercent || 3;
      if (pos.entries && pos.entries.length >= 3) {
        baseTp = Math.min(baseTp + (pos.entries.length - 2) * 0.5, 5.0);
      }
      const tpPrice = (baseTp > 0) ? avgEntry * (1 + baseTp / 100) : 0;

      // Check SL / TP / Trailing Stop with cooldown guard
      const tradeCooldownMs = (bot.config.cooldownMinutes || 5) * 60 * 1000;
      const isCooldown = lastTradeTime[pair] && (Date.now() - lastTradeTime[pair] < Math.min(tradeCooldownMs, 60000));

      if (!isCooldown) {
        // Check Stop Loss / Trailing Stop Trigger
        if (slPrice > 0 && price <= slPrice) {
          const reason = pos.peakPrice > avgEntry ? `Trailing Stop triggered @ Rp ${price.toLocaleString('id-ID')}` : `Stop Loss triggered @ Rp ${price.toLocaleString('id-ID')}`;
          await executeOrder(pair, 'SELL', price, bot.config, reason);
          return;
        }

        // Check Take Profit Trigger
        if (tpPrice > 0 && price >= tpPrice) {
          const reason = `Take Profit triggered @ Rp ${price.toLocaleString('id-ID')} (Avg Entry: Rp ${Math.round(avgEntry).toLocaleString('id-ID')})`;
          await executeOrder(pair, 'SELL', price, bot.config, reason);
          return;
        }
      }

      // ── DCA: Beli lagi jika harga turun dcaStep% dari entry terakhir ──
      const dcaStep = bot.config.dcaStep || 2; // Default turun 2% → beli lagi
      const maxDcaOrders = bot.config.maxDcaOrders || 5; // Max 5 sub-order
      const lastEntryPrice = pos.entries && pos.entries.length > 0
        ? pos.entries[pos.entries.length - 1].price
        : avgEntry;
      const dropFromLast = ((lastEntryPrice - price) / lastEntryPrice) * 100;

      if (dropFromLast >= dcaStep && pos.entries.length < maxDcaOrders) {
        const cooldownMs = (bot.config.cooldownMinutes || 15) * 60 * 1000;
        if (!lastTradeTime[pair] || (Date.now() - lastTradeTime[pair] >= cooldownMs)) {
          const reason = `DCA #${pos.entries.length + 1} — harga turun ${dropFromLast.toFixed(1)}% dari entry terakhir`;
          await executeOrder(pair, 'DCA_BUY', price, bot.config, reason);
          return;
        }
      }
    }

    const result = engine.analyze({
      strategy: bot.strategy,
      price,
      priceHistory: [...bot.priceHistory],
      config: bot.config,
    });

    if (result.signal === 'HOLD') return;

    // ── GUARD 1: Jangan BUY baru jika posisi DCA sudah ada ──
    if (result.signal === 'BUY' && positions[pair]) {
      // sudah ada posisi, biarkan DCA logic di atas yang handle
      return;
    }

    // ── GUARD 1A: MACRO TREND GUARD — Beli hanya jika pasar sehat (di atas 50-period SMA) ──
    if (result.signal === 'BUY' && bot.priceHistory.length >= 20) {
      const sma50 = bot.priceHistory.reduce((a, b) => a + b, 0) / bot.priceHistory.length;
      if (price < sma50 * 0.95) {
        console.log(`[${pair.toUpperCase()}] BUY IGNORED — Macro Trend Guard: harga Rp ${price} di bawah 5% trend SMA50 (Rp ${Math.round(sma50)})`);
        return;
      }
    }

    // ── GUARD 1B: Jangan SELL jika harga <= avgEntry saat stopLossPercent = 0 (No Cut Loss) ──
    if (result.signal === 'SELL' && positions[pair]) {
      const pos = positions[pair];
      const avgEntry = pos.avgEntry || pos.entryPrice;
      const slPercent = bot.config.stopLossPercent ?? pos.stopLossPercent ?? 0;
      if (slPercent === 0 && price <= avgEntry) {
        console.log(`[${pair.toUpperCase()}] Indicator SELL IGNORED — price Rp ${price} <= avgEntry Rp ${Math.round(avgEntry)} (SL=0%, NO CUT LOSS)`);
        return;
      }
    }

    // ── GUARD 2: Cooldown Period ──
    const cooldownMs = (bot.config.cooldownMinutes || 5) * 60 * 1000;
    if (lastTradeTime[pair] && (Date.now() - lastTradeTime[pair] < cooldownMs)) {
      return;
    }

    // ── GUARD 3: Daily Loss Limit ──
    const todayLoss = await db.getTodayLoss(pair);
    if (todayLoss > (bot.config.dailyLossLimit || 100000)) {
      const msg = `⚠️ Daily Loss Limit Rp ${(bot.config.dailyLossLimit || 100000).toLocaleString('id-ID')} tercapai! Bot ${pair.toUpperCase()} di-pause.`;
      broadcast({ type: 'alert', pair, msg });
      bot.running = false;
      clearInterval(bot.interval);
      return;
    }

    if (bot.mode === 'auto') {
      // Use correct execution price: sell price for BUY, buy price for SELL (market reality)
      const execPrice = result.signal === 'BUY'
        ? parseFloat(bot.lastTicker?.sell || price) // we pay the ask price when buying
        : parseFloat(bot.lastTicker?.buy || price);  // we receive the bid price when selling
      await executeOrder(pair, result.signal, execPrice, bot.config);
    } else {
      // Semi-auto: ask for approval
      const id = `${pair}-${Date.now()}`;
      pendingApprovals[id] = { pair, signal: result.signal, price, reason: result.reason };
      broadcast({ type: 'approval_request', id, pair, signal: result.signal, price, reason: result.reason });
      sendTelegram(`🔔 <b>SEMI-AUTO SIGNAL DETECTED</b>\n\nPair: <b>${pair.toUpperCase()}</b>\nAction: <b>${result.signal}</b>\nPrice: Rp ${price.toLocaleString('id-ID')}\nReason: ${result.reason}\n\n<i>Buka dashboard untuk approve/reject!</i>`);
    }
  } catch (err) {
    broadcast({ type: 'error', pair, msg: err.message });
  }
}

async function executeOrder(pair, signal, price, config, customReason = '') {
  // DCA per-slot: modal dibagi maxDcaOrders
  const maxDcaOrders = config.maxDcaOrders || 5;
  const totalModal = config.orderAmount || 50000;
  let idrAmount = Math.floor(totalModal / maxDcaOrders); // Rp per slot DCA
  const isPaper = config.paperMode === true;
  const isDcaBuy = signal === 'DCA_BUY';
  const isBuy = signal === 'BUY' || isDcaBuy;

  // === GUARD: SELL only if open position AND strictly NO-LOSS if stopLossPercent = 0 ===
  if (signal === 'SELL') {
    if (!positions[pair]) {
      console.log(`[${pair.toUpperCase()}] SELL skipped — no open position`);
      return null;
    }
    const pos = positions[pair];
    const avgEntry = pos.avgEntry || pos.entryPrice;
    const slPercent = config.stopLossPercent ?? pos.stopLossPercent ?? 0;
    if (slPercent === 0 && price <= avgEntry) {
      const alertKey = `${pair}-sell-blocked`;
      const now = Date.now();
      if (!lastLoggedAlert[alertKey] || (now - lastLoggedAlert[alertKey] > 600000)) {
        lastLoggedAlert[alertKey] = now;
        const msg = `🚫 SELL BLOCKED — Proteksi Anti-Loss Aktif! Harga Rp ${price.toLocaleString('id-ID')} <= Avg Entry Rp ${Math.round(avgEntry).toLocaleString('id-ID')} (SL = 0%). Bot wajib HOLD sampai PROFIT!`;
        console.log(`[${pair.toUpperCase()}] ${msg}`);
        broadcast({ type: 'alert', pair, msg });
      }
      return null;
    }
  }

  // === GUARD: BUY — check sufficient IDR balance & Auto-Compounding ===
  if (isBuy && !isPaper) {
    try {
      const info = await indodax.getInfo();
      const idrBalance = parseFloat(info.balance?.idr || 0);
      
      // Auto-Compounding: Jika saldo IDR tumbuh di atas 5 Juta, naikkan modal per slot proporsional (+profit)
      if (idrBalance > 5000000) {
        const growthRatio = Math.min(idrBalance / 5000000, 2.0);
        idrAmount = Math.floor(idrAmount * growthRatio);
      }

      if (config.sizingMode === 'percentage' && config.sizingValue) {
        idrAmount = Math.floor(idrBalance * (parseFloat(config.sizingValue) / 100) / maxDcaOrders);
      }
      if (idrBalance < idrAmount) {
        const alertKey = `${pair}-buy-insufficient`;
        const now = Date.now();
        if (!lastLoggedAlert[alertKey] || (now - lastLoggedAlert[alertKey] > 600000)) {
          lastLoggedAlert[alertKey] = now;
          const msg = `BUY skipped — IDR saldo Rp ${idrBalance.toLocaleString('id-ID')} tidak cukup (butuh Rp ${idrAmount.toLocaleString('id-ID')})`;
          console.log(`[${pair.toUpperCase()}] ${msg}`);
          broadcast({ type: 'alert', pair, msg });
        }
        lastTradeTime[pair] = Date.now();
        return null;
      }
    } catch (_) {}
  }

  // Min order check — Indodax minimum Rp 10.000
  if (idrAmount < 10000) {
    console.log(`[${pair.toUpperCase()}] order amount Rp ${idrAmount} terlalu kecil, minimum Rp 10.000`);
    lastTradeTime[pair] = Date.now();
    return null;
  }

  const slotCoinAmount = parseFloat((idrAmount / price).toFixed(8));

  try {
    let order = { order_id: `paper-${Date.now()}` };

    if (!isPaper) {
      await waitRateLimit();
      if (isBuy) {
        order = await indodax.trade({ pair, type: 'buy', price, amount: idrAmount });
      } else {
        // SELL: gunakan saldo koin AKTUAL dari Indodax API (bukan kalkulasi)
        // Alasan: fee 0.3% saat BUY mengurangi koin actual vs koin yang dicatat
        let actualCoinAmount = positions[pair]?.totalCoin || slotCoinAmount;
        try {
          const info = await indodax.getInfo();
          const coinKey = pair.replace('_idr', '');
          const actualBalance = parseFloat(info.balance?.[coinKey] || 0);
          if (actualBalance > 0) {
            if (actualBalance < actualCoinAmount) {
              // Jika saldo di exchange lebih sedikit dari catatan bot (misal terjual manual), gunakan saldo exchange
              actualCoinAmount = parseFloat(actualBalance.toFixed(8));
            } else if (actualBalance >= actualCoinAmount * 0.9) {
              // Pakai saldo aktual jika masuk akal (tidak jauh berbeda) untuk membersihkan sisa debu (dust)
              actualCoinAmount = parseFloat(actualBalance.toFixed(8));
            }
          }
        } catch (_) {}

        // Validasi minimum coin value >= Rp 10.000
        const coinValueIdr = actualCoinAmount * price;
        if (coinValueIdr < 10000) {
          const msg = `SELL skipped — nilai koin Rp ${Math.round(coinValueIdr).toLocaleString('id-ID')} di bawah minimum Indodax (Rp 10.000)`;
          console.log(`[${pair.toUpperCase()}] ${msg}`);
          broadcast({ type: 'alert', pair, msg });
          // Clear position dust if paper or sub-minimum to prevent endless trigger spam
          delete positions[pair];
          savePositions();
          lastTradeTime[pair] = Date.now();
          return null;
        }

        order = await indodax.trade({ pair, type: 'sell', price, amount: actualCoinAmount });
      }
    }

    let pnl = 0;
    let sellSnapshot = null; // Capture before delete for notification
    if (isBuy) {
      if (!positions[pair]) {
        // First BUY — init DCA position
        positions[pair] = {
          entries: [],
          avgEntry: price,
          totalCoin: 0,
          totalIdr: 0,
          peakPrice: price,
          stopLossPercent: parseFloat(config.stopLossPercent || 0),
          takeProfitPercent: parseFloat(config.takeProfitPercent || 0),
          trailingPercent: parseFloat(config.trailingPercent || 0),
          openedAt: Date.now(),
        };
      }
      // Add sub-entry to DCA list
      positions[pair].entries.push({ price, coinAmount: slotCoinAmount, idrAmount, time: Date.now() });
      positions[pair].totalCoin = parseFloat((positions[pair].totalCoin + slotCoinAmount).toFixed(8));
      positions[pair].totalIdr += idrAmount;
      // Recalculate weighted avg entry
      const totalW = positions[pair].entries.reduce((s, e) => s + e.price * e.coinAmount, 0);
      const totalC = positions[pair].entries.reduce((s, e) => s + e.coinAmount, 0);
      positions[pair].avgEntry = totalC > 0 ? totalW / totalC : price;
      if (price > positions[pair].peakPrice) positions[pair].peakPrice = price;
      savePositions();
    } else if (signal === 'SELL' && positions[pair]) {
      const avgEntry = positions[pair].avgEntry;
      const totalCoins = positions[pair].totalCoin;
      const totalIdr = positions[pair].totalIdr;
      pnl = (price - avgEntry) * totalCoins;
      const sellResult = totalCoins * price;
      const pnlPct = totalIdr > 0 ? ((pnl / totalIdr) * 100) : 0;
      // Save snapshot BEFORE delete
      sellSnapshot = {
        avgEntry,
        totalCoins,
        totalIdr,
        sellResult,
        pnl,
        pnlPct,
        dcaCount: positions[pair].entries?.length || 1,
        openedAt: positions[pair].openedAt,
      };
      delete positions[pair];
      savePositions();
    }

    const pos = positions[pair];
    const dcaInfo = pos ? ` | DCA ${pos.entries.length}/${maxDcaOrders} | Avg: Rp ${Math.round(pos.avgEntry).toLocaleString('id-ID')}` : '';

    const trade = {
      id: order.order_id || `order-${Date.now()}`,
      pair,
      action: isBuy ? 'BUY' : 'SELL',
      price,
      amount: isBuy ? idrAmount : (positions[pair]?.totalIdr || idrAmount),
      pnl: Math.round(pnl),
      reason: customReason || (isPaper ? '[PAPER] Trade' : ''),
      timestamp: Date.now(),
      paper: isPaper,
    };
    await db.addTrade(trade);
    lastTradeTime[pair] = Date.now();
    broadcast({ type: 'trade', trade });

    // Build Telegram notification
    const actionLabel = isDcaBuy ? `DCA BUY #${pos?.entries?.length || '?'}` : signal;
    if (signal === 'SELL' && sellSnapshot) {
      const { avgEntry, totalCoins, totalIdr, sellResult, pnlPct, dcaCount } = sellSnapshot;
      const pnlAbs = Math.round(pnl);
      const isUntung = pnl >= 0;
      const emoji = isUntung ? '🟢' : '🔴';
      const label = isUntung ? 'UNTUNG' : 'RUGI';
      const holdMs = sellSnapshot.openedAt ? Date.now() - sellSnapshot.openedAt : 0;
      const holdMin = Math.round(holdMs / 60000);
      sendTelegram(
        `💰 <b>SELL EXECUTED — ${label} ${emoji}</b>\n\n` +
        `Pair: <b>${pair.toUpperCase()}</b>\n` +
        `Harga Jual: Rp ${price.toLocaleString('id-ID')}\n` +
        `Avg Entry: Rp ${Math.round(avgEntry).toLocaleString('id-ID')}\n` +
        `Jumlah Koin: ${totalCoins.toFixed(8)}\n` +
        `Modal Masuk: Rp ${Math.round(totalIdr).toLocaleString('id-ID')}\n` +
        `Hasil Jual: Rp ${Math.round(sellResult).toLocaleString('id-ID')}\n` +
        `───────────────\n` +
        `<b>${label}: Rp ${Math.abs(pnlAbs).toLocaleString('id-ID')} (${pnlPct.toFixed(2)}%)</b>\n` +
        `DCA Orders: ${dcaCount}x | Hold: ${holdMin} menit\n` +
        `Order ID: ${trade.id}`
      );
    } else {
      sendTelegram(`✅ <b>TRADE EXECUTED (${actionLabel})</b>\n\nPair: <b>${pair.toUpperCase()}</b>\nPrice: Rp ${price.toLocaleString('id-ID')}\nAmount: Rp ${idrAmount.toLocaleString('id-ID')}${dcaInfo}${pnl !== 0 ? `\nPnL: Rp ${Math.round(pnl).toLocaleString('id-ID')}` : ''}\nOrder ID: ${trade.id}`);
    }
    return trade;
  } catch (err) {
    broadcast({ type: 'error', pair, msg: `Order failed: ${err.message}` });
    // Cooldown setelah gagal agar tidak retry terus-menerus
    lastTradeTime[pair] = Date.now();
  }
}

const BOTS_FILE = path.join(__dirname, 'bots_state.json');
const POSITIONS_FILE = path.join(__dirname, 'positions_state.json');

function savePositions() {
  try {
    fs.writeFileSync(POSITIONS_FILE, JSON.stringify(positions, null, 2));
  } catch (_) {}
}

function restorePositions() {
  try {
    if (fs.existsSync(POSITIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(POSITIONS_FILE, 'utf8'));
      Object.assign(positions, data);
      const pairs = Object.keys(positions);
      if (pairs.length) console.log(`[POSITIONS] Restored ${pairs.length} open position(s): ${pairs.join(', ')}`);
    }
  } catch (err) {
    console.error('Failed to restore positions:', err.message);
  }
}

async function saveBotsState() {
  try {
    const data = {};
    for (const [pair, b] of Object.entries(bots)) {
      if (b.running) {
        data[pair] = { running: true, mode: b.mode, strategy: b.strategy, config: b.config };
        await db.saveBotConfig(pair, true, b.mode, b.strategy, b.config).catch(()=>{});
      } else {
        await db.saveBotConfig(pair, false, b.mode, b.strategy, b.config).catch(()=>{});
      }
    }
    fs.writeFileSync(BOTS_FILE, JSON.stringify(data, null, 2));
  } catch (_) {}
}

async function restoreBotsState() {
  try {
    restorePositions(); // Restore positions FIRST before bots start ticking
    let activeList = [];
    if (fs.existsSync(BOTS_FILE)) {
      const data = JSON.parse(fs.readFileSync(BOTS_FILE, 'utf8'));
      Object.entries(data).forEach(([p, b]) => {
        if (b.running) activeList.push({ pair: p, ...b });
      });
    }
    const dbConfigs = await db.getActiveBotConfigs().catch(() => []);
    dbConfigs.forEach(b => {
      if (!activeList.find(x => x.pair === b.pair)) activeList.push(b);
    });

    activeList.forEach(b => {
      if (!bots[b.pair]?.running) {
        bots[b.pair] = {
          running: true, mode: b.mode, strategy: b.strategy, config: b.config,
          priceHistory: [],
          interval: setInterval(() => botTick(b.pair), (b.config?.intervalSeconds || 10) * 1000)
        };
        botTick(b.pair);
      }
    });
  } catch (_) {}
}

restoreBotsState();

// ── REST API ─────────────────────────────────────────────────────
// Start bot for a pair
app.post('/api/bot/start', requirePermission('panel_robot'), (req, res) => {
  const { pair, mode = 'auto', strategy = 'threshold', config = {} } = req.body;
  if (!pair) return res.status(400).json({ error: 'pair required' });

  if (bots[pair]?.interval) clearInterval(bots[pair].interval);

  bots[pair] = {
    running: true, mode, strategy, config,
    priceHistory: [],
    interval: setInterval(() => botTick(pair), (config.intervalSeconds || 10) * 1000),
  };
  botTick(pair); // immediate first tick
  saveBotsState();
  broadcast({ type: 'bot_status', pair, running: true, mode, strategy });
  res.json({ ok: true, pair, mode, strategy });
});

// Stop bot
app.post('/api/bot/stop', requirePermission('panel_robot'), (req, res) => {
  const { pair } = req.body;
  if (bots[pair]) {
    clearInterval(bots[pair].interval);
    bots[pair].running = false;
  }
  saveBotsState();
  broadcast({ type: 'bot_status', pair, running: false });
  res.json({ ok: true });
});

// Get all bot statuses
app.get('/api/bot/status', (req, res) => {
  const status = Object.entries(bots).map(([pair, b]) => ({
    pair, running: b.running, mode: b.mode, strategy: b.strategy, config: b.config,
  }));
  res.json(status);
});

// Get open orders directly from Indodax API (supports all pairs query)
app.get('/api/open-orders', async (req, res) => {
  try {
    const targetPair = req.query.pair;
    let allOrders = [];
    
    if (targetPair && targetPair !== 'all') {
      await waitRateLimit();
      const data = await indodax.openOrders(targetPair.toLowerCase());
      if (data && data.orders && data.orders.length) {
        allOrders = data.orders.map(o => ({ 
          ...o, 
          pair: targetPair.toUpperCase(),
          source: manualOrderIds.has(String(o.order_id)) ? 'M' : 'A'
        }));
      }
    } else {
      await waitRateLimit();
      const data = await indodax.openOrders();
      if (data && data.orders) {
        if (Array.isArray(data.orders)) {
          allOrders = data.orders.map(o => ({ 
            ...o, 
            pair: (o.pair || 'CRYPTO').toUpperCase(),
            source: manualOrderIds.has(String(o.order_id)) ? 'M' : 'A'
          }));
        } else {
          for (const [pairName, ordersList] of Object.entries(data.orders)) {
            if (Array.isArray(ordersList)) {
              const formatted = ordersList.map(o => ({ 
                ...o, 
                pair: pairName.toUpperCase(),
                source: manualOrderIds.has(String(o.order_id)) ? 'M' : 'A'
              }));
              allOrders = allOrders.concat(formatted);
            }
          }
        }
      }
    }
    res.json(allOrders);
  } catch (e) { res.json([]); }
});

// Cancel an open order on Indodax
app.post('/api/order/cancel', requirePermission('panel_orders'), async (req, res) => {
  try {
    const { pair, orderId, type } = req.body;
    if (!pair || !orderId || !type) {
      return res.status(400).json({ error: 'Missing parameters' });
    }
    await waitRateLimit();
    const result = await indodax.cancelOrder({ 
      pair: pair.toLowerCase(), 
      orderId: orderId, 
      type: type.toLowerCase() 
    });
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Execute a manual order on Indodax
app.post('/api/order/manual', requirePermission('panel_manual'), async (req, res) => {
  try {
    const { pair, type, orderType, price, amount } = req.body;
    if (!pair || !type || !orderType || !amount) {
      return res.status(400).json({ error: 'Missing trade parameters' });
    }
    
    const cleanPair = pair.toLowerCase().replace('/', '');
    let targetPrice = parseFloat(price);
    
    // If market/instant order, we get the current ticker price and apply slippage
    if (orderType === 'market') {
      const ticker = await indodax.getTicker(cleanPair);
      const lastPrice = parseFloat(ticker.last);
      if (type === 'buy') {
        targetPrice = Math.round(lastPrice * 1.05); // 5% slippage to buy instantly
      } else {
        targetPrice = Math.round(lastPrice * 0.95); // 5% slippage to sell instantly
      }
    }
    
    if (!targetPrice || targetPrice <= 0) {
      return res.status(400).json({ error: 'Invalid or missing price' });
    }
    
    await waitRateLimit();
    const result = await indodax.trade({
      pair: cleanPair,
      type: type.toLowerCase(),
      price: targetPrice,
      amount: parseFloat(amount)
    });
    
    
    if (result && result.order_id) {
      manualOrderIds.add(String(result.order_id));
      saveManualOrders();
    }
    
    const coinSymbol = cleanPair.replace('_idr', '').toUpperCase();
    const formattedPrice = targetPrice.toLocaleString('id-ID');
    const formattedAmount = parseFloat(amount).toLocaleString('id-ID', { maximumFractionDigits: 8 });
    
    sendTelegram(`⚡ <b>MANUAL ORDER PLACED</b>\n\nPair: <b>${cleanPair.toUpperCase()}</b>\nTipe: <b>${type.toUpperCase()} (${orderType.toUpperCase()})</b>\nHarga: <b>Rp ${formattedPrice}</b>\nJumlah: <b>${formattedAmount} ${type === 'buy' ? 'IDR' : coinSymbol}</b>`);
    
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get balance
app.get('/api/balance', async (req, res) => {
  try {
    const info = await indodax.getInfo();
    res.json(info.balance);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get trade history from SQLite DB
app.get('/api/trades', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || 100);
    const rows = await db.getTrades(limit);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get profit report grouped by coin pair
app.get('/api/reports/coins', async (req, res) => {
  try {
    const data = await db.getProfitPerCoin();
    const formatted = data.map(r => ({
      pair: (r.pair || '').toUpperCase(),
      tradeCount: parseInt(r.trade_count || 0),
      totalProfit: parseFloat(r.total_profit || 0)
    }));
    res.json(formatted);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// CSV Export
app.get('/api/trades/export', async (req, res) => {
  try {
    const rows = await db.getTrades(10000);
    let csv = 'Waktu,Pair,Jenis,Harga,Nominal,PnL,Reason\n';
    rows.forEach(r => {
      const t = new Date(r.timestamp).toISOString();
      csv += `${t},${r.pair},${r.action},${r.price},${r.amount},${r.pnl},"${(r.reason || '').replace(/"/g, '""')}"\n`;
    });
    res.header('Content-Type', 'text/csv');
    res.attachment('trades.csv');
    res.send(csv);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get user setting
app.get('/api/settings/:key', async (req, res) => {
  try {
    const value = await db.getSetting(req.params.key);
    res.json({ key: req.params.key, value });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Save user setting
app.post('/api/settings/:key', async (req, res) => {
  try {
    await db.saveSetting(req.params.key, req.body.value);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// P&L Summary
app.get('/api/pnl/summary', async (req, res) => {
  try {
    const summary = await db.getPnLSummary();
    res.json(summary);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Equity Curve
app.get('/api/equity', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const curve = await db.getEquityCurve(days);
    res.json(curve);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get Open Positions
app.get('/api/positions', async (req, res) => {
  try {
    const activePairs = Object.keys(positions);
    const result = [];
    for (const pair of activePairs) {
      const pos = positions[pair];
      if (!pos) continue;
      let currentPrice = pos.avgEntry || pos.entryPrice || 0;
      try {
        await waitRateLimit();
        const ticker = await indodax.getTicker(pair);
        if (ticker && ticker.last) currentPrice = parseFloat(ticker.last);
      } catch (err) {}

      const avgEntry = pos.avgEntry || pos.entryPrice || currentPrice;
      const totalIdr = pos.totalIdr || pos.amount || (avgEntry * (pos.totalCoin || 0));
      const totalCoin = pos.totalCoin || pos.coinAmount || 0;
      const liveValue = currentPrice * totalCoin;
      const pnlVal = liveValue - totalIdr;
      const pnlPercent = avgEntry > 0 ? ((currentPrice - avgEntry) / avgEntry) * 100 : 0;

      result.push({
        pair: pair.toUpperCase(),
        entryPrice: avgEntry,
        currentPrice: currentPrice,
        amount: Math.round(totalIdr),
        liveValue: Math.round(liveValue),
        coinAmount: totalCoin,
        pnl: Math.round(pnlVal),
        pnlPercent: parseFloat(pnlPercent.toFixed(2)),
        dcaOrders: pos.entries ? pos.entries.length : 1,
        openedAt: pos.openedAt || Date.now()
      });
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Emergency Stop
app.post('/api/emergency-stop', (req, res) => {
  Object.keys(bots).forEach(p => {
    if (bots[p].interval) clearInterval(bots[p].interval);
    bots[p].running = false;
  });
  saveBotsState();
  broadcast({ type: 'alert', pair: 'ALL', msg: 'Emergency Stop Activated' });
  sendTelegram('🚨 <b>EMERGENCY KILL SWITCH ACTIVATED via API. All bots stopped!</b>');
  res.json({ ok: true });
});

// Approve/reject semi-auto order
app.post('/api/approve', async (req, res) => {
  const { id, approved } = req.body;
  const pending = pendingApprovals[id];
  if (!pending) return res.status(404).json({ error: 'not found' });

  delete pendingApprovals[id];
  if (approved) {
    const bot = bots[pending.pair];
    await executeOrder(pending.pair, pending.signal, pending.price, bot?.config || {});
    res.json({ ok: true, executed: true });
  } else {
    res.json({ ok: true, executed: false });
  }
});

// Get pending approvals
app.get('/api/approvals', (req, res) => res.json(Object.entries(pendingApprovals).map(([id, v]) => ({ id, ...v }))));

// Get Daily Report by Date (YYYY-MM-DD)
app.get('/api/reports/daily', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const report = await db.getDailyReportByDate(date);
    res.json(report);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get available pairs from Indodax (200+ pairs)
app.get('/api/pairs', async (req, res) => {
  try {
    const resSummary = await fetch('https://indodax.com/api/summaries', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
    });
    const data = await resSummary.json();
    const tickers = data.tickers || {};
    const pairs = Object.keys(tickers)
      .filter(p => p.endsWith('_idr'))
      .map(p => ({
        symbol: p,
        name: tickers[p].name ? `${tickers[p].name} (${p.replace('_idr', '').toUpperCase()}/IDR)` : `${p.replace('_idr', '').toUpperCase()}/IDR`,
        last: parseFloat(tickers[p].last || 0),
        high: parseFloat(tickers[p].high || 0),
        low: parseFloat(tickers[p].low || 0),
        vol: parseFloat(tickers[p].vol_idr || 0)
      }))
      .sort((a, b) => b.vol - a.vol); // Sort by 24h Volume

    if (pairs.length > 5) {
      return res.json(pairs);
    }
    throw new Error('Less than 5 pairs returned');
  } catch (e) {
    console.error('API pairs fetch fallback:', e.message);
    const fallbackList = [
      { symbol: 'btc_idr', name: 'Bitcoin (BTC/IDR)', last: 1131896000 },
      { symbol: 'eth_idr', name: 'Ethereum (ETH/IDR)', last: 45000000 },
      { symbol: 'usdt_idr', name: 'Tether (USDT/IDR)', last: 16200 },
      { symbol: 'sol_idr', name: 'Solana (SOL/IDR)', last: 2400000 },
      { symbol: 'bnb_idr', name: 'Binance Coin (BNB/IDR)', last: 9500000 },
      { symbol: 'xrp_idr', name: 'Ripple (XRP/IDR)', last: 38000 },
      { symbol: 'doge_idr', name: 'Dogecoin (DOGE/IDR)', last: 4200 },
      { symbol: 'pepe_idr', name: 'Pepe (PEPE/IDR)', last: 0.15 },
      { symbol: 'shib_idr', name: 'Shiba Inu (SHIB/IDR)', last: 0.35 },
      { symbol: 'ada_idr', name: 'Cardano (ADA/IDR)', last: 12000 },
      { symbol: 'avax_idr', name: 'Avalanche (AVAX/IDR)', last: 450000 },
      { symbol: 'dot_idr', name: 'Polkadot (DOT/IDR)', last: 110000 },
      { symbol: 'link_idr', name: 'Chainlink (LINK/IDR)', last: 280000 },
      { symbol: 'matic_idr', name: 'Polygon (MATIC/IDR)', last: 9000 },
      { symbol: 'trx_idr', name: 'TRON (TRX/IDR)', last: 3800 },
      { symbol: 'near_idr', name: 'NEAR Protocol (NEAR/IDR)', last: 75000 },
      { symbol: 'apt_idr', name: 'Aptos (APT/IDR)', last: 140000 },
      { symbol: 'sui_idr', name: 'Sui (SUI/IDR)', last: 48000 },
      { symbol: 'render_idr', name: 'Render Token (RENDER/IDR)', last: 110000 },
      { symbol: 'fet_idr', name: 'Fetch.ai (FET/IDR)', last: 22000 },
      { symbol: 'fil_idr', name: 'Filecoin (FIL/IDR)', last: 70000 },
      { symbol: 'arb_idr', name: 'Arbitrum (ARB/IDR)', last: 11000 },
      { symbol: 'op_idr', name: 'Optimism (OP/IDR)', last: 28000 },
      { symbol: 'inj_idr', name: 'Injective (INJ/IDR)', last: 350000 },
      { symbol: 'kas_idr', name: 'Kaspa (KAS/IDR)', last: 2400 }
    ];
    res.json(fallbackList);
  }
});

// Get Live Orderbook (Depth) for a pair
app.get('/api/orderbook/:pair', async (req, res) => {
  try {
    const pair = req.params.pair.toLowerCase();
    const depth = await indodax.getOrderBook(pair);
    res.json(depth);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// Get Candles (OHLCV) History from Indodax
app.get('/api/candles/:pair', async (req, res) => {
  try {
    const pair = req.params.pair.toLowerCase().replace('_', '');
    const { resolution = '15', from, to } = req.query;
    
    let tf = resolution;
    if (resolution.toUpperCase() === '1D') tf = '1440';
    
    const nowSec = Math.floor(Date.now() / 1000);
    
    let defaultFrom = nowSec - 2 * 24 * 60 * 60; // default 2 days
    const tfUpper = resolution.toUpperCase();
    if (tfUpper === '1D' || tf === '1440') {
      defaultFrom = nowSec - 90 * 24 * 60 * 60; // 90 days
    } else if (tfUpper === '240') {
      defaultFrom = nowSec - 45 * 24 * 60 * 60; // 45 days
    } else if (tfUpper === '60') {
      defaultFrom = nowSec - 15 * 24 * 60 * 60; // 15 days
    } else if (tfUpper === '15') {
      defaultFrom = nowSec - 5 * 24 * 60 * 60; // 5 days
    } else if (tfUpper === '5') {
      defaultFrom = nowSec - 2 * 24 * 60 * 60; // 2 days
    } else if (tfUpper === '1') {
      defaultFrom = nowSec - 12 * 60 * 60; // 12 hours
    }
    
    const queryFrom = from || defaultFrom;
    const queryTo = to || nowSec;
    
    const url = `https://indodax.com/tradingview/history_v2?symbol=${pair.toUpperCase()}&tf=${tf}&from=${queryFrom}&to=${queryTo}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const data = await response.json();
    
    if (Array.isArray(data)) {
      const candles = data.map(item => ({
        time: item.Time,
        open: parseFloat(item.Open),
        high: parseFloat(item.High),
        low: parseFloat(item.Low),
        close: parseFloat(item.Close),
        volume: parseFloat(item.Volume || 0)
      }));
      res.json(candles);
    } else {
      res.json([]);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Switch active dashboard streaming pair
app.post('/api/active-pair', (req, res) => {
  const { pair } = req.body;
  if (pair) activeDashboardPair = pair;
  res.json({ ok: true, pair: activeDashboardPair });
});

// Backtesting endpoint
app.post('/api/backtest', async (req, res) => {
  const { pair = 'btcidr', strategy = 'threshold', config = {}, initialCapital = 1000000 } = req.body;
  const bot = bots[pair];
  let priceHistory = bot?.priceHistory || [];

  // Generate simulated smooth random walk if buffer too small
  if (priceHistory.length < 50) {
    try {
      const ticker = await indodax.getTicker(pair);
      const base = parseFloat(ticker.last || 1000000000);
      priceHistory = [];
      let current = base * 0.9;
      for (let i = 0; i < 150; i++) {
        const change = (Math.random() - 0.48) * 0.02; // slight upward drift
        current *= (1 + change);
        priceHistory.push(parseFloat(current.toFixed(0)));
      }
    } catch (e) {
      return res.status(500).json({ error: 'Failed to fetch price ticker for backtest' });
    }
  }

  const result = backtest.runBacktest({ priceHistory, strategy, config, initialCapital });
  res.json(result);
});

// ── WebSocket messages from extension ───────────────────────────
wss.on('connection', ws => {
  ws.on('message', async raw => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'approve') {
        const pending = pendingApprovals[msg.id];
        if (pending) {
          delete pendingApprovals[msg.id];
          if (msg.approved) {
            const bot = bots[pending.pair];
            await executeOrder(pending.pair, pending.signal, pending.price, bot?.config || {});
          }
        }
      }
    } catch (_) {}
  });
  // Send current active bots on connect
  const activeBotsList = Object.entries(bots)
    .filter(([, b]) => b.running)
    .map(([p, b]) => ({ pair: p, running: true, mode: b.mode, strategy: b.strategy, config: b.config }));
  ws.send(JSON.stringify({ type: 'init', bots: activeBotsList, pendingApprovals }));
});

// Continuous Live Orderbook Streamer (every 3 seconds) — follows active bot pair
let activeDashboardPair = 'btc_idr';
setInterval(async () => {
  try {
    const depth = await indodax.getOrderBook(activeDashboardPair);
    broadcast({ type: 'orderbook', pair: activeDashboardPair, depth });
  } catch (_) {}
}, 3000);

// ── Telegram 23:59 WIB Daily Recap Cron ──────────────────────
let lastDailyReportDate = '';
setInterval(async () => {
  try {
    const now = new Date();
    const dateStr = now.toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' });
    const timeParts = now.toLocaleTimeString('en-US', { timeZone: 'Asia/Jakarta', hour12: false }).split(':');
    const hours = parseInt(timeParts[0]);
    const minutes = parseInt(timeParts[1]);

    if (hours === 23 && minutes === 59 && lastDailyReportDate !== dateStr) {
      lastDailyReportDate = dateStr;
      let totalPnlToday = 0;
      for (const pair of Object.keys(bots)) {
        totalPnlToday += await db.getTodayProfit(pair);
      }
      const activeCount = Object.values(bots).filter(b => b.running).length;
      const openCount = Object.keys(positions).length;
      const msg = `📊 <b>REKAP PROFIT HARIAN BOT (${dateStr})</b>\n\n💰 Total Profit Hari Ini: <b>Rp ${Math.round(totalPnlToday).toLocaleString('id-ID')}</b>\n🤖 Bot Running: <b>${activeCount} Bot</b>\n📂 Posisi Terbuka: <b>${openCount} Koin</b>\n🛡 Anti-Loss Status: <b>Aktif 100% (SL 0%)</b>\n\n<i>Profit otomatis terkumpul di saldo Indodax!</i>`;
      sendTelegram(msg);
    }
  } catch (e) {
    console.error('Daily recap error:', e);
  }
}, 30000);

const PORT = process.env.PORT || 3456;
server.listen(PORT, () => {
  console.log(`Trading Bot running on port ${PORT}`);
});
