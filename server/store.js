// Record store on top of MySQL. Each record is one row in `documents` (JSON in `data`).
// Mirrors the small set of operations the app screens use: read a record, list/filter a
// record type, save, delete, and a short lease (lock) used for running numbers.
const { getPool, query } = require('./db');

const MAX_LIST = 5000;

function getField(obj, path) {
  return String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function eq(a, b) {
  if (typeOf(a) !== typeOf(b)) return false;
  if (a !== null && typeof a === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

function cmp(a, b) {
  // Ordering comparisons only match values of the same type (number with number, text with text).
  if (typeOf(a) !== typeOf(b) || !['number', 'string', 'boolean'].includes(typeOf(a))) return null;
  return a < b ? -1 : a > b ? 1 : 0;
}

const OPS = {
  '==': (f, v) => f !== undefined && eq(f, v),
  '!=': (f, v) => f !== undefined && !eq(f, v),
  '<': (f, v) => cmp(f, v) === -1,
  '<=': (f, v) => { const c = cmp(f, v); return c === -1 || c === 0; },
  '>': (f, v) => cmp(f, v) === 1,
  '>=': (f, v) => { const c = cmp(f, v); return c === 1 || c === 0; },
  in: (f, v) => Array.isArray(v) && f !== undefined && v.some((x) => eq(f, x)),
  'not-in': (f, v) => Array.isArray(v) && f !== undefined && !v.some((x) => eq(f, x)),
  'array-contains': (f, v) => Array.isArray(f) && f.some((x) => eq(x, v)),
};

function validWhere(where) {
  return Array.isArray(where) && where.every((w) => Array.isArray(w) && w.length === 3 && typeof w[0] === 'string' && OPS[w[1]]);
}

function parse(row) {
  try {
    return JSON.parse(row.data);
  } catch (e) {
    return {};
  }
}

async function list(collection, { where = [], limit } = {}) {
  const params = [collection];
  let sql = 'SELECT id, data FROM documents WHERE collection=?';
  // Use the indexed month column when the screen filters on it (expenses do).
  for (const [field, op, value] of where) {
    if (field !== 'm') continue;
    if (['==', '<', '<=', '>', '>='].includes(op) && typeof value === 'string') {
      sql += ` AND m ${op === '==' ? '=' : op} ?`;
      params.push(value);
    } else if (op === 'in' && Array.isArray(value) && value.length && value.every((x) => typeof x === 'string')) {
      sql += ` AND m IN (${value.map(() => '?').join(',')})`;
      params.push(...value);
    }
  }
  sql += ' ORDER BY id';
  const rows = await query(sql, params);
  const cap = Math.min(Number(limit) > 0 ? Number(limit) : MAX_LIST, MAX_LIST);
  const out = [];
  for (const r of rows) {
    const data = parse(r);
    if (where.every(([f, op, v]) => OPS[op](getField(data, f), v))) {
      out.push({ id: r.id, data });
      if (out.length >= cap) break;
    }
  }
  return out;
}

async function get(collection, id) {
  const rows = await query('SELECT data FROM documents WHERE collection=? AND id=?', [collection, id]);
  return rows.length ? parse(rows[0]) : null;
}

async function bump(conn, collection) {
  await conn.query(
    'INSERT INTO collection_versions (collection, ver) VALUES (?, 1) ON DUPLICATE KEY UPDATE ver=ver+1',
    [collection]
  );
  const [rows] = await conn.query('SELECT ver FROM collection_versions WHERE collection=?', [collection]);
  return Number(rows[0].ver);
}

async function set(collection, id, data, userId) {
  const json = JSON.stringify(data);
  const m = typeof data.m === 'string' ? data.m.slice(0, 64) : null;
  const conn = await getPool().getConnection();
  try {
    await conn.query(
      `INSERT INTO documents (collection, id, data, m, created_by, updated_by) VALUES (?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE data=VALUES(data), m=VALUES(m), updated_by=VALUES(updated_by)`,
      [collection, id, json, m, userId || null, userId || null]
    );
    return await bump(conn, collection);
  } finally {
    conn.release();
  }
}

async function remove(collection, id) {
  const conn = await getPool().getConnection();
  try {
    await conn.query('DELETE FROM documents WHERE collection=? AND id=?', [collection, id]);
    return await bump(conn, collection);
  } finally {
    conn.release();
  }
}

// Take (or renew) a short lock. Succeeds when the lock is free, expired, or already ours.
async function acquire(collection, id, holder, ttlMs) {
  const now = Date.now();
  const ttl = Math.min(Math.max(Number(ttlMs) || 8000, 500), 60000);
  // `expires_at` is assigned before `holder`, so both conditions see the old holder.
  await query(
    `INSERT INTO leases (collection, id, holder, expires_at) VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE
       expires_at = IF(leases.expires_at < ? OR leases.holder = VALUES(holder), VALUES(expires_at), leases.expires_at),
       holder     = IF(leases.expires_at = VALUES(expires_at), VALUES(holder), leases.holder)`,
    [collection, id, holder, now + ttl, now]
  );
  const rows = await query('SELECT holder, expires_at FROM leases WHERE collection=? AND id=?', [collection, id]);
  const r = rows[0];
  return { acquired: !!r && r.holder === holder, expiresAt: r ? Number(r.expires_at) : null };
}

async function release(collection, id, holder) {
  await query('DELETE FROM leases WHERE collection=? AND id=? AND holder=?', [collection, id, holder]);
}

async function versions() {
  const rows = await query('SELECT collection, ver FROM collection_versions');
  const out = {};
  rows.forEach((r) => (out[r.collection] = Number(r.ver)));
  return out;
}

module.exports = { list, get, set, remove, acquire, release, versions, validWhere, OPS };
