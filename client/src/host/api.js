// Talks to the Express API. Keeps the login token on this phone.
const TOKEN_KEY = 'erp_token_' + (import.meta.env.VITE_APP_KEY || 'app');

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
}
export function setToken(t) {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) { /* private mode */ }
}

let onUnauthenticated = () => {};
export function setUnauthenticatedHandler(fn) { onUnauthenticated = fn; }

export class ApiError extends Error {
  constructor(status, body) {
    super((body && body.message) || 'Request failed (' + status + ')');
    this.status = status;
    this.code = (body && body.code) || (status >= 500 ? 'internal' : 'unknown');
  }
}

export async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const t = getToken();
  if (auth && t) headers.Authorization = 'Bearer ' + t;
  let res;
  try {
    res = await fetch('/api' + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, cache: 'no-store' });
  } catch (e) {
    const err = new ApiError(0, { code: 'unavailable', message: 'No connection. Check the internet and try again.' });
    throw err;
  }
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  if (!res.ok) {
    const err = new ApiError(res.status, data);
    if (res.status === 401 && auth) onUnauthenticated(err);
    throw err;
  }
  return data;
}
