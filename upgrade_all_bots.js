const fs = require('fs');
const path = require('path');

const statePath = path.join(__dirname, 'bots_state.json');
let botsState = {};

if (fs.existsSync(statePath)) {
  botsState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

// Config targets for maximum profit acceleration (15 Active Bots)
const configs = {
  // Top tier high-liquidity pairs (Rp 600.000 modal each = 5 slots x Rp 120.000)
  btc_idr:  { orderAmount: 600000, maxDcaOrders: 5, dcaStep: 1.5, takeProfitPercent: 3, stopLossPercent: 0, trailingPercent: 0, cooldownMinutes: 3, paperMode: false, mode: 'auto' },
  eth_idr:  { orderAmount: 600000, maxDcaOrders: 5, dcaStep: 1.5, takeProfitPercent: 3, stopLossPercent: 0, trailingPercent: 0, cooldownMinutes: 3, paperMode: false, mode: 'auto' },
  sol_idr:  { orderAmount: 600000, maxDcaOrders: 5, dcaStep: 1.5, takeProfitPercent: 3, stopLossPercent: 0, trailingPercent: 0, cooldownMinutes: 3, paperMode: false, mode: 'auto' },
  koma_idr: { orderAmount: 600000, maxDcaOrders: 5, dcaStep: 1.5, takeProfitPercent: 3, stopLossPercent: 0, trailingPercent: 0, cooldownMinutes: 3, paperMode: false, mode: 'auto' },
  xrp_idr:  { orderAmount: 600000, maxDcaOrders: 5, dcaStep: 1.5, takeProfitPercent: 3, stopLossPercent: 0, trailingPercent: 0, cooldownMinutes: 3, paperMode: false, mode: 'auto' },
  
  // Mid tier pairs (Rp 300.000 modal each = 5 slots x Rp 60.000)
  bico_idr: { orderAmount: 300000, maxDcaOrders: 5, dcaStep: 1.5, takeProfitPercent: 3, stopLossPercent: 0, trailingPercent: 0, cooldownMinutes: 3, paperMode: false, mode: 'auto' },
  beat_idr: { orderAmount: 300000, maxDcaOrders: 5, dcaStep: 1.5, takeProfitPercent: 3, stopLossPercent: 0, trailingPercent: 0, cooldownMinutes: 3, paperMode: false, mode: 'auto' },
  bank_idr: { orderAmount: 300000, maxDcaOrders: 5, dcaStep: 1.5, takeProfitPercent: 3, stopLossPercent: 0, trailingPercent: 0, cooldownMinutes: 3, paperMode: false, mode: 'auto' },
  home_idr: { orderAmount: 300000, maxDcaOrders: 5, dcaStep: 1.5, takeProfitPercent: 3, stopLossPercent: 0, trailingPercent: 0, cooldownMinutes: 3, paperMode: false, mode: 'auto' },
  hype_idr: { orderAmount: 300000, maxDcaOrders: 5, dcaStep: 2.0, takeProfitPercent: 3, stopLossPercent: 0, trailingPercent: 0, cooldownMinutes: 3, paperMode: false, mode: 'auto' },

  // New High-Volatility Meme & Momentum Pairs (Rp 200.000 modal each = 5 slots x Rp 40.000)
  pepe_idr: { orderAmount: 200000, maxDcaOrders: 5, dcaStep: 1.5, takeProfitPercent: 3, stopLossPercent: 0, trailingPercent: 0, cooldownMinutes: 3, paperMode: false, mode: 'auto' },
  doge_idr: { orderAmount: 200000, maxDcaOrders: 5, dcaStep: 1.5, takeProfitPercent: 3, stopLossPercent: 0, trailingPercent: 0, cooldownMinutes: 3, paperMode: false, mode: 'auto' },
  ada_idr:  { orderAmount: 200000, maxDcaOrders: 5, dcaStep: 1.5, takeProfitPercent: 3, stopLossPercent: 0, trailingPercent: 0, cooldownMinutes: 3, paperMode: false, mode: 'auto' },
  near_idr: { orderAmount: 200000, maxDcaOrders: 5, dcaStep: 1.5, takeProfitPercent: 3, stopLossPercent: 0, trailingPercent: 0, cooldownMinutes: 3, paperMode: false, mode: 'auto' },
  shib_idr: { orderAmount: 200000, maxDcaOrders: 5, dcaStep: 1.5, takeProfitPercent: 3, stopLossPercent: 0, trailingPercent: 0, cooldownMinutes: 3, paperMode: false, mode: 'auto' },
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
console.log('⚡ 15 ACTIVE BOTS ACCELERATION SETUP COMPLETED:');
Object.keys(botsState).forEach(pair => {
  const c = botsState[pair].config;
  console.log(`- ${pair.toUpperCase()}: Modal Rp ${c.orderAmount.toLocaleString('id-ID')} | DCA Step ${c.dcaStep}% | Cooldown ${c.cooldownMinutes}m | TP +${c.takeProfitPercent}% | SL ${c.stopLossPercent}%`);
});
