// Who can see and change what — Print Floor ERP.
// Roles (same as the original app):
//   owner    – full access and control
//   accounts – sales orders, delivery challans for billing, prices, all reports
//   factory  – job sheets, record production and inward; never sees sales orders, costs or prices; no reports
const APP = {
  key: 'printfloor',
  name: 'Print Floor ERP',
  // The owner id the existing records were created with, so "approved by" names keep working.
  defaultOwnerId: 'u_bh_SHd58Bri5ye81Tlb_Iw',
};

// Every record type the app uses. Anything else is refused.
const COLLECTIONS = [
  'jobs', 'customers', 'paper', 'moves', 'machines', 'workers', 'locs', 'items', 'grn', 'siss',
  'ptypes', 'plates', 'punches', 'so', 'settings', 'prices', 'mv', 'pins', 'meta', 'arc',
  // daily expenses / petty cash module
  'kxcfg', 'kxv', 'kxc', 'kxs', 'kxi',
];

// Record types the factory role must never read or write (sales orders and all rates).
const PRICE_ONLY = new Set(['so', 'prices']);
// Only the owner may write these.
const OWNER_WRITE = new Set(['arc']);
// Collections that can carry a rate, GST or job-work price inside the record itself.
const PRICE_BEARING = new Set(['jobs', 'grn', 'items', 'arc']);

async function effectiveRole(user) {
  return user && user.active ? user.role : 'none';
}

function canRead(role, collection) {
  if (role === 'owner' || role === 'accounts') return true;
  if (role === 'factory') return !PRICE_ONLY.has(collection);
  return false;
}

function canWrite(role, collection) {
  if (!canRead(role, collection)) return false;
  if (OWNER_WRITE.has(collection)) return role === 'owner';
  return true;
}

function stripPriceFields(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
  const o = { ...row };
  delete o.rate;
  delete o.gst;
  delete o.runit;
  if (o.plan && typeof o.plan === 'object' && Array.isArray(o.plan.fab)) {
    o.plan = {
      ...o.plan,
      fab: o.plan.fab.map((f) => {
        if (!f || typeof f !== 'object') return f;
        const x = { ...f };
        delete x.rate;
        delete x.runit;
        return x;
      }),
    };
  }
  if (Array.isArray(o.lines)) {
    o.lines = o.lines.map((l) => {
      if (!l || typeof l !== 'object') return l;
      const x = { ...l };
      delete x.rate;
      delete x.gst;
      return x;
    });
  }
  return o;
}

// Factory manager may run production and open job sheets, but never receives a rate or value.
function redact(role, collection, data) {
  if (role !== 'factory' || data == null || !PRICE_BEARING.has(collection)) return data;
  if (collection === 'arc' && typeof data === 'object' && Array.isArray(data.items)) {
    return { ...data, items: data.items.map(stripPriceFields) };
  }
  return stripPriceFields(data);
}

// Drop any price a factory client tries to save onto a job, GRN or stores item.
async function beforeWrite(req, collection, id, data) {
  if (req.role !== 'factory' || !data || typeof data !== 'object' || !PRICE_BEARING.has(collection)) return null;
  const clean = stripPriceFields(data);
  for (const k of Object.keys(data)) delete data[k];
  Object.assign(data, clean);
  return null;
}

// Called after the owner creates / edits a login. Nothing extra to sync for this app.
async function onUserRoleChanged() {}
// Called after a record is written. Nothing extra for this app.
async function afterWrite() {}

module.exports = {
  APP, COLLECTIONS, effectiveRole, canRead, canWrite, redact, beforeWrite, onUserRoleChanged, afterWrite,
  ROLES: ['owner', 'accounts', 'factory'],
  ROLE_LABELS: { owner: 'Owner', accounts: 'Accounts', factory: 'Factory manager' },
};
