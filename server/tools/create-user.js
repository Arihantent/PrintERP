// npm run user:create -- <username> <password> <role> "<Full Name>"
// role: owner | accounts | factory
require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { query, getPool } = require('../db');
const rules = require('../rules');

(async () => {
  const [username, password, role, ...nameParts] = process.argv.slice(2);
  const name = nameParts.join(' ') || username;
  if (!username || !password || !rules.ROLES.includes(role)) {
    console.log('Usage: npm run user:create -- <username> <password> <' + rules.ROLES.join('|') + '> "<Full Name>"');
    process.exit(1);
  }
  const id = 'u_' + crypto.randomBytes(17).toString('base64url').slice(0, 22);
  await query(
    'INSERT INTO users (id, username, name, password_hash, role) VALUES (?,?,?,?,?)',
    [id, username.toLowerCase(), name, await bcrypt.hash(password, 10), role]
  );
  await rules.onUserRoleChanged(id, role, null);
  console.log(`Created ${role} login "${username.toLowerCase()}" (${name}).`);
  await getPool().end();
})().catch((e) => { console.error(e.message); process.exit(1); });
