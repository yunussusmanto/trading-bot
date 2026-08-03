// Auto DCA (Dollar Cost Averaging) Strategy
let lastDCATime = {};

function analyze({ price, priceHistory, config }) {
  const pair = config.pair || 'unknown'; // Note: pair might not be in config natively, we can pass it or rely on interval
  const intervalMinutes = config.dcaIntervalMinutes || 60;
  
  if (!lastDCATime[pair]) lastDCATime[pair] = 0;
  
  const now = Date.now();
  if (now - lastDCATime[pair] >= intervalMinutes * 60 * 1000) {
    lastDCATime[pair] = now;
    return { signal: 'BUY', reason: `DCA Interval Reached (${intervalMinutes}m)` };
  }
  
  return { signal: 'HOLD', reason: 'DCA waiting for next interval' };
}

module.exports = { analyze };
