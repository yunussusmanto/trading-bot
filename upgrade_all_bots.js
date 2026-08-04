const fs = require('fs');
const path = require('path');

const statePath = path.join(__dirname, 'bots_state.json');
let botsState = {};

if (fs.existsSync(statePath)) {
  botsState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

// Upgrade BICO_IDR along with top high-yield coins to Rp 1.000.000 modal each (Rp 200.000 / slot)
const focusedConfigs = {
  bico_idr: { orderAmount: 1000000, maxDcaOrders: 5, dcaStep: 1.5, takeProfitPercent: 3, stopLossPercent: 0, trailingPercent: 0, cooldownMinutes: 3, paperMode: false, mode: 'auto' },
  koma_idr: { orderAmount: 1000000, maxDcaOrders: 5, dcaStep: 1.5, takeProfitPercent: 3, stopLossPercent: 0, trailingPercent: 0, cooldownMinutes: 3, paperMode: false, mode: 'auto' },
  xrp_idr:  { orderAmount: 1000000, maxDcaOrders: 5, dcaStep: 1.5, takeProfitPercent: 3, stopLossPercent: 0, trailingPercent: 0, cooldownMinutes: 3, paperMode: false, mode: 'auto' },
  sol_idr:  { orderAmount: 1000000, maxDcaOrders: 5, dcaStep: 1.5, takeProfitPercent: 3, stopLossPercent: 0, trailingPercent: 0, cooldownMinutes: 3, paperMode: false, mode: 'auto' },
  btc_idr:  { orderAmount: 1000000, maxDcaOrders: 5, dcaStep: 1.5, takeProfitPercent: 3, stopLossPercent: 0, trailingPercent: 0, cooldownMinutes: 3, paperMode: false, mode: 'auto' },
  eth_idr:  { orderAmount: 1000000, maxDcaOrders: 5, dcaStep: 1.5, takeProfitPercent: 3, stopLossPercent: 0, trailingPercent: 0, cooldownMinutes: 3, paperMode: false, mode: 'auto' },
};

const newBotsState = {};

Object.keys(focusedConfigs).forEach(pair => {
  const cfg = focusedConfigs[pair];
  newBotsState[pair] = {
    running: true,
    mode: cfg.mode,
    strategy: 'multi_indicator',
    config: {
      intervalSeconds: 5,
      sizingMode: 'fixed',
      orderAmount: cfg.orderAmount,
      sizingValue: cfg.orderAmount,
      dailyLossLimit: 300000,
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

fs.writeFileSync(statePath, JSON.stringify(newBotsState, null, 2));
console.log('🚀 BICO_IDR UPGRADED TO Rp 1.000.000 MODAL (Rp 200.000 / SLOT):');
Object.keys(newBotsState).forEach(pair => {
  const c = newBotsState[pair].config;
  console.log(`- ${pair.toUpperCase()}: Modal Rp ${c.orderAmount.toLocaleString('id-ID')} | Entry Slot Rp ${Math.round(c.orderAmount/c.maxDcaOrders).toLocaleString('id-ID')}`);
});
