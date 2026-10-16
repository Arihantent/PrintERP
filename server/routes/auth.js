const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const { signToken, requireAuth, publicUser } = require('../auth');
const rules = require('../rules');

const router = express.Router();

// Simple brute-force guard: 8 wrong passwords per username+IP in 10 minutes.
const fails = new Map();
const WINDOW = 10 * 60 * 1000;
function tooMany(key) {
  const now = Date.now();
  const list = (fails.get(key) || []).filter((t) => now - t < WINDOW);
  fails.set(key, list);
  return list.length >= 8;
}
function noteFail(key) {
  const list = fails.get(key) || [];
  list.push(Date.now());
  fails.set(key, list);
}

router.post('/login', async (req, res, next) => {
  try {
    const username = String(req.body.username || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const key = username + '|' + req.ip;
    if (!username || !password) return res.status(400).json({ code: 'invalid_argument', message: 'Enter your username and password.' });
    if (tooMany(key)) return res.status(429).json({ code: 'rate_limited', message: 'Too many wrong attempts. Wait 10 minutes and try again.' });
    const rows = await query('SELECT * FROM users WHERE username=?', [username]);
    const u = rows[0];
    const ok = u && u.active && (await bcrypt.compare(password, u.password_hash));
    if (!ok) {
      noteFail(key);
      return res.status(401).json({ code: 'bad_login', message: 'Wrong username or password.' });
    }
    fails.delete(key);
    await query('UPDATE users SET last_login_at=NOW() WHERE id=?', [u.id]);
    const token = await signToken(u);
    res.json({ token, user: publicUser(u, await rules.effectiveRole(u)) });
  } catch (e) {
    next(e);
  }
});

router.get('/me', requireAuth({ allowPasswordChange: true }), async (req, res) => {
  res.json({ user: publicUser(req.user, req.role), app: { key: rules.APP.key, name: rules.APP.name } });
});

// Change my own password. Signs out my other phones (token_version bump) and returns a fresh token.
router.post('/password', requireAuth({ allowPasswordChange: true }), async (req, res, next) => {
  try {
    const current = String(req.body.current || '');
    const next_ = String(req.body.next || '');
    if (next_.length < 6) return res.status(400).json({ code: 'invalid_argument', message: 'New password must be at least 6 characters.' });
    const [u] = await query('SELECT * FROM users WHERE id=?', [req.user.id]);
    if (!(await bcrypt.compare(current, u.password_hash))) {
      return res.status(400).json({ code: 'invalid_argument', message: 'Current password is wrong.' });
    }
    const hash = await bcrypt.hash(next_, 10);
    await query('UPDATE users SET password_hash=?, must_change_password=0, token_version=token_version+1 WHERE id=?', [hash, u.id]);
    const [fresh] = await query('SELECT * FROM users WHERE id=?', [u.id]);
    res.json({ token: await signToken(fresh), user: publicUser(fresh, await rules.effectiveRole(fresh)) });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
