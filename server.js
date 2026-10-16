// Entry file for Hostinger ("Entry file: server.js").
// Serves the API under /api and the built React app from /dist.
require('dotenv').config();

const { createApp } = require('./server/app');
const { runMigrations } = require('./server/migrate');
const { APP } = require('./server/rules');

const PORT = Number(process.env.PORT) || 3000;

async function main() {
  if (process.env.RUN_MIGRATIONS_ON_START !== 'false') {
    try {
      await runMigrations({ log: (m) => console.log('[migrate]', m) });
    } catch (e) {
      // Keep the server up so /api/health can report the problem instead of a blank 503.
      console.error('[migrate] failed:', e.message);
    }
  }
  const app = createApp();
  app.listen(PORT, () => console.log(`${APP.name} listening on port ${PORT}`));
}

main();
