const path = require('path');
const fs = require('fs');
const express = require('express');
const compression = require('compression');
const { query } = require('./db');
const { APP } = require('./rules');

function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(compression());
  // Bill photos in the expenses module are sent as images inside records, so allow large bodies.
  app.use(express.json({ limit: process.env.MAX_BODY || '25mb' }));

  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    res.set('X-Frame-Options', 'SAMEORIGIN');
    next();
  });

  app.get('/api/health', async (req, res) => {
    try {
      await query('SELECT 1 FROM users LIMIT 1');
      res.json({ ok: true, app: APP.name });
    } catch (e) {
      res.status(503).json({ ok: false, app: APP.name, error: 'Database not reachable or not set up: ' + e.message });
    }
  });

  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/users', require('./routes/users'));
  app.use('/api/db', require('./routes/db'));
  app.use('/api', (req, res) => res.status(404).json({ code: 'not_found', message: 'No such API.' }));

  // Built React app (npm run build -> /dist)
  const dist = path.join(__dirname, '..', 'dist');
  if (fs.existsSync(dist)) {
    app.use('/assets', express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '365d' }));
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get('*', (req, res) => {
      res.set('Cache-Control', 'no-cache');
      res.sendFile(path.join(dist, 'index.html'));
    });
  } else {
    app.get('/', (req, res) => res.status(500).send('The app is not built yet. Run "npm run build".'));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ code: 'quota_exceeded', message: 'This record is too large to save.' });
    }
    console.error(err);
    res.status(500).json({ code: 'internal', message: 'Server error. Try again.' });
  });

  return app;
}

module.exports = { createApp };
