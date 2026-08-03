// Strategy Engine — routes to correct strategy
const threshold = require('./threshold');
const rsi = require('./rsi');
const multi_indicator = require('./multi_indicator');
const dca = require('./dca');

const strategies = { threshold, rsi, multi_indicator, dca };

function analyze({ strategy = 'threshold', price, priceHistory, config }) {
  const s = strategies[strategy];
  if (!s) return { signal: 'HOLD', reason: `unknown strategy: ${strategy}` };
  return s.analyze({ price, priceHistory, config });
}

module.exports = { analyze };
