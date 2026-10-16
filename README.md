# Print Floor ERP

The Print Floor ERP for Arihant Enterprises as a web app you host yourself:

- **Frontend:** React (Vite). Every screen, layout, role and calculation is the same as the Claude version.
- **Backend:** Node.js + Express REST API.
- **Database:** MySQL (Hostinger's MariaDB works too).
- **Hosting:** Hostinger Node.js web app, deployed from GitHub (every push to `main` redeploys).

---

## 1. What's in this folder

```
print-floor-erp/
├── server.js                  Entry file (Hostinger "Entry file": server.js)
├── package.json               Scripts: build, start, migrate, user:*, data:*
├── .env.example               Settings to copy into Hostinger's environment variables
├── database/
│   ├── backup.sql             FULL backup: tables + your current data + owner login
│   └── migrations/
│       └── 001_init.sql       Table definitions (applied by the migration script)
├── server/
│   ├── app.js                 Express app: /api routes + serves the built React app
│   ├── migrate.js             Migration script (npm run migrate; also runs on every start)
│   ├── db.js                  MySQL connection pool
│   ├── auth.js                Logins (JWT tokens, bcrypt passwords)
│   ├── rules.js               Who can read / change what (roles)
│   ├── store.js               Record storage on MySQL
│   ├── routes/                auth.js, users.js, db.js
│   └── tools/                 create-user, reset-password, export-json, import-json
└── client/                    React app (Vite)
    ├── index.html
    ├── vite.config.mjs
    ├── public/                App icons + manifest (Add to Home Screen)
    └── src/
        ├── main.jsx
        ├── app.config.js      App name and role descriptions
        ├── host/              React: login, "Logins & passwords", data client
        └── legacy/            The original screens (markup, styles, scripts)
```

### How it fits together

```
 Phone browser ──► React app (login, Logins & passwords)
                     └── original screens (client/src/legacy) ──► dataClient.js
                                                                     │  HTTPS /api
                                                       Express (server/) ◄┘
                                                                     │
                                                       MySQL tables: users, documents,
                                                       collection_versions, leases, app_settings
```

- The original screens are kept as they were and run inside the React app, so nothing about how
  they look or behave has changed. They save through `client/src/host/dataClient.js`, which calls the Express API.
- Every record (job, paper lot, sales order, reel, challan, voucher …) is one row in the `documents` table:
  `collection` is the record type, `id` its id, `data` the record as JSON.
- **Live updates:** each phone checks every 3 seconds whether anything changed and refreshes only what changed,
  so a job saved on one phone shows on the others within a few seconds.
- **Roles are enforced on the server too**, not only hidden on screen.

### Roles (same as before)

| Role | What they see |
|---|---|
| **Owner** | Everything, including logins, masters, Data & archive |
| **Accounts** | Sales orders, job sheets, challans for billing, prices, all reports |
| **Factory manager** | Job sheets, record production, inward (paper, plates, punches, stores), expenses. Never sees sales orders, costs, prices or reports |

---

## 2. Before you start

- A Hostinger plan that supports **Node.js web apps**: Business Web Hosting, or Cloud Startup and higher.
- A **GitHub** account.
- A domain or subdomain for this app, e.g. `print.yourdomain.com`.
  The two ERPs are separate apps: give each its own subdomain and its own database.

---

## 3. Create the database (hPanel)

1. hPanel → **Websites → Dashboard → Databases → Management**.
2. Create a database. Note the **database name**, **username** and **password**.
   Hostinger adds a prefix, e.g. `u123456789_printfloor` — use the full names it shows.
3. Click **Enter phpMyAdmin** next to the new database.
4. In phpMyAdmin: **Import** tab → choose `database/backup.sql` from this folder → **Go**.

`backup.sql` contains: Your current Print Floor records (2 job sheets, 1 sales order, 3 paper lots with PINs, 1 GRN, 1 plate inward, parties, locations, machines, prices) as of 15 Oct 2026.

Owner login inside the backup:

| Username | Temporary password |
|---|---|
| `jeet` | `ChangeMe@123` |

The app makes you set your own password the first time you log in.

> Skipped the import? That's fine too: the app creates the tables itself on first start (migrations)
> and an owner login from `OWNER_USERNAME` / `OWNER_PASSWORD` if you set them (see step 5), otherwise
> `owner` / `ChangeMe@123`.

---

## 4. Put the code on GitHub

Create an **empty private** repository on GitHub named `print-floor-erp`, then on your computer:

```bash
cd print-floor-erp
git init
git add .
git commit -m "Print Floor ERP web app"
git branch -M main
git remote add origin https://github.com/<your-github-username>/print-floor-erp.git
git push -u origin main
```

`.gitignore` already keeps `node_modules/`, `dist/` and `.env` out of the repository.

---

## 5. Deploy on Hostinger

1. hPanel → **Websites → Add Website → Node.js web app → Import Git repository**.
2. **Connect with GitHub** and allow the Hostinger GitHub App to see the `print-floor-erp` repository.
3. Pick the repository. On the settings screen set:

| Field | Value |
|---|---|
| Framework preset | **Express** (if it offers *Vite* or *React*, change it: this app has a server) |
| Branch | `main` |
| Node.js version | **22** (20 also works) |
| Root directory | `/` (the repository root) |
| Build command | `build` (runs `npm run build`) |
| Entry file | `server.js` |
| Output directory | leave as suggested / empty — the server serves the built files itself |

4. **Environment variables** — add:

| Name | Value |
|---|---|
| `DB_HOST` | `localhost` |
| `DB_PORT` | `3306` |
| `DB_NAME` | your full database name |
| `DB_USER` | your full database username |
| `DB_PASSWORD` | your database password |
| `JWT_SECRET` | *(optional)* any long random text |

5. Click **Deploy**. When the build finishes, open `https://print.yourdomain.com/api/health`.
   You should see `{"ok":true,...}`. If it says the database is not reachable, recheck step 4.
6. Open `https://print.yourdomain.com`, log in as **jeet / ChangeMe@123**, and set your password.

### Add your staff

Open **More → Masters & setup → Logins & passwords**. Add each person with a username, a temporary password and their role. They log in with it and choose their own password.

On each phone: open the link in Chrome (Android) or Safari (iPhone) → **Add to Home Screen**. It then opens like an app.

---

## 6. Updating the app later

- Change code → `git push` to `main` → Hostinger rebuilds and restarts automatically
  (you can also press **Redeploy** in hPanel). Build logs: **Deployments**; app logs: **Runtime Logs**.
- **Database changes:** add a new file in `database/migrations/`, e.g. `002_add_something.sql`.
  It is applied automatically on the next start, once, and recorded in the `schema_migrations` table.
  To run it by hand (Hostinger SSH or your computer): `npm run migrate`.
  To stop migrations running on start, set the environment variable `RUN_MIGRATIONS_ON_START=false`.

---

## 7. Everyday admin

| Task | How |
|---|---|
| Add / block a staff login, reset a staff password | In the app: Logins & passwords (owner only) |
| Owner forgot the password | phpMyAdmin → SQL tab → run the query below. It sets the password back to `ChangeMe@123`; log in and choose a new one. |
| Full database backup | hPanel → Databases → phpMyAdmin → **Export**, or hPanel's daily backups |
| Backup of records as one JSON file | `npm run data:export -- backup.json` (restore with `npm run data:import -- backup.json`) |
| Create a login from the command line | `npm run user:create -- ramesh Temp1234 factory "Ramesh Patil"` |

Owner password reset (phpMyAdmin → select this app's database → **SQL**):

```sql
UPDATE users
SET password_hash = '$2a$10$ovqY1Xu2rBB1SaebSjlaPe9dSV1FE2K2Y3aeDkRuUz.T87z0s4nm6',
    must_change_password = 1, active = 1, token_version = token_version + 1
WHERE username = 'jeet';
```

The command-line tools (`npm run user:*`, `data:*`) need the database settings in a `.env` file next to
`package.json` (Hostinger's environment variables only reach the running app, not an SSH shell).

Passwords are stored as bcrypt hashes. Changing or resetting a password signs that person out on their other phones.
A blocked login is signed out within a few seconds.

---

## 8. Run it on your computer (for the developer)

Needs Node.js 18+ and a local MySQL/MariaDB.

```bash
cp .env.example .env        # fill in your local database
npm install
npm run migrate             # or import database/backup.sql
npm run build && npm start  # http://localhost:3000
```

While changing the React side: `npm run dev` (API on :3000) and in a second terminal `npm run dev:client`
(Vite on :5173, forwards `/api` to :3000).

### Developer notes

- `client/src/legacy/` holds the original screens unchanged apart from the small changes listed below.
  They run as classic scripts mounted by `client/src/host/LegacyApp.jsx`. Screens can be rewritten as
  React components one at a time; they all go through the same data client.
- `client/src/host/dataClient.js` is the data interface the screens use:
  `db.collection(type).doc(id).get() / set() / delete() / onSnapshot() / acquire()`,
  `db.collection(type).where(field, op, value).limit(n).get() / onSnapshot()`,
  `user.isOwner() / canEdit() / me() / profiles()`, `downloads.save()`.
- API (all need `Authorization: Bearer <token>` except login):

| Method & path | Purpose |
|---|---|
| `POST /api/auth/login` | `{username, password}` → `{token, user}` |
| `GET /api/auth/me` | current user and role |
| `POST /api/auth/password` | change own password |
| `GET/POST/PATCH /api/users` | manage logins (owner) |
| `GET /api/db/c/:type?q={"where":[...],"limit":n}` | list / filter records |
| `GET/PUT/DELETE /api/db/d/:type/:id` | read / save / delete one record |
| `POST /api/db/lease/:type/:id` | short lock for running numbers |
| `GET /api/db/changes` | change counters (live updates) |
| `GET /api/health` | server + database check |

- Access rules per role: `server/rules.js`.
- Each list on the phone loads up to 1,000 records per type (as in the original). *Data & archive* moves old jobs and used-up paper out of the daily lists; use it once a year or so. The “records used of 5,000” meter was a Claude storage limit; MySQL has no such limit, so treat it as a reminder only.

---

## 9. What changed from the Claude version

- **Sharing from Claude is replaced by logins.** The owner adds each person under *More → Masters & setup → Logins & passwords* and picks their role (Owner, Accounts, Factory manager). The help text that used to say “share as Editor / Contributor” now points there.
- **Logins & passwords** row added at the top of *Masters & setup* (every role sees it, to change their own password or sign out).
- **Locks are released as soon as a save finishes.** Before, a PIN or voucher number lock stayed held for 8 seconds, so a second phone saving at the same moment was told to try again. Now both saves go through, each with its own number.
- Everything else — screens, flows, calculations, print layouts, reports, downloads, the Expenses module — is the original code.

---

## 10. Troubleshooting

| Problem | Fix |
|---|---|
| Hostinger built it as a static site / shows only a blank page | Framework preset must be **Express** with Entry file `server.js`. Change it and Redeploy. |
| `/api/health` says database not reachable | Check `DB_HOST=localhost`, and that `DB_NAME` / `DB_USER` include Hostinger's `u123…_` prefix. Redeploy after changing variables. |
| “The app is not built yet” | Build command must be `build`. Check the build log under Deployments. |
| Everyone got logged out | You changed `JWT_SECRET`. Log in again. |
| First visit after a quiet period is slow | Hostinger stops idle apps and starts them on the next visit; it takes a few seconds once. |
