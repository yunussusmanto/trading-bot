const fs = require('fs');
const path = require('path');

const statePath = path.join(__dirname, 'bots_state.json');
let botsState = {};

if (fs.existsSync(statePath)) {
  botsState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

// Config targets for maximum profit yield deploying Rp 4.500.000 IDR liquidity
const configs = {
  // Top tier high-liquidity pairs (Rp 600.000 modal each = 5 slots x Rp 120.000)
  btc_idr:  { orderAmount: 600000, maxDcaOrders: 5, dcaStep: 2, takeProfitPercent: 3, stopLossPercent: 0, trailingPercent: 0, cooldownMinutes: 10, paperMode: false, mode: 'auto' },
  eth_idr:  { orderAmount: 600000, maxDcaOrders: 5, dcaStep: 2, takeProfitPercent: 3, stopLossPercent: 0, trailingPercent: 0, cooldownMinutes: 10, paperMode: false, mode: 'auto' },
  sol_idr:  { orderAmount: 600000, maxDcaOrders: 5, dcaStep: 2, takeProfitPercent: 3, stopLossPercent: 0, trailingPercent: 0, cooldownMinutes: 10, paperMode: false, mode: 'auto' },
  koma_idr: { orderAmount: 600000, maxDcaOrders: 5, dcaStep: 2, takeProfitPercent: 3, stopLossPercent: 0, trailingPercent: 0, cooldownMinutes: 10, paperMode: false, mode: 'auto' },
  xrp_idr:  { orderAmount: 600000, maxDcaOrders: 5, dcaStep: 2, takeProfitPercent: 3, stopLossPercent: 0, trailingPercent: 0, cooldownMinutes: 10, paperMode: false, mode: 'auto' },
  
  // Mid tier micro-cap / volatile pairs (Rp 300.000 modal each = 5 slots x Rp 60.000)
  bico_idr: { orderAmount: 300000, maxDcaOrders: 5, dcaStep: 2, takeProfitPercent: 3, stopLossPercent: 0, trailingPercent: 0, cooldownMinutes: 10, paperMode: false, mode: 'auto' },
  beat_idr: { orderAmount: 300000, maxDcaOrders: 5, dcaStep: 2, takeProfitPercent: 3, stopLossPercent: 0, trailingPercent: 0, cooldownMinutes: 10, paperMode: false, mode: 'auto' },
  bank_idr: { orderAmount: 300000, maxDcaOrders: 5, dcaStep: 2, takeProfitPercent: 3, stopLossPercent: 0, trailingPercent: 0, cooldownMinutes: 10, paperMode: false, mode: 'auto' },
  home_idr: { orderAmount: 300000, maxDcaOrders: 5, dcaStep: 2, takeProfitPercent: 3, stopLossPercent: 0, trailingPercent: 0, cooldownMinutes: 10, paperMode: false, mode: 'auto' },
  hype_idr: { orderAmount: 300000, maxDcaOrders: 5, dcaStep: 3, takeProfitPercent: 3, stopLossPercent: 0, trailingPercent: 0, cooldownMinutes: 10, paperMode: false, mode: 'auto' },
};

Object.keys(configs).forEach(pair => {
  const cfg = configs[pair];
  botsState[pair] = {
    running: true,
    mode: cfg.mode,
    strategy: 'multi_indicator',
    config: {
      intervalSeconds: 5,
      sizingMode: 'fixed',
      orderAmount: cfg.orderAmount,
      sizingValue: cfg.orderAmount,
      dailyLossLimit: 200000,
      stopLossPercent: cfg.stopLossPercent,
      takeProfitPercent: cfg.takeProfitPercent,
      trailingPercent: cfg.trailingPercent,
      cooldownMinutes: cfg.cooldownMinutes,
      paperMode: cfg.paperMode,
      rsiPeriod: 14,
      bbPeriod: 20,
      dcaStep: cfg.dcaStep,
      maxDcaOrders: cfg.maxDcaOrders,
    }
  };
});

fs.writeFileSync(statePath, JSON.stringify(botsState, null, 2));
console.log('🚀 MAXIMUM PROFIT DEPLOYMENT COMPLETED (TOTAL ALOKASI Rp 4.500.000 IDR):');
Object.keys(botsState).forEach(pair => {
  const c = botsState[pair].config;
  console.log(`- ${pair.toUpperCase()}: Modal Rp ${c.orderAmount.toLocaleString('id-ID')} | 5 Slots (Rp ${Math.round(c.orderAmount/c.maxDcaOrders).toLocaleString('id-ID')}/slot) | TP +${c.takeProfitPercent}% | SL ${c.stopLossPercent}%`);
});
