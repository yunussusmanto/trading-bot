// Simple threshold strategy
// BUY if price <= buyAt, SELL if price >= sellAt

function analyze({ price, config }) {
  const { buyAt, sellAt } = config;
  if (!buyAt || !sellAt) return { signal: 'HOLD', reason: 'threshold not configured' };

  if (parseFloat(price) <= parseFloat(buyAt))
    return { signal: 'BUY', reason: `price ${price} <= buyAt ${buyAt}` };
  if (parseFloat(price) >= parseFloat(sellAt))
    return { signal: 'SELL', reason: `price ${price} >= sellAt ${sellAt}` };

  return { signal: 'HOLD', reason: `price ${price} between ${buyAt}-${sellAt}` };
}

module.exports = { analyze };
