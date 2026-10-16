// Migration runner.
//   npm run migrate        -> applies every database/migrations/*.sql not yet applied,
//                             then makes sure at least one owner login exists.
// It also runs automatically when the server starts (set RUN_MIGRATIONS_ON_START=false to stop that).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { getPool } = require('./db');
const { APP } = require('./rules');

const DIR = path.join(__dirname, '..', 'database', 'migrations');

function splitSql(sql) {
  // Statements end with ";" at the end of a line. Comment lines are dropped.
  return sql
    .split('\n')
    .filter((l) => !/^\s*--/.test(l))
    .join('\n')
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function runMigrations({ log = console.log } = {}) {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(191) NOT NULL PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    const [doneRows] = await conn.query('SELECT name FROM schema_migrations');
    const done = new Set(doneRows.map((r) => r.name));
    const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();

    for (const f of files) {
      if (done.has(f)) continue;
      log(`applying ${f}`);
      const stmts = splitSql(fs.readFileSync(path.join(DIR, f), 'utf8'));
      for (const s of stmts) await conn.query(s);
      await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [f]);
    }

    await ensureOwner(conn, log);
    log('database is up to date');
  } finally {
    conn.release();
  }
}

async function ensureOwner(conn, log) {
  const [[{ n }]] = await conn.query("SELECT COUNT(*) AS n FROM users WHERE role='owner' AND active=1");
  if (n > 0) return;
  const username = (process.env.OWNER_USERNAME || 'owner').trim().toLowerCase();
  const password = process.env.OWNER_PASSWORD || 'ChangeMe@123';
  const name = process.env.OWNER_NAME || 'Owner';
  const id = process.env.OWNER_ID || APP.defaultOwnerId;
  const hash = await bcrypt.hash(password, 10);
  await conn.query(
    `INSERT INTO users (id, username, name, password_hash, role, active, must_change_password)
     VALUES (?, ?, ?, ?, 'owner', 1, ?)
     ON DUPLICATE KEY UPDATE role='owner', active=1`,
    [id, username, name, hash, process.env.OWNER_PASSWORD ? 0 : 1]
  );
  log(`created owner login "${username}"${process.env.OWNER_PASSWORD ? '' : ' with temporary password ChangeMe@123 (must be changed at first login)'}`);
}

module.exports = { runMigrations, splitSql };

if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('Migration failed:', e.message);
      process.exit(1);
    });
}
