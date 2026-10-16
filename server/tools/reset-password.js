// npm run user:reset-password -- <username> <new password>
// Use this if the owner forgets the password (run it from Hostinger SSH or your computer).
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { query, getPool } = require('../db');

(async () => {
  const [username, password] = process.argv.slice(2);
  if (!username || !password || password.length < 6) {
    console.log('Usage: npm run user:reset-password -- <username> <new password (6+ chars)>');
    process.exit(1);
  }
  const r = await query(
    'UPDATE users SET password_hash=?, active=1, must_change_password=0, token_version=token_version+1 WHERE username=?',
    [await bcrypt.hash(password, 10), username.toLowerCase()]
  );
  console.log(r.affectedRows ? `Password reset for "${username}".` : `No login named "${username}".`);
  await getPool().end();
})().catch((e) => { console.error(e.message); process.exit(1); });
