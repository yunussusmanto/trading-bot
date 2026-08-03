const engine = require('./engine');

function runBacktest({ priceHistory, strategy = 'threshold', config = {}, initialCapital = 1000000 }) {
  if (!priceHistory || priceHistory.length < 20) {
    return { error: 'Insufficient price history for backtesting (min 20 points)' };
  }

  // Auto-populate threshold config if missing
  const avgPrice = priceHistory.reduce((a, b) => a + b, 0) / priceHistory.length;
  const cfg = { ...config };
  if (strategy === 'threshold') {
    if (!cfg.buyAt) cfg.buyAt = Math.round(avgPrice * 0.99);
    if (!cfg.sellAt) cfg.sellAt = Math.round(avgPrice * 1.01);
  }

  let capital = initialCapital;
  let holdings = 0; // amount of asset held
  let trades = [];
  let peakCapital = initialCapital;
  let maxDrawdown = 0;
  let inPosition = false;
  let entryPrice = 0;

  for (let i = 15; i < priceHistory.length; i++) {
    const currentHistory = priceHistory.slice(0, i + 1);
    const currentPrice = priceHistory[i];

    const result = engine.analyze({
      strategy,
      price: currentPrice,
      priceHistory: currentHistory,
      config: cfg
    });

    if (result.signal === 'BUY' && !inPosition) {
      const amountToInvest = config.sizingMode === 'percentage'
        ? capital * ((config.sizingValue || 10) / 100)
        : Math.min(capital, config.orderAmount || 100000);

      if (amountToInvest >= 10000) {
        holdings = amountToInvest / currentPrice;
        capital -= amountToInvest;
        inPosition = true;
        entryPrice = currentPrice;

        trades.push({
          type: 'BUY',
          price: currentPrice,
          amount: amountToInvest,
          index: i
        });
      }
    } else if (result.signal === 'SELL' && inPosition) {
      const returnAmount = holdings * currentPrice;
      const buyTrade = trades[trades.length - 1];
      const pnl = returnAmount - buyTrade.amount;
      const pnlPercent = (pnl / buyTrade.amount) * 100;

      capital += returnAmount;
      holdings = 0;
      inPosition = false;

      trades.push({
        type: 'SELL',
        price: currentPrice,
        amount: returnAmount,
        pnl,
        pnlPercent,
        index: i
      });
    }

    // Calculate current portfolio value for drawdown
    const currentValue = capital + (inPosition ? holdings * currentPrice : 0);
    if (currentValue > peakCapital) peakCapital = currentValue;
    const drawdown = ((peakCapital - currentValue) / peakCapital) * 100;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  // Force close remaining position at last price for final stats
  if (inPosition) {
    const finalPrice = priceHistory[priceHistory.length - 1];
    const returnAmount = holdings * finalPrice;
    const buyTrade = trades[trades.length - 1];
    const pnl = returnAmount - buyTrade.amount;
    const pnlPercent = (pnl / buyTrade.amount) * 100;

    capital += returnAmount;
    holdings = 0;
    trades.push({
      type: 'SELL (FINAL)',
      price: finalPrice,
      amount: returnAmount,
      pnl,
      pnlPercent,
      index: priceHistory.length - 1
    });
  }

  const sellTrades = trades.filter(t => t.type.startsWith('SELL'));
  const winningTrades = sellTrades.filter(t => t.pnl > 0);
  const winRate = sellTrades.length ? (winningTrades.length / sellTrades.length) * 100 : 0;
  const netProfit = capital - initialCapital;
  const netProfitPercent = (netProfit / initialCapital) * 100;

  return {
    initialCapital,
    finalCapital: Math.round(capital),
    netProfit: Math.round(netProfit),
    netProfitPercent: parseFloat(netProfitPercent.toFixed(2)),
    totalTrades: sellTrades.length,
    winRate: parseFloat(winRate.toFixed(2)),
    maxDrawdown: parseFloat(maxDrawdown.toFixed(2)),
    trades
  };
}

module.exports = { runBacktest };
