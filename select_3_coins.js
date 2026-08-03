const fetch = require('node-fetch');

async function find3NewCoins() {
  try {
    const res = await fetch('https://indodax.com/api/summaries');
    const data = await res.json();
    const existing = ['btc_idr', 'bico_idr', 'eth_idr', 'sol_idr'];

    const list = Object.entries(data.tickers || {})
      .map(([p, t]) => {
        const last = parseFloat(t.last || 0);
        const high = parseFloat(t.high || 0);
        const low = parseFloat(t.low || 0);
        const vol = parseFloat(t.vol_idr || 0);
        const range = low > 0 ? ((high - low) / low) * 100 : 0;
        return { pair: p, last, high, low, vol, range: parseFloat(range.toFixed(2)) };
      })
      .filter(x => x.pair.endsWith('_idr') && !existing.includes(x.pair) && x.vol > 2000000000) // Min Vol 2 Miliar IDR
      .sort((a, b) => b.range - a.range)
      .slice(0, 3);

    console.log('SELECTED_3_NEW_COINS:', JSON.stringify(list));
  } catch (e) {
    console.error('ERROR:', e.message);
  }
}
find3NewCoins();
