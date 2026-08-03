# 🤖 Indodax Trading Bot

Bot trading otomatis untuk Indodax dengan strategi **Multi-Indicator DCA**.

## Fitur
- ✅ Multi-pair trading (BTC, ETH, SOL, XRP, dll)
- ✅ Strategi DCA (Dollar Cost Averaging) — beli bertahap saat harga turun
- ✅ Take Profit otomatis (+3% dari avg entry)
- ✅ Stop Loss 0% — tidak pernah jual rugi
- ✅ Trailing Stop
- ✅ Daily Loss Limit
- ✅ Notifikasi Telegram & Discord
- ✅ Dashboard real-time (WebSocket)
- ✅ Paper Mode (simulasi)
- ✅ Limit Order Management

## Stack
- Node.js + Express
- PostgreSQL
- WebSocket (ws)
- PM2 (process manager)
- Nginx (reverse proxy + SSL)

## Setup

```bash
# Install dependencies
npm install

# Copy env
cp .env.example .env
# Edit .env dengan API key Indodax, Telegram token, dll

# Migrate database
node migrate.js

# Start
pm2 start index.js --name trading-bot
```

## Environment Variables
```
INDODAX_KEY=
INDODAX_SECRET=
TELEGRAM_TOKEN=
TELEGRAM_CHAT_ID=
DISCORD_WEBHOOK_URL=
DATABASE_URL=postgresql://...
ADMIN_USER=admin
ADMIN_PASS=
SESSION_SECRET=
```

## Strategi DCA
Modal dibagi N slot. Bot beli 1 slot saat sinyal BUY.
Jika harga turun X%, bot beli slot berikutnya (averaging down).
Jual semua saat harga naik +Y% dari rata-rata entry.

## Dashboard
Akses di `https://your-domain.com` setelah setup Nginx.
