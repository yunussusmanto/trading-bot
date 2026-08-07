const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.POSTGRES_HOST || '127.0.0.1',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  user: process.env.POSTGRES_USER || 'n8n_user',
  password: process.env.POSTGRES_PASSWORD || 'GantiDenganPasswordYangKuat123!',
  database: process.env.POSTGRES_DB || 'trading_bot',
  max: 10,
  idleTimeoutMillis: 30000,
});

async function initDb() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS trades (
        id VARCHAR(100) PRIMARY KEY,
        pair VARCHAR(50),
        action VARCHAR(20),
        price NUMERIC,
        amount NUMERIC,
        pnl NUMERIC,
        reason TEXT,
        timestamp BIGINT,
        paper BOOLEAN DEFAULT FALSE
      )
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS equity_snapshots (
        id SERIAL PRIMARY KEY,
        total_value NUMERIC,
        timestamp TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS bot_configs (
        pair VARCHAR(50) PRIMARY KEY,
        running BOOLEAN DEFAULT TRUE,
        mode VARCHAR(50),
        strategy VARCHAR(50),
        config JSONB,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_settings (
        key VARCHAR(255) PRIMARY KEY,
        value TEXT
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'trader',
        permissions JSONB DEFAULT '{}'::jsonb,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Seed default admin account if table is empty
    const userCheck = await pool.query('SELECT COUNT(*) FROM users');
    if (parseInt(userCheck.rows[0].count) === 0) {
      const crypto = require('crypto');
      const salt = crypto.randomBytes(16).toString('hex');
      const pass = process.env.ADMIN_PASS || 'R@sendriya#2024';
      const hash = `${salt}:${crypto.pbkdf2Sync(pass, salt, 10000, 64, 'sha512').toString('hex')}`;
      const defaultPerms = JSON.stringify({
        panel_robot: true,
        panel_manual: true,
        panel_orders: true,
        panel_reports: true,
        panel_admin: true
      });
      await pool.query(
        `INSERT INTO users (username, password_hash, role, permissions) VALUES ($1, $2, $3, $4)`,
        ['admin', hash, 'admin', defaultPerms]
      );
      console.log('Default superadmin user (admin) created.');
    }

    console.log('PostgreSQL trading_bot database initialized successfully.');
  } catch (err) {
    console.error('PostgreSQL init error:', err.message);
  }
}

initDb();

async function addTrade(t) {
  const query = `
    INSERT INTO trades (id, pair, action, price, amount, pnl, reason, timestamp, paper)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (id) DO UPDATE SET
      price = EXCLUDED.price,
      amount = EXCLUDED.amount,
      pnl = EXCLUDED.pnl,
      reason = EXCLUDED.reason,
      timestamp = EXCLUDED.timestamp,
      paper = EXCLUDED.paper
  `;
  const values = [
    t.id || `trade-${Date.now()}`,
    t.pair,
    t.action,
    t.price,
    t.amount,
    t.pnl || 0,
    t.reason || '',
    t.timestamp || Date.now(),
    t.paper || false
  ];
  await pool.query(query, values);
  return t;
}

async function getTrades(limit = 100) {
  const res = await pool.query(
    `SELECT id, pair, action, price::float, amount::float, pnl::float, reason, timestamp::bigint, paper FROM trades ORDER BY timestamp DESC LIMIT $1`,
    [limit]
  );
  return res.rows.map(r => ({
    ...r,
    timestamp: parseInt(r.timestamp),
  }));
}

async function getTodayLoss(pair) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const ts = startOfDay.getTime();

  const res = await pool.query(
    `SELECT SUM(ABS(pnl)) as total_loss FROM trades WHERE timestamp >= $1 AND pnl < 0`,
    [ts]
  );
  return parseFloat(res.rows[0]?.total_loss || 0);
}

async function getPnLSummary() {
  const now = new Date();
  
  const startOfDay = new Date(now).setHours(0,0,0,0);
  
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0,0,0,0);
  
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  const res = await pool.query(`
    SELECT 
      SUM(CASE WHEN timestamp >= $1 THEN pnl ELSE 0 END) as today,
      SUM(CASE WHEN timestamp >= $2 THEN pnl ELSE 0 END) as week,
      SUM(CASE WHEN timestamp >= $3 THEN pnl ELSE 0 END) as month,
      SUM(pnl) as all_time
    FROM trades
  `, [startOfDay, startOfWeek.getTime(), startOfMonth]);

  return {
    today: parseFloat(res.rows[0]?.today || 0),
    week: parseFloat(res.rows[0]?.week || 0),
    month: parseFloat(res.rows[0]?.month || 0),
    total: parseFloat(res.rows[0]?.all_time || 0),
    allTime: parseFloat(res.rows[0]?.all_time || 0)
  };
}

async function addEquitySnapshot(totalValue) {
  await pool.query('INSERT INTO equity_snapshots (total_value) VALUES ($1)', [totalValue]);
}

async function getEquityCurve(days = 7) {
  const res = await pool.query(`
    SELECT total_value as value, timestamp 
    FROM equity_snapshots 
    WHERE timestamp >= NOW() - INTERVAL '1 day' * $1
    ORDER BY timestamp ASC
  `, [days]);
  return res.rows;
}

async function saveBotConfig(pair, running, mode, strategy, config) {
  try {
    await pool.query(`
      INSERT INTO bot_configs (pair, running, mode, strategy, config, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (pair) DO UPDATE SET
        running = EXCLUDED.running,
        mode = EXCLUDED.mode,
        strategy = EXCLUDED.strategy,
        config = EXCLUDED.config,
        updated_at = NOW()
    `, [pair, running, mode, strategy, JSON.stringify(config || {})]);
  } catch (_) {}
}

async function getActiveBotConfigs() {
  try {
    const res = await pool.query(`SELECT pair, running, mode, strategy, config FROM bot_configs WHERE running = TRUE`);
    return res.rows.map(r => ({
      pair: r.pair,
      running: r.running,
      mode: r.mode,
      strategy: r.strategy,
      config: typeof r.config === 'string' ? JSON.parse(r.config) : r.config
    }));
  } catch (_) {
    return [];
  }
}

async function getDailyReportByDate(dateStr) {
  try {
    const targetDate = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
    const startTs = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 0, 0, 0, 0).getTime();
    const endTs = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 23, 59, 59, 999).getTime();

    const summaryRes = await pool.query(`
      SELECT 
        COALESCE(SUM(pnl), 0) as total_pnl,
        COUNT(*) as total_trades,
        COUNT(CASE WHEN pnl >= 0 THEN 1 END) as win_trades
      FROM trades
      WHERE timestamp >= $1 AND timestamp <= $2
    `, [startTs, endTs]);

    const tradesRes = await pool.query(`
      SELECT id, pair, action, price::float, amount::float, pnl::float, reason, timestamp::bigint 
      FROM trades 
      WHERE timestamp >= $1 AND timestamp <= $2 
      ORDER BY timestamp DESC
    `, [startTs, endTs]);

    const row = summaryRes.rows[0] || {};
    return {
      date: dateStr || new Date().toISOString().split('T')[0],
      totalPnl: parseFloat(row.total_pnl || 0),
      totalTrades: parseInt(row.total_trades || 0),
      winTrades: parseInt(row.win_trades || 0),
      trades: tradesRes.rows.map(r => ({ ...r, timestamp: parseInt(r.timestamp) }))
    };
  } catch (err) {
    return { date: dateStr, totalPnl: 0, totalTrades: 0, winTrades: 0, trades: [] };
  }
}

async function getSetting(key) {
  try {
    const res = await pool.query('SELECT value FROM user_settings WHERE key = $1', [key]);
    return res.rows[0]?.value || null;
  } catch (_) { return null; }
}

async function saveSetting(key, value) {
  try {
    await pool.query(`
      INSERT INTO user_settings (key, value) VALUES ($1, $2)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `, [key, value]);
  } catch (_) {}
}

async function getProfitPerCoin() {
  try {
    const res = await pool.query(`
      SELECT 
        pair, 
        COUNT(*) as trade_count, 
        SUM(pnl) as total_profit
      FROM trades 
      WHERE action = 'SELL' 
      GROUP BY pair 
      ORDER BY total_profit DESC
    `);
    return res.rows;
  } catch (_) { return []; }
}

const crypto = require('crypto');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash) return false;
  if (!storedHash.includes(':')) {
    return password === (process.env.ADMIN_PASS || 'R@sendriya#2024');
  }
  const [salt, originalHash] = storedHash.split(':');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return hash === originalHash;
}

async function getAllUsers() {
  try {
    const res = await pool.query('SELECT id, username, role, permissions, is_active, created_at FROM users ORDER BY id ASC');
    return res.rows;
  } catch (err) {
    return [];
  }
}

async function getUserById(id) {
  try {
    const res = await pool.query('SELECT id, username, role, permissions, is_active, created_at FROM users WHERE id = $1', [id]);
    return res.rows[0] || null;
  } catch (err) {
    return null;
  }
}

async function getUserByUsername(username) {
  try {
    const res = await pool.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    return res.rows[0] || null;
  } catch (err) {
    return null;
  }
}

async function createUser({ username, password, role = 'trader', permissions = {} }) {
  const hash = hashPassword(password);
  const res = await pool.query(
    `INSERT INTO users (username, password_hash, role, permissions) VALUES ($1, $2, $3, $4) RETURNING id, username, role, permissions, is_active`,
    [username, hash, role, JSON.stringify(permissions)]
  );
  return res.rows[0];
}

async function updateUser(id, { password, role, permissions, is_active }) {
  let query = 'UPDATE users SET ';
  const params = [];
  let paramIdx = 1;

  if (password) {
    query += `password_hash = $${paramIdx++}, `;
    params.push(hashPassword(password));
  }
  if (role !== undefined) {
    query += `role = $${paramIdx++}, `;
    params.push(role);
  }
  if (permissions !== undefined) {
    query += `permissions = $${paramIdx++}, `;
    params.push(JSON.stringify(permissions));
  }
  if (is_active !== undefined) {
    query += `is_active = $${paramIdx++}, `;
    params.push(is_active);
  }

  query = query.slice(0, -2) + ` WHERE id = $${paramIdx} RETURNING id, username, role, permissions, is_active`;
  params.push(id);

  const res = await pool.query(query, params);
  return res.rows[0];
}

async function deleteUser(id) {
  await pool.query('DELETE FROM users WHERE id = $1 AND LOWER(username) != \'admin\'', [id]);
  return true;
}

module.exports = {
  addTrade,
  getTrades,
  getTodayLoss,
  getPnLSummary,
  getDailyReportByDate,
  addEquitySnapshot,
  getEquityCurve,
  saveBotConfig,
  getActiveBotConfigs,
  getSetting,
  saveSetting,
  getProfitPerCoin,
  hashPassword,
  verifyPassword,
  getAllUsers,
  getUserById,
  getUserByUsername,
  createUser,
  updateUser,
  deleteUser
};
