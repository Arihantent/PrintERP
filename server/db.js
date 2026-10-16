// MySQL / MariaDB connection pool.
// Reads DATABASE_URL (mysql://user:pass@host:3306/name) or the separate DB_* variables.
const mysql = require('mysql2/promise');

function configFromEnv() {
  const base = {
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_POOL_SIZE) || 8,
    charset: 'utf8mb4',
    dateStrings: true,
    supportBigNumbers: true,
    multipleStatements: false,
  };
  if (process.env.DATABASE_URL) {
    const u = new URL(process.env.DATABASE_URL);
    return {
      ...base,
      host: u.hostname,
      port: Number(u.port) || 3306,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: decodeURIComponent(u.pathname.replace(/^\//, '')),
    };
  }
  return {
    ...base,
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  };
}

let pool;
function getPool() {
  if (!pool) pool = mysql.createPool(configFromEnv());
  return pool;
}

async function query(sql, params) {
  const [rows] = await getPool().query(sql, params);
  return rows;
}

module.exports = { getPool, query, configFromEnv };
