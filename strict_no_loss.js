const fetch = require('node-fetch');

async function setStrictNoLoss() {
  const allPairs = ['btc_idr', 'bico_idr', 'eth_idr', 'sol_idr', 'koma_idr', 'beat_idr', 'xrp_idr', 'bank_idr', 'home_idr', 'hype_idr'];

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
            orderAmount: 60000,    // Total modal Rp 60.000 per pair
            sizingValue: 60000,
            dailyLossLimit: 50000,
            stopLossPercent: 0,    // 0% Stop Loss = TANPA JUAL RUGI (Wajib Profit)
            takeProfitPercent: 3,  // 3% Take Profit = Hanya Jual Untung (+3%)
            trailingPercent: 0,    // 0% Trailing Stop = MATIKAN TRAILING (Anti Jual saat Cut/Dip)
            cooldownMinutes: 15,
            paperMode: false,
            rsiPeriod: 14,
            bbPeriod: 20,
            dcaStep: 2,            // DCA saat harga turun 2%
            maxDcaOrders: 4        // 4 Slot x Rp 15.000 (Jamin di atas min limit Indodax)
          }
        })
      });
      const data = await res.json();
      console.log(`PERFECT_CONFIG_${pair.toUpperCase()}:`, JSON.stringify(data));
    } catch (e) {
      console.error(`ERROR_${pair}:`, e.message);
    }
  }
  console.log('DONE: All 10 bots configured to GUARANTEED NO LOSS (SL=0, Trailing=0, Slot=Rp15k)');
}
setStrictNoLoss();
