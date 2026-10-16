import { useEffect, useState } from 'react';
import cfg from '../app.config';
import { api, setToken } from './api';

const ROLE_KEYS = Object.keys(cfg.roles);
const roleLabel = (r) => (cfg.roles[r] && cfg.roles[r].label) || (r === 'none' ? 'No role' : r);

function EditProfile({ me, onSaved }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(me.name || '');
  const [username, setUsername] = useState(me.username || '');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(me.name || '');
    setUsername(me.username || '');
  }, [me.name, me.username]);

  async function submit(e) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      const r = await api('/users/me', { method: 'PATCH', body: { name, username } });
      onSaved(r.user);
      setOpen(false);
      setMsg({ ok: 'Profile saved.' });
    } catch (x) { setMsg({ err: x.message }); }
    setBusy(false);
  }

  if (!open) {
    return (
      <div>
        <button className="ah-btn" type="button" onClick={() => { setMsg(null); setOpen(true); }}>Edit profile</button>
        {msg && <div className={msg.ok ? 'ah-ok' : 'ah-err'}>{msg.ok || msg.err}</div>}
      </div>
    );
  }

  return (
    <form className="ah-form" onSubmit={submit}>
      <div className="ah-row2">
        <label className="ah-field">Name
          <input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
        </label>
        <label className="ah-field">Username or email
          <input value={username} onChange={(e) => setUsername(e.target.value)} required autoCapitalize="none" autoCorrect="off" autoComplete="username" />
        </label>
      </div>
      {msg && <div className={msg.ok ? 'ah-ok' : 'ah-err'}>{msg.ok || msg.err}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="ah-btn primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button>
        <button className="ah-btn" type="button" onClick={() => { setOpen(false); setName(me.name || ''); setUsername(me.username || ''); setMsg(null); }}>Cancel</button>
      </div>
    </form>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setMsg(null);
    if (next.length < 6) return setMsg({ err: 'Use at least 6 characters.' });
    setBusy(true);
    try {
      const r = await api('/auth/password', { method: 'POST', body: { current, next } });
      setToken(r.token);
      setCurrent(''); setNext('');
      setMsg({ ok: 'Password changed. Your other phones will need to log in again.' });
    } catch (x) { setMsg({ err: x.message }); }
    setBusy(false);
  }
  return (
    <form className="ah-form" onSubmit={submit}>
      <div className="ah-row2">
        <label className="ah-field">Current password
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
        </label>
        <label className="ah-field">New password
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required minLength={6} />
        </label>
      </div>
      {msg && <div className={msg.ok ? 'ah-ok' : 'ah-err'}>{msg.ok || msg.err}</div>}
      <div><button className="ah-btn" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Change my password'}</button></div>
    </form>
  );
}

function UserRow({ u, onChanged }) {
  const [resetting, setResetting] = useState(false);
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  async function patch(body, done) {
    setErr(''); setNote('');
    try { const r = await api('/users/' + encodeURIComponent(u.id), { method: 'PATCH', body }); onChanged(r); if (done) setNote(done); }
    catch (x) { setErr(x.message); }
  }
  return (
    <div className={'ah-user' + (u.active ? '' : ' off')}>
      <span className="nm">{u.name}{u.isMe ? ' (you)' : ''}</span>
      <span>{!u.active ? <span className="ah-pill warn">Blocked</span> : u.mustChangePassword ? <span className="ah-pill">Temp password</span> : null}</span>
      <span className="sub">@{u.username}{u.lastLoginAt ? ' · last login ' + String(u.lastLoginAt).slice(0, 16) : ' · never logged in'}</span>
      {!u.isMe && (
        <div className="acts">
          <select aria-label={'Role for ' + u.name} value={u.role} onChange={(e) => patch({ role: e.target.value }, 'Role updated')}>
            {ROLE_KEYS.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
            {!ROLE_KEYS.includes(u.role) && <option value={u.role}>{roleLabel(u.role)}</option>}
          </select>
          <button className="ah-btn sm" type="button" onClick={() => setResetting((v) => !v)}>Reset password</button>
          <button className={'ah-btn sm' + (u.active ? ' danger' : '')} type="button"
            onClick={() => patch({ active: !u.active }, u.active ? 'Login blocked' : 'Login allowed')}>{u.active ? 'Block' : 'Allow'}</button>
        </div>
      )}
      {resetting && (
        <form className="ah-inline" style={{ gridColumn: '1 / -1' }} onSubmit={(e) => { e.preventDefault(); patch({ password: pw }, 'Temporary password set. They will choose their own at next login.').then(() => { setPw(''); setResetting(false); }); }}>
          <input type="text" placeholder="Temporary password (6+ characters)" value={pw} onChange={(e) => setPw(e.target.value)} minLength={6} required autoComplete="off" />
          <button className="ah-btn sm primary" type="submit">Set</button>
        </form>
      )}
      {(err || note) && <div className={err ? 'ah-err' : 'ah-ok'} style={{ gridColumn: '1 / -1' }}>{err || note}</div>}
    </div>
  );
}

function AddUser({ onAdded }) {
  const [f, setF] = useState({ name: '', username: '', password: '', role: ROLE_KEYS.includes('factory') ? 'factory' : ROLE_KEYS[0] });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const up = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function submit(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const r = await api('/users', { method: 'POST', body: f });
      onAdded(r, f);
      setF({ ...f, name: '', username: '', password: '' });
    } catch (x) { setErr(x.message); }
    setBusy(false);
  }
  return (
    <form className="ah-form" onSubmit={submit}>
      <div className="ah-row2">
        <label className="ah-field">Name<input value={f.name} onChange={up('name')} required placeholder="e.g. Ramesh Patil" /></label>
        <label className="ah-field">Role
          <select value={f.role} onChange={up('role')}>{ROLE_KEYS.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}</select>
        </label>
        <label className="ah-field">Username or email<input value={f.username} onChange={up('username')} required autoCapitalize="none" autoCorrect="off" placeholder="e.g. ramesh or ramesh@company.com" autoComplete="off" /></label>
        <label className="ah-field">Temporary password<input value={f.password} onChange={up('password')} required minLength={6} autoComplete="off" /></label>
      </div>
      {err && <div className="ah-err">{err}</div>}
      <div><button className="ah-btn primary" type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add login'}</button></div>
    </form>
  );
}

export default function AccountSheet({ me, onClose, onSignOut, onProfile }) {
  const isOwner = me.role === 'owner';
  const [users, setUsers] = useState(null);
  const [err, setErr] = useState('');
  const [added, setAdded] = useState('');

  useEffect(() => {
    if (!isOwner) return;
    api('/users').then(setUsers).catch((x) => setErr(x.message));
  }, [isOwner]);

  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);

  const replace = (u) => setUsers((list) => (list ? list.map((x) => (x.id === u.id ? u : x)) : list));

  return (
    <div className="ah-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ah-sheet" role="dialog" aria-modal="true" aria-label="Logins and passwords">
        <div className="ah-sheet-h">
          <h2 className="ah-h">Logins &amp; passwords</h2>
          <button className="ah-x" type="button" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div className="ah-sheet-b">
          <div className="ah-card">
            <div className="ah-me">
              <div className="ah-av" aria-hidden="true">{(me.name || '?').trim()[0]?.toUpperCase()}</div>
              <div><b>{me.name}</b><span>@{me.username} · {roleLabel(me.role)}</span></div>
            </div>
            {isOwner && <EditProfile me={me} onSaved={(user) => { onProfile && onProfile(user); replace({ ...user, isMe: true }); }} />}
            <ChangePassword />
            <div><button className="ah-btn danger" type="button" onClick={onSignOut}>Sign out of this phone</button></div>
          </div>

          {isOwner && (
            <div className="ah-card">
              <div className="ah-card-h"><p className="ah-eyebrow">Staff logins</p></div>
              {err && <div className="ah-err">{err}</div>}
              {!users && !err && <div className="ah-loading">Loading…</div>}
              {users && (
                <div className="ah-users">
                  {users.map((u) => <UserRow key={u.id} u={u} onChanged={replace} />)}
                </div>
              )}
            </div>
          )}

          {isOwner && (
            <div className="ah-card">
              <p className="ah-eyebrow">Add a login</p>
              <ul className="ah-roles">
                {ROLE_KEYS.map((r) => <li key={r}><b>{roleLabel(r)}</b> — {cfg.roles[r].help}</li>)}
              </ul>
              {added && <div className="ah-ok">{added}</div>}
              <AddUser onAdded={(u, f) => { setUsers((l) => [...(l || []), u]); setAdded(`Login added. Send ${u.name} the username "${u.username}" and the temporary password; they will choose their own at first login.`); }} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
