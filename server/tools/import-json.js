// npm run data:import -- backup.json
// Loads a file made by data:export (same shape). Existing records with the same id are replaced.
require('dotenv').config();
const fs = require('fs');
const store = require('../store');
const { getPool } = require('../db');
const rules = require('../rules');

(async () => {
  const file = process.argv[2];
  if (!file) { console.log('Usage: npm run data:import -- <file.json>'); process.exit(1); }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  let n = 0;
  for (const [coll, docs] of Object.entries(data)) {
    if (!rules.COLLECTIONS.includes(coll)) { console.warn(`skipping unknown record type "${coll}"`); continue; }
    for (const [id, doc] of Object.entries(docs)) { await store.set(coll, id, doc, null); n++; }
  }
  console.log(`Imported ${n} records from ${file}`);
  await getPool().end();
})().catch((e) => { console.error(e.message); process.exit(1); });
