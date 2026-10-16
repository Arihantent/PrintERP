// npm run data:export -- backup.json
// Writes every ERP record to one JSON file: { "<record type>": { "<id>": { ...record } } }
require('dotenv').config();
const fs = require('fs');
const { query, getPool } = require('../db');

(async () => {
  const file = process.argv[2] || `backup-${new Date().toISOString().slice(0, 10)}.json`;
  const rows = await query('SELECT collection, id, data FROM documents ORDER BY collection, id');
  const out = {};
  rows.forEach((r) => { (out[r.collection] = out[r.collection] || {})[r.id] = JSON.parse(r.data); });
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  console.log(`Exported ${rows.length} records to ${file}`);
  await getPool().end();
})().catch((e) => { console.error(e.message); process.exit(1); });
