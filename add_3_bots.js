const fetch = require('node-fetch');

async function start3Bots() {
  const newPairs = ['koma_idr', 'beat_idr', 'xrp_idr'];
  for (const pair of newPairs) {
    try {
      const res = await fetch('http://localhost:3456/api/bot/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pair,
          mode: 'auto',
          strategy: 'multi_indicator',
          config: {
            intervalSeconds: 10,
            sizingMode: 'fixed',
            orderAmount: 50000,
            sizingValue: 50000,
            dailyLossLimit: 50000,
            stopLossPercent: 0,
            takeProfitPercent: 5,
            trailingPercent: 1,
            cooldownMinutes: 15,
            paperMode: false,
            rsiPeriod: 14,
            bbPeriod: 20
          }
        })
      });
      const data = await res.json();
      console.log(`ADDED_${pair.toUpperCase()}_SUCCESS:`, JSON.stringify(data));
    } catch (e) {
      console.error(`ERROR_${pair}:`, e.message);
    }
  }
}
start3Bots();
