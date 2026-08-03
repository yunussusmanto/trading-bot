const fetch = require('node-fetch');

async function upgradeXrp() {
  try {
    const res = await fetch('http://localhost:3456/api/bot/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pair: 'xrp_idr',
        mode: 'auto',
        strategy: 'multi_indicator',
        config: {
          intervalSeconds: 10,
          sizingMode: 'fixed',
          orderAmount: 200000,   // Naikkan Modal ke Rp 200.000
          sizingValue: 200000,
          dailyLossLimit: 50000,
          stopLossPercent: 0,    // TANPA JUAL RUGI
          takeProfitPercent: 3,  // Profit +3%
          trailingPercent: 0,
          cooldownMinutes: 15,
          paperMode: false,
          rsiPeriod: 14,
          bbPeriod: 20,
          dcaStep: 2,            // Turun 2% DCA
          maxDcaOrders: 4        // 4 Slot x Rp 50.000
        }
      })
    });
    const data = await res.json();
    console.log('XRP_UPGRADED_SUCCESS:', JSON.stringify(data));
  } catch (e) {
    console.error('ERROR:', e.message);
  }
}
upgradeXrp();
