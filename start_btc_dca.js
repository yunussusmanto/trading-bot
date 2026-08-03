const fetch = require('node-fetch');

async function startBtcDca() {
  try {
    const res = await fetch('http://localhost:3456/api/bot/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pair: 'btc_idr',
        mode: 'auto',
        strategy: 'multi_indicator',
        config: {
          intervalSeconds: 10,
          sizingMode: 'fixed',
          orderAmount: 50000,    // Total modal Rp 50.000
          sizingValue: 50000,
          dailyLossLimit: 50000,
          stopLossPercent: 0,    // TIDAK jual rugi
          takeProfitPercent: 3,  // Jual saat avg entry +3%
          trailingPercent: 1,
          cooldownMinutes: 15,
          paperMode: false,
          rsiPeriod: 14,
          bbPeriod: 20,
          dcaStep: 2,            // Beli lagi saat harga turun 2%
          maxDcaOrders: 5        // Max 5 slot x Rp 10.000
        }
      })
    });
    const data = await res.json();
    console.log('BTC_DCA_STARTED:', JSON.stringify(data));
  } catch (e) {
    console.error('ERROR:', e.message);
  }
}
startBtcDca();
