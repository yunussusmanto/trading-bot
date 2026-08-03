let ws = null;
let vpsUrl = '';
const prices = {};

// Load saved VPS URL
chrome.storage.local.get('vpsUrl', data => {
  if (data.vpsUrl) {
    document.getElementById('vps-url').value = data.vpsUrl;
    vpsUrl = data.vpsUrl;
    connectVPS();
  }
});

function connectVPS() {
  vpsUrl = document.getElementById('vps-url').value.trim().replace(/\/$/, '');
  if (!vpsUrl) return;
  chrome.storage.local.set({ vpsUrl });
  document.getElementById('dashboard-link').href = vpsUrl;

  const wsUrl = vpsUrl.replace('http', 'ws');
  if (ws) ws.close();
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    setConnected(true);
    loadStatus();
    loadApprovals();
  };
  ws.onclose = () => { setConnected(false); setTimeout(connectVPS, 5000); };
  ws.onmessage = e => handleMsg(JSON.parse(e.data));
}

function setConnected(ok) {
  document.getElementById('ws-dot').className = `dot ${ok ? '' : 'off'}`;
  document.getElementById('ws-status').textContent = ok ? 'Connected' : 'Disconnected';
}

function handleMsg(msg) {
  if (msg.type === 'price') {
    prices[msg.pair] = msg.price;
    renderPrices();
  } else if (msg.type === 'approval_request') {
    loadApprovals();
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' });
    chrome.notifications?.create({ type: 'basic', iconUrl: 'icon.png', title: 'Trading Bot', message: `${msg.signal} ${msg.pair} @ ${fmtIDR(msg.price)}` });
  } else if (msg.type === 'bot_status') {
    loadStatus();
  } else if (msg.type === 'trade') {
    loadStatus();
  }
}

async function loadStatus() {
  try {
    const res = await fetch(`${vpsUrl}/api/bot/status`);
    const bots = await res.json();
    const running = bots.filter(b => b.running).length;
    document.getElementById('stat-bots').textContent = running;
  } catch (_) {}
}

async function loadApprovals() {
  try {
    const res = await fetch(`${vpsUrl}/api/approvals`);
    const data = await res.json();
    document.getElementById('stat-approvals').textContent = data.length;
    const list = document.getElementById('approvals-list');
    if (!data.length) {
      list.innerHTML = '<div class="empty">Tidak ada pending</div>';
      chrome.action.setBadgeText({ text: '' });
      return;
    }
    list.innerHTML = data.map(a => `
      <div class="approval">
        <div class="approval-title">${a.signal} ${a.pair.replace('idr','').toUpperCase()}/IDR</div>
        <div class="approval-sub">${fmtIDR(a.price)} · ${a.reason}</div>
        <div class="approval-btns">
          <button class="btn-green" onclick="approve('${a.id}', true)">✓ Approve</button>
          <button class="btn-red" onclick="approve('${a.id}', false)">✗ Reject</button>
        </div>
      </div>
    `).join('');
  } catch (_) {}
}

async function approve(id, approved) {
  await fetch(`${vpsUrl}/api/approve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, approved }),
  });
  loadApprovals();
}

async function quickStart() {
  const pair = document.getElementById('q-pair').value.toLowerCase();
  const mode = document.getElementById('q-mode').value;
  await fetch(`${vpsUrl}/api/bot/start`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pair, mode, strategy: 'rsi', config: { intervalSeconds: 10 } }),
  });
  loadStatus();
}

async function quickStop() {
  const pair = document.getElementById('q-pair').value.toLowerCase();
  await fetch(`${vpsUrl}/api/bot/stop`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pair }),
  });
  loadStatus();
}

function renderPrices() {
  const el = document.getElementById('price-display');
  const entries = Object.entries(prices);
  if (!entries.length) { el.innerHTML = '<div class="empty">Belum ada data</div>'; return; }
  el.innerHTML = entries.map(([pair, price]) =>
    `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #1e2d45">
      <span style="font-weight:600;text-transform:uppercase">${pair.replace('idr','').toUpperCase()}/IDR</span>
      <span style="font-family:monospace;color:#10b981">${fmtIDR(price)}</span>
    </div>`
  ).join('');
}

function fmtIDR(n) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);
}
