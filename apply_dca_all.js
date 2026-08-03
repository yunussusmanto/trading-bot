const fetch = require('node-fetch');

async function applyDcaAll() {
  const allPairs = ['btc_idr', 'bico_idr', 'eth_idr', 'sol_idr', 'koma_idr', 'beat_idr', 'xrp_idr'];

  for (const pair of allPairs) {
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
            takeProfitPercent: 3,
            trailingPercent: 1,
            cooldownMinutes: 15,
            paperMode: false,
            rsiPeriod: 14,
            bbPeriod: 20,
            dcaStep: 2,
            maxDcaOrders: 5
          }
        })
      });
      const data = await res.json();
      console.log(`DCA_OK_${pair.toUpperCase()}:`, JSON.stringify(data));
    } catch (e) {
      console.error(`ERROR_${pair}:`, e.message);
    }
  }
  console.log('DONE: All 7 bots now use DCA strategy');
}
applyDcaAll();
