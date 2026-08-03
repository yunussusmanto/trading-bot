const { Pool } = require('pg');
const pool = new Pool({
  host: '127.0.0.1', port: 5432,
  user: 'n8n_user',
  password: 'GantiDenganPasswordYangKuat123!',
  database: 'trading_bot'
});
async function run() {
  try {
    await pool.query('ALTER TABLE trades ADD COLUMN IF NOT EXISTS paper BOOLEAN DEFAULT FALSE');
    console.log('OK: paper column added');
  } catch(e) {
    console.error('ERROR:', e.message);
  }
  pool.end();
}
run();
