const { RSI, MACD, BollingerBands } = require('technicalindicators');

function analyze({ priceHistory, config }) {
  const {
    rsiPeriod = 14,
    rsiOversold = 30,
    rsiOverbought = 70,
    bbPeriod = 20,
    bbStdDev = 2,
    macdFast = 12,
    macdSlow = 26,
    macdSignal = 9
  } = config;

  const minCandles = Math.max(rsiPeriod, bbPeriod, macdSlow) + 5;
  if (priceHistory.length < minCandles) {
    return { signal: 'HOLD', reason: `need ${minCandles} price points, have ${priceHistory.length}` };
  }

  // RSI
  const rsiVals = RSI.calculate({ values: priceHistory, period: rsiPeriod });
  const lastRSI = rsiVals[rsiVals.length - 1];

  // Bollinger Bands
  const bbVals = BollingerBands.calculate({ period: bbPeriod, stdDev: bbStdDev, values: priceHistory });
  const lastBB = bbVals[bbVals.length - 1];
  const lastPrice = priceHistory[priceHistory.length - 1];

  // MACD
  const macdVals = MACD.calculate({
    values: priceHistory,
    fastPeriod: macdFast,
    slowPeriod: macdSlow,
    signalPeriod: macdSignal,
    SimpleMAOscillator: false,
    SimpleMASignal: false
  });
  const lastMACD = macdVals[macdVals.length - 1];

  if (!lastRSI || !lastBB || !lastMACD) {
    return { signal: 'HOLD', reason: 'indicator calculation pending' };
  }

  const isOversold = lastRSI <= rsiOversold;
  const isOverbought = lastRSI >= rsiOverbought;
  const isBelowLowerBB = lastPrice <= lastBB.lower;
  const isAboveUpperBB = lastPrice >= lastBB.upper;
  const isMacdBullish = lastMACD.histogram > 0;
  const isMacdBearish = lastMACD.histogram < 0;

  // Buy Condition: RSI Oversold AND Price <= Lower BB AND MACD Histogram Bullish
  if (isOversold && isBelowLowerBB && isMacdBullish) {
    return {
      signal: 'BUY',
      reason: `RSI (${lastRSI.toFixed(1)}) oversold + Price <= Lower BB + MACD Bullish`
    };
  }

  // Sell Condition: RSI Overbought AND Price >= Upper BB AND MACD Histogram Bearish
  if (isOverbought && isAboveUpperBB && isMacdBearish) {
    return {
      signal: 'SELL',
      reason: `RSI (${lastRSI.toFixed(1)}) overbought + Price >= Upper BB + MACD Bearish`
    };
  }

  return {
    signal: 'HOLD',
    reason: `RSI: ${lastRSI.toFixed(1)} | BB Band: [${lastBB.lower.toFixed(0)} - ${lastBB.upper.toFixed(0)}] | MACD Hist: ${lastMACD.histogram ? lastMACD.histogram.toFixed(2) : 0}`
  };
}

module.exports = { analyze };
