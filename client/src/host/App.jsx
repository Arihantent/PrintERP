import { useCallback, useEffect, useRef, useState } from 'react';
import cfg from '../app.config';
import { api, getToken, setToken, setUnauthenticatedHandler } from './api';
import { installDataClient, primeVersions } from './dataClient';
import { LoginScreen, SetPasswordScreen } from './Login';
import AccountSheet from './AccountSheet';
import LegacyApp from './LegacyApp';
import Brand from './Brand';

function signOutAndReload() {
  setToken(null);
  window.location.replace('/');
}

export default function App() {
  const [phase, setPhase] = useState('loading'); // loading | offline | login | setpw | app
  const [me, setMe] = useState(null);
  const [account, setAccount] = useState(false);
  const meRef = useRef(null);

  const start = useCallback(async (user) => {
    meRef.current = user;
    setMe(user);
    if (user.mustChangePassword) return setPhase('setpw');
    await primeVersions();
    installDataClient(user);
    setPhase('app');
  }, []);

  const check = useCallback(async () => {
    if (!getToken()) return setPhase('login');
    setPhase('loading');
    try {
      const r = await api('/auth/me');
      await start(r.user);
    } catch (e) {
      if (e.status === 401) { setToken(null); setPhase('login'); }
      else setPhase('offline');
    }
  }, [start]);

  useEffect(() => {
    document.title = cfg.title;
    // Expired or revoked login while using the app: back to the login screen.
    setUnauthenticatedHandler(() => { if (meRef.current) signOutAndReload(); });
    window.__ERP_HOST = {
      openAccount: () => setAccount(true),
      signOut: signOutAndReload,
      userName: () => (meRef.current ? meRef.current.name : ''),
      user: () => meRef.current,
    };
    check();
  }, [check]);

  if (phase === 'loading') {
    return <div className="ah-screen"><div className="ah-login-card"><Brand /><div className="ah-loading">Opening…</div></div></div>;
  }
  if (phase === 'offline') {
    return (
      <div className="ah-screen"><div className="ah-login-card"><Brand />
        <p className="ah-p">Can't reach the server. Check the internet connection.</p>
        <button className="ah-btn primary" type="button" onClick={check}>Try again</button>
      </div></div>
    );
  }
  if (phase === 'login') return <LoginScreen onLoggedIn={start} />;
  if (phase === 'setpw') return <SetPasswordScreen user={me} onDone={start} onSignOut={signOutAndReload} />;

  return (
    <>
      <LegacyApp />
      {account && <AccountSheet me={me} onClose={() => setAccount(false)} onSignOut={signOutAndReload} />}
    </>
  );
}
