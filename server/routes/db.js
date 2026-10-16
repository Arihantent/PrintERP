const express = require('express');
const store = require('../store');
const rules = require('../rules');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth());

const ID_RE = /^[A-Za-z0-9_\-.~:@+]{1,191}$/;
const denied = (res) => res.status(403).json({ code: 'invalid_argument', message: 'You do not have access to this. Ask the owner.' });

function checkColl(req, res, write) {
  const c = req.params.collection;
  if (!rules.COLLECTIONS.includes(c)) {
    res.status(400).json({ code: 'invalid_argument', message: 'Unknown record type: ' + c });
    return null;
  }
  if (!(write ? rules.canWrite(req.role, c, req) : rules.canRead(req.role, c, req))) {
    denied(res);
    return null;
  }
  return c;
}

function checkId(req, res) {
  if (!ID_RE.test(req.params.id)) {
    res.status(400).json({ code: 'invalid_argument', message: 'Bad record id.' });
    return null;
  }
  return req.params.id;
}

// Change counters for every record type the caller may read. Phones poll this every few seconds.
router.get('/changes', async (req, res, next) => {
  try {
    const all = await store.versions();
    const out = {};
    for (const c of Object.keys(all)) if (rules.canRead(req.role, c, req)) out[c] = all[c];
    res.set('Cache-Control', 'no-store').json({ vers: out, role: req.role });
  } catch (e) { next(e); }
});

// List / filter a record type: GET /api/db/c/jobs?q={"where":[["m",">=","2026-09"]],"limit":300}
router.get('/c/:collection', async (req, res, next) => {
  try {
    const c = checkColl(req, res, false); if (!c) return;
    let q = {};
    try { q = req.query.q ? JSON.parse(req.query.q) : {}; } catch (e) { return res.status(400).json({ code: 'invalid_argument', message: 'Bad query.' }); }
    const where = q.where || [];
    if (!store.validWhere(where)) return res.status(400).json({ code: 'invalid_argument', message: 'Bad filter.' });
    const docs = await store.list(c, { where, limit: q.limit });
    res.set('Cache-Control', 'no-store').json({
      docs: docs.map((d) => ({ id: d.id, data: rules.redact(req.role, c, d.data) })),
    });
  } catch (e) { next(e); }
});

router.get('/d/:collection/:id', async (req, res, next) => {
  try {
    const c = checkColl(req, res, false); if (!c) return;
    const id = checkId(req, res); if (!id) return;
    const data = rules.redact(req.role, c, await store.get(c, id));
    res.set('Cache-Control', 'no-store').json({ id, exists: data !== null, data });
  } catch (e) { next(e); }
});

router.put('/d/:collection/:id', async (req, res, next) => {
  try {
    const c = checkColl(req, res, true); if (!c) return;
    const id = checkId(req, res); if (!id) return;
    const data = req.body && req.body.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return res.status(400).json({ code: 'invalid_argument', message: 'Record must be an object.' });
    const veto = await rules.beforeWrite?.(req, c, id, data);
    if (veto) return res.status(403).json({ code: 'invalid_argument', message: veto });
    const ver = await store.set(c, id, data, req.user.id);
    await rules.afterWrite(req, c, id, data);
    res.json({ ok: true, ver });
  } catch (e) { next(e); }
});

router.delete('/d/:collection/:id', async (req, res, next) => {
  try {
    const c = checkColl(req, res, true); if (!c) return;
    const id = checkId(req, res); if (!id) return;
    const ver = await store.remove(c, id);
    await rules.afterWrite(req, c, id, null);
    res.json({ ok: true, ver });
  } catch (e) { next(e); }
});

router.post('/lease/:collection/:id', async (req, res, next) => {
  try {
    const c = checkColl(req, res, true); if (!c) return;
    const id = checkId(req, res); if (!id) return;
    const holder = String((req.body && req.body.holder) || req.user.id).slice(0, 191);
    if (req.body && req.body.release) {
      await store.release(c, id, holder);
      return res.json({ released: true });
    }
    res.json(await store.acquire(c, id, holder, req.body && req.body.ttlMs));
  } catch (e) { next(e); }
});

module.exports = router;
