// Login tokens (JWT) and the request guard.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { query } = require('./db');
const rules = require('./rules');

const TOKEN_DAYS = Number(process.env.TOKEN_DAYS) || 30;
let secretPromise = null;

// Uses JWT_SECRET if set; otherwise a random secret is created once and kept in the database,
// so logins survive restarts without extra setup on Hostinger.
function getSecret() {
  if (process.env.JWT_SECRET) return Promise.resolve(process.env.JWT_SECRET);
  if (!secretPromise) {
    secretPromise = (async () => {
      const rows = await query("SELECT v FROM app_settings WHERE k='jwt_secret'");
      if (rows.length) return rows[0].v;
      const s = crypto.randomBytes(48).toString('hex');
      await query("INSERT IGNORE INTO app_settings (k, v) VALUES ('jwt_secret', ?)", [s]);
      const again = await query("SELECT v FROM app_settings WHERE k='jwt_secret'");
      return again[0].v;
    })().catch((e) => {
      secretPromise = null;
      throw e;
    });
  }
  return secretPromise;
}

async function signToken(user) {
  const secret = await getSecret();
  return jwt.sign({ sub: user.id, tv: user.token_version }, secret, { expiresIn: `${TOKEN_DAYS}d` });
}

async function loadUser(id) {
  const rows = await query(
    'SELECT id, username, name, role, active, must_change_password, token_version FROM users WHERE id=?',
    [id]
  );
  return rows[0] || null;
}

function publicUser(u, role) {
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    role: role !== undefined ? role : u.role,
    accountRole: u.role,
    mustChangePassword: !!u.must_change_password,
  };
}

// Express middleware: requires a valid token; sets req.user and req.role.
function requireAuth({ allowPasswordChange = false } = {}) {
  return async (req, res, next) => {
    try {
      const h = req.headers.authorization || '';
      const token = h.startsWith('Bearer ') ? h.slice(7) : null;
      if (!token) return res.status(401).json({ code: 'unauthenticated', message: 'Please log in.' });
      let payload;
      try {
        payload = jwt.verify(token, await getSecret());
      } catch (e) {
        return res.status(401).json({ code: 'unauthenticated', message: 'Your login has expired. Please log in again.' });
      }
      const user = await loadUser(payload.sub);
      if (!user || !user.active || user.token_version !== payload.tv) {
        return res.status(401).json({ code: 'unauthenticated', message: 'Please log in again.' });
      }
      if (user.must_change_password && !allowPasswordChange) {
        return res.status(403).json({ code: 'password_change_required', message: 'Set a new password first.' });
      }
      req.user = user;
      req.role = await rules.effectiveRole(user);
      next();
    } catch (e) {
      next(e);
    }
  };
}

function requireOwner(req, res, next) {
  if (req.role !== 'owner') return res.status(403).json({ code: 'permission_denied', message: 'Only the owner can do this.' });
  next();
}

module.exports = { signToken, requireAuth, requireOwner, publicUser, loadUser, getSecret };
