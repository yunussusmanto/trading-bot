const fs = require('fs');
const path = require('path');

const statePath = path.join(__dirname, 'bots_state.json');
let botsState = {};

if (fs.existsSync(statePath)) {
  botsState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

// Config targets for maximum safe profit with Rp 5.000.000 IDR liquidity
const configs = {
  // Top tier high-liquidity pairs (Rp 300.000 modal each = 5 slots x Rp 60.000)
  btc_idr:  { orderAmount: 300000, maxDcaOrders: 5, dcaStep: 2, takeProfitPercent: 3, stopLossPercent: 0, trailingPercent: 0, cooldownMinutes: 15, paperMode: false, mode: 'auto' },
  eth_idr:  { orderAmount: 300000, maxDcaOrders: 5, dcaStep: 2, takeProfitPercent: 3, stopLossPercent: 0, trailingPercent: 0, cooldownMinutes: 15, paperMode: false, mode: 'auto' },
  sol_idr:  { orderAmount: 300000, maxDcaOrders: 5, dcaStep: 2, takeProfitPercent: 3, stopLossPercent: 0, trailingPercent: 0, cooldownMinutes: 15, paperMode: false, mode: 'auto' },
  koma_idr: { orderAmount: 300000, maxDcaOrders: 5, dcaStep: 2, takeProfitPercent: 3, stopLossPercent: 0, trailingPercent: 0, cooldownMinutes: 15, paperMode: false, mode: 'auto' },
  xrp_idr:  { orderAmount: 300000, maxDcaOrders: 5, dcaStep: 2, takeProfitPercent: 3, stopLossPercent: 0, trailingPercent: 0, cooldownMinutes: 15, paperMode: false, mode: 'auto' },
  
  // Mid tier pairs (Rp 100.000 modal each = 5 slots x Rp 20.000)
  bico_idr: { orderAmount: 100000, maxDcaOrders: 5, dcaStep: 2, takeProfitPercent: 3, stopLossPercent: 0, trailingPercent: 0, cooldownMinutes: 15, paperMode: false, mode: 'auto' },
  beat_idr: { orderAmount: 100000, maxDcaOrders: 5, dcaStep: 2, takeProfitPercent: 3, stopLossPercent: 0, trailingPercent: 0, cooldownMinutes: 15, paperMode: false, mode: 'auto' },
  bank_idr: { orderAmount: 100000, maxDcaOrders: 5, dcaStep: 2, takeProfitPercent: 3, stopLossPercent: 0, trailingPercent: 0, cooldownMinutes: 15, paperMode: false, mode: 'auto' },
  home_idr: { orderAmount: 100000, maxDcaOrders: 5, dcaStep: 2, takeProfitPercent: 3, stopLossPercent: 0, trailingPercent: 0, cooldownMinutes: 15, paperMode: false, mode: 'auto' },
  hype_idr: { orderAmount: 100000, maxDcaOrders: 5, dcaStep: 5, takeProfitPercent: 3, stopLossPercent: 0, trailingPercent: 0, cooldownMinutes: 15, paperMode: false, mode: 'auto' },
};

Object.keys(configs).forEach(pair => {
  const cfg = configs[pair];
  botsState[pair] = {
    running: true,
    mode: cfg.mode,
    strategy: 'multi_indicator',
    config: {
      intervalSeconds: 10,
      sizingMode: 'fixed',
      orderAmount: cfg.orderAmount,
      sizingValue: cfg.orderAmount,
      dailyLossLimit: 100000,
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
console.log('✅ ALL 10 BOTS UPGRADED SUCCESSFULLY:');
Object.keys(botsState).forEach(pair => {
  const c = botsState[pair].config;
  console.log(`- ${pair.toUpperCase()}: Modal Rp ${c.orderAmount.toLocaleString('id-ID')} | ${c.maxDcaOrders} Slots (Rp ${Math.round(c.orderAmount/c.maxDcaOrders).toLocaleString('id-ID')}/slot) | TP +${c.takeProfitPercent}% | SL ${c.stopLossPercent}%`);
});
