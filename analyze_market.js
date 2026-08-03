const fetch = require('node-fetch');

async function analyze() {
  try {
    const res = await fetch('https://indodax.com/api/summaries');
    const data = await res.json();
    const list = Object.entries(data.tickers || {})
      .map(([p, t]) => {
        const last = parseFloat(t.last || 0);
        const high = parseFloat(t.high || 0);
        const low = parseFloat(t.low || 0);
        const vol = parseFloat(t.vol_idr || 0);
        const range = low > 0 ? ((high - low) / low) * 100 : 0;
        return { pair: p, last, high, low, vol, range: parseFloat(range.toFixed(2)) };
      })
      .filter(x => x.pair.endsWith('_idr') && x.vol > 1000000000) // Min Vol 1 Miliar IDR (Cair)
      .sort((a, b) => b.range - a.range)
      .slice(0, 5);

    console.log('TOP_VOLATILE_PAIRS:', JSON.stringify(list));
  } catch (e) {
    console.error('ERROR:', e.message);
  }
}
analyze();
