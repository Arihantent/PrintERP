// Data client for the original app screens.
//
// The screens were written against a small document-database interface:
//   db.collection(name).doc(id).get()/set()/delete()/onSnapshot()/acquire()
//   db.collection(name).where(field, op, value).limit(n).get()/onSnapshot()
//   user.isOwner()/canEdit()/me()/id()/profiles()/search()
//   downloads.save({ filename, data })
// This file provides exactly that interface on top of the Express + MySQL API, so the
// screens run unchanged. Live updates: every open list re-reads itself when the server's
// change counter for that record type moves (checked every few seconds and right after
// every save from this phone).
import { api } from './api';

const POLL_MS = Number(import.meta.env.VITE_POLL_MS) || 3000;
const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

function autoId() {
  const a = new Uint8Array(20);
  crypto.getRandomValues(a);
  let s = '';
  for (const b of a) s += ID_CHARS[b % ID_CHARS.length];
  return s;
}

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const enc = encodeURIComponent;

function toErr(e) {
  if (e && e.status === 413) return Object.assign(new Error(e.message), { code: 'quota_exceeded' });
  if (e && e.code) return Object.assign(new Error(e.message), { code: e.code });
  return Object.assign(new Error('Something went wrong.'), { code: 'internal' });
}

/* ---------- snapshots ---------- */
class DocSnapshot {
  constructor(ref, data) {
    this.id = ref.id;
    this.ref = ref;
    this.exists = data !== null && data !== undefined;
    this._data = this.exists ? data : undefined;
  }
  data() { return clone(this._data); }
  get(field) { return clone(String(field).split('.').reduce((o, k) => (o == null ? undefined : o[k]), this._data)); }
}

class QuerySnapshot {
  constructor(coll, docs) {
    this.docs = docs.map((d) => new DocSnapshot(new DocRef(coll, d.id), d.data));
    this.size = this.docs.length;
    this.empty = this.size === 0;
  }
  forEach(fn) { this.docs.forEach(fn); }
}

/* ---------- live updates ---------- */
const subs = new Map(); // collection -> Set<sub>
const known = {}; // collection -> last change counter seen
let timer = null;
let polling = false;

async function refresh(sub) {
  const seq = ++sub.seq;
  try {
    const { snap, sig } = await sub.fetch();
    if (!sub.active || seq !== sub.seq) return;
    if (sig !== sub.sig) {
      sub.sig = sig;
      sub.next(snap);
    }
  } catch (e) {
    if (!sub.active) return;
    // Network blips are retried on the next tick; only a refusal is reported to the screen.
    if (e && e.status === 403 && sub.error) sub.error(toErr(e));
  }
}

function refreshCollection(coll) {
  const set = subs.get(coll);
  if (set) set.forEach((s) => refresh(s));
}

async function poll() {
  if (polling || typeof document !== 'undefined' && document.hidden) return;
  polling = true;
  try {
    const { vers } = await api('/db/changes');
    for (const coll of subs.keys()) {
      const v = vers[coll] || 0;
      if ((known[coll] || 0) !== v) {
        known[coll] = v;
        refreshCollection(coll);
      }
    }
  } catch (e) {
    /* offline — try again next tick */
  } finally {
    polling = false;
  }
}

function startPolling() {
  if (timer) return;
  timer = setInterval(poll, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { poll(); subs.forEach((set) => set.forEach(refresh)); } });
  window.addEventListener('online', () => subs.forEach((set) => set.forEach(refresh)));
}

function subscribe(coll, fetch, next, error) {
  const sub = { coll, fetch, next, error, sig: null, seq: 0, active: true };
  if (!subs.has(coll)) subs.set(coll, new Set());
  subs.get(coll).add(sub);
  refresh(sub);
  startPolling();
  return () => {
    sub.active = false;
    const set = subs.get(coll);
    if (set) set.delete(sub);
  };
}

function afterWrite(coll, res) {
  if (res && typeof res.ver === 'number') known[coll] = res.ver;
  refreshCollection(coll);
}

/* ---------- references ---------- */
class DocRef {
  constructor(coll, id) {
    this.collection = coll;
    this.id = id;
    this.path = coll + '/' + id;
  }
  async _fetch() {
    const r = await api(`/db/d/${enc(this.collection)}/${enc(this.id)}`);
    return { snap: new DocSnapshot(this, r.data), sig: JSON.stringify(r.data) };
  }
  async get() {
    try { return (await this._fetch()).snap; } catch (e) { throw toErr(e); }
  }
  async set(data) {
    try {
      const res = await api(`/db/d/${enc(this.collection)}/${enc(this.id)}`, { method: 'PUT', body: { data: clone(data) } });
      afterWrite(this.collection, res);
    } catch (e) { throw toErr(e); }
  }
  async update(patch) {
    const cur = (await this.get()).data() || {};
    return this.set({ ...cur, ...patch });
  }
  async delete() {
    try {
      const res = await api(`/db/d/${enc(this.collection)}/${enc(this.id)}`, { method: 'DELETE' });
      afterWrite(this.collection, res);
    } catch (e) { throw toErr(e); }
  }
  async acquire({ holder, ttlMs } = {}) {
    try {
      return await api(`/db/lease/${enc(this.collection)}/${enc(this.id)}`, { method: 'POST', body: { holder, ttlMs } });
    } catch (e) { throw toErr(e); }
  }
  async release({ holder } = {}) {
    try {
      return await api(`/db/lease/${enc(this.collection)}/${enc(this.id)}`, { method: 'POST', body: { holder, release: true } });
    } catch (e) { throw toErr(e); }
  }
  onSnapshot(next, error) {
    return subscribe(this.collection, () => this._fetch(), next, error);
  }
}

class Query {
  constructor(coll, where = [], limit = null) {
    this.collectionName = coll;
    this._where = where;
    this._limit = limit;
  }
  where(field, op, value) { return new Query(this.collectionName, [...this._where, [field, op, clone(value)]], this._limit); }
  limit(n) { return new Query(this.collectionName, this._where, n); }
  async _fetch() {
    const q = JSON.stringify({ where: this._where, limit: this._limit });
    const r = await api(`/db/c/${enc(this.collectionName)}?q=${enc(q)}`);
    return { snap: new QuerySnapshot(this.collectionName, r.docs), sig: JSON.stringify(r.docs) };
  }
  async get() {
    try { return (await this._fetch()).snap; } catch (e) { throw toErr(e); }
  }
  onSnapshot(next, error) {
    return subscribe(this.collectionName, () => this._fetch(), next, error);
  }
}

class CollectionRef extends Query {
  constructor(coll) { super(coll); this.id = coll; }
  doc(id) { return new DocRef(this.collectionName, id === undefined ? autoId() : String(id)); }
  async add(data) { const ref = this.doc(); await ref.set(data); return ref; }
}

const db = {
  collection: (name) => new CollectionRef(name),
  doc: (path) => {
    const [coll, id] = String(path).split('/');
    return new DocRef(coll, id);
  },
};

/* ---------- people ---------- */
function avatar(name) {
  const letter = (String(name || '?').trim()[0] || '?').toUpperCase();
  let h = 0;
  for (const c of String(name || '')) h = (h * 31 + c.charCodeAt(0)) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" rx="30" fill="hsl(${h},45%,45%)"/><text x="30" y="39" font-size="26" font-family="Arial,sans-serif" text-anchor="middle" fill="#fff">${letter.replace(/[<&>]/g, '')}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function makeUser(me) {
  return {
    isOwner: async () => me.role === 'owner',
    canEdit: async () => me.role === 'owner' || me.role === 'accounts',
    me: async () => ({ id: me.id, name: me.name, avatarUrl: avatar(me.name) }),
    id: async () => me.id,
    profiles: async (ids) => {
      const list = [...new Set((ids || []).filter(Boolean))];
      if (!list.length) return {};
      const r = await api('/users/profiles?ids=' + enc(list.join(',')));
      const out = {};
      list.forEach((id) => {
        const p = r[id] || { name: null };
        out[id] = { id, name: p.name || 'Someone', avatarUrl: avatar(p.name || '?') };
      });
      return out;
    },
    search: async (q) => {
      const r = await api('/users/search?q=' + enc(q || ''));
      return r.map((u) => ({ id: u.id, name: u.name, isMe: u.isMe, avatarUrl: avatar(u.name) }));
    },
  };
}

/* ---------- downloads ---------- */
const downloads = {
  async save({ filename, data, mimeType } = {}) {
    const type = mimeType || (/\.html?$/i.test(filename || '') ? 'text/html' : /\.csv$/i.test(filename || '') ? 'text/csv' : /\.json$/i.test(filename || '') ? 'application/json' : 'text/plain');
    const blob = data instanceof Blob ? data : new Blob([data], { type: type + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'download';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return { saved: true };
  },
};

// Reads the current change counters once before the screens start, so the first poll
// doesn't re-read every list that was just loaded.
export async function primeVersions() {
  try {
    const { vers } = await api('/db/changes');
    Object.keys(vers).forEach((k) => (known[k] = vers[k]));
    return vers;
  } catch (e) {
    return null;
  }
}

// Installs window.claude.use(...) — the entry point the original screens call.
export function installDataClient(me) {
  const user = makeUser(me);
  window.claude = {
    use: async (name) => {
      if (name === 'db') return db;
      if (name === 'user') return user;
      if (name === 'downloads') return downloads;
      throw Object.assign(new Error('Not available: ' + name), { code: 'unavailable' });
    },
  };
}
