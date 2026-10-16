const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const { requireAuth, requireOwner } = require('../auth');
const rules = require('../rules');

const router = express.Router();
router.use(requireAuth());

const newUserId = () => 'u_' + crypto.randomBytes(17).toString('base64url').slice(0, 22);
const USERNAME_RE = /^[a-z0-9._-]{3,40}$/;

function row(u, meId) {
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    role: u.role,
    active: !!u.active,
    mustChangePassword: !!u.must_change_password,
    lastLoginAt: u.last_login_at,
    isMe: u.id === meId,
  };
}

// Display names for "approved by", "verified by", staff lists.
router.get('/profiles', async (req, res, next) => {
  try {
    const ids = String(req.query.ids || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 200);
    const out = {};
    if (ids.length) {
      const rows = await query(`SELECT id, name FROM users WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
      rows.forEach((u) => (out[u.id] = { id: u.id, name: u.name }));
    }
    ids.forEach((id) => { if (!out[id]) out[id] = { id, name: null }; });
    res.json(out);
  } catch (e) { next(e); }
});

// People search (used by the owner when giving staff a role).
router.get('/search', requireOwner, async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const like = '%' + q.replace(/[%_]/g, '\\$&') + '%';
    const rows = await query(
      'SELECT id, username, name, role, active FROM users WHERE active=1 AND (name LIKE ? OR username LIKE ?) ORDER BY name LIMIT 20',
      [like, like]
    );
    res.json(rows.map((u) => ({ id: u.id, name: u.name, username: u.username, role: u.role, isMe: u.id === req.user.id })));
  } catch (e) { next(e); }
});

// ---- owner-only login management ----
router.get('/', requireOwner, async (req, res, next) => {
  try {
    const rows = await query('SELECT * FROM users ORDER BY active DESC, role, name');
    res.json(rows.map((u) => row(u, req.user.id)));
  } catch (e) { next(e); }
});

router.post('/', requireOwner, async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const username = String(req.body.username || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const role = String(req.body.role || '');
    if (!name) return res.status(400).json({ code: 'invalid_argument', message: 'Enter the person\'s name.' });
    if (!USERNAME_RE.test(username)) return res.status(400).json({ code: 'invalid_argument', message: 'Username: 3–40 letters, numbers, dot, dash or underscore. No spaces.' });
    if (password.length < 6) return res.status(400).json({ code: 'invalid_argument', message: 'Password must be at least 6 characters.' });
    if (!rules.ROLES.includes(role)) return res.status(400).json({ code: 'invalid_argument', message: 'Pick a role.' });
    const exists = await query('SELECT id FROM users WHERE username=?', [username]);
    if (exists.length) return res.status(409).json({ code: 'already_exists', message: 'That username is taken.' });
    const id = newUserId();
    await query(
      'INSERT INTO users (id, username, name, password_hash, role, active, must_change_password) VALUES (?,?,?,?,?,1,1)',
      [id, username, name, await bcrypt.hash(password, 10), role]
    );
    await rules.onUserRoleChanged(id, role, req.user.id);
    const [u] = await query('SELECT * FROM users WHERE id=?', [id]);
    res.status(201).json(row(u, req.user.id));
  } catch (e) { next(e); }
});

router.patch('/:id', requireOwner, async (req, res, next) => {
  try {
    const [u] = await query('SELECT * FROM users WHERE id=?', [req.params.id]);
    if (!u) return res.status(404).json({ code: 'not_found', message: 'No such login.' });
    const sets = [];
    const vals = [];
    let bumpToken = false;
    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) return res.status(400).json({ code: 'invalid_argument', message: 'Name can\'t be empty.' });
      sets.push('name=?'); vals.push(name);
    }
    if (req.body.role !== undefined) {
      if (!rules.ROLES.includes(req.body.role)) return res.status(400).json({ code: 'invalid_argument', message: 'Pick a role.' });
      sets.push('role=?'); vals.push(req.body.role);
    }
    if (req.body.active !== undefined) {
      sets.push('active=?'); vals.push(req.body.active ? 1 : 0);
      if (!req.body.active) bumpToken = true;
    }
    if (req.body.password !== undefined) {
      const p = String(req.body.password);
      if (p.length < 6) return res.status(400).json({ code: 'invalid_argument', message: 'Password must be at least 6 characters.' });
      sets.push('password_hash=?', 'must_change_password=?'); vals.push(await bcrypt.hash(p, 10), u.id === req.user.id ? 0 : 1);
      bumpToken = true;
    }
    // Never leave the business without an active owner.
    const losingOwner = u.role === 'owner' && ((req.body.role && req.body.role !== 'owner') || req.body.active === false);
    if (losingOwner) {
      const [[{ n }]] = [await query("SELECT COUNT(*) AS n FROM users WHERE role='owner' AND active=1 AND id<>?", [u.id])];
      if (!n) return res.status(400).json({ code: 'invalid_argument', message: 'Keep at least one active owner.' });
    }
    if (!sets.length) return res.json(row(u, req.user.id));
    if (bumpToken) sets.push('token_version=token_version+1');
    await query(`UPDATE users SET ${sets.join(', ')} WHERE id=?`, [...vals, u.id]);
    const [fresh] = await query('SELECT * FROM users WHERE id=?', [u.id]);
    if (req.body.role !== undefined || req.body.active !== undefined) {
      await rules.onUserRoleChanged(u.id, fresh.active ? fresh.role : null, req.user.id);
    }
    res.json(row(fresh, req.user.id));
  } catch (e) { next(e); }
});

module.exports = router;
