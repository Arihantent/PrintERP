import { useState } from 'react';
import cfg from '../app.config';
import Brand from './Brand';
import { api, setToken } from './api';

export function LoginScreen({ onLoggedIn }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const r = await api('/auth/login', { method: 'POST', body: { username, password }, auth: false });
      setToken(r.token);
      onLoggedIn(r.user);
    } catch (x) {
      setErr(x.message);
      setBusy(false);
    }
  }

  return (
    <div className="ah-screen">
      <div className="ah-login-card">
        <Brand />
        <p className="ah-p">{cfg.tagline}. Log in with the username the owner gave you.</p>
        <form className="ah-form" onSubmit={submit}>
          <label className="ah-field">Username
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoCorrect="off" autoComplete="username" required autoFocus />
          </label>
          <label className="ah-field">Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </label>
          {err && <div className="ah-err" role="alert">{err}</div>}
          <button className="ah-btn primary" type="submit" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
        </form>
        <div className="ah-foot">Forgot your password? Ask the owner to reset it.</div>
      </div>
    </div>
  );
}

// Shown when a login was created or reset by the owner: the person picks their own password.
export function SetPasswordScreen({ user, onDone, onSignOut }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (next !== again) return setErr('The two new passwords don\'t match.');
    if (next.length < 6) return setErr('Use at least 6 characters.');
    setBusy(true);
    try {
      const r = await api('/auth/password', { method: 'POST', body: { current, next } });
      setToken(r.token);
      onDone(r.user);
    } catch (x) {
      setErr(x.message);
      setBusy(false);
    }
  }

  return (
    <div className="ah-screen">
      <div className="ah-login-card">
        <Brand />
        <h1 className="ah-h">Hi {user.name}, set your own password</h1>
        <p className="ah-p">You logged in with a temporary password. Choose a new one that only you know.</p>
        <form className="ah-form" onSubmit={submit}>
          <label className="ah-field">Temporary password
            <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
          </label>
          <label className="ah-field">New password
            <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required minLength={6} />
          </label>
          <label className="ah-field">New password again
            <input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required minLength={6} />
          </label>
          {err && <div className="ah-err" role="alert">{err}</div>}
          <button className="ah-btn primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save and open the app'}</button>
          <button className="ah-btn" type="button" onClick={onSignOut}>Sign out</button>
        </form>
      </div>
    </div>
  );
}
