// RSI Strategy using technicalindicators
const { RSI } = require('technicalindicators');

function analyze({ priceHistory, config }) {
  const { period = 14, oversold = 30, overbought = 70 } = config;

  if (priceHistory.length < period + 1)
    return { signal: 'HOLD', reason: `need ${period + 1} candles, have ${priceHistory.length}` };

  const values = RSI.calculate({ values: priceHistory, period });
  const rsi = values[values.length - 1];

  if (rsi <= oversold)
    return { signal: 'BUY', reason: `RSI ${rsi.toFixed(2)} <= oversold ${oversold}` };
  if (rsi >= overbought)
    return { signal: 'SELL', reason: `RSI ${rsi.toFixed(2)} >= overbought ${overbought}` };

  return { signal: 'HOLD', reason: `RSI ${rsi.toFixed(2)} neutral` };
}

module.exports = { analyze };
