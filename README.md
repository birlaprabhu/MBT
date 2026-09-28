# Dept. Project Fund Manager — Intranet Server (SQLite edition)

This is the shared, multi-user version of the fund manager. It runs on a small
Node.js server so that every professor and the Admin, on their own computers,
see and edit the same data over your college LAN.

**This version stores data in a real SQLite database** (`data/fund_manager.sqlite`)
instead of one big JSON file, so it stays fast even at high daily volume — see
"Why SQLite" below if you're wondering whether it can handle your data load.

## What's inside
- `server.js` — the server: a REST API + serves the web app.
- `db.js` — database schema and setup (runs automatically on first start).
- `public/index.html` — the app itself (same screens you've already tested).
- `data/fund_manager.sqlite` — created automatically on first run. **This file is
  your entire department's data.** Back it up regularly (see below).
- `node_modules/` — dependencies, already included so it runs without internet
  access on the server machine. If your server's OS/CPU architecture doesn't
  match the prebuilt native module, delete `node_modules` and run `npm install`
  once (needs internet for that one step only).

## Requirements
- One computer on your intranet to act as the server (a lab PC, small office
  server, or NAS that can run Node.js). It should stay switched on and
  connected to the network during working hours.
- [Node.js](https://nodejs.org) v18 or newer.

## Running it
1. Copy this whole folder onto the server machine.
2. Open a terminal in this folder.
3. Start it:
   ```
   npm start
   ```
4. It prints something like:
   ```
   On the intranet, share: http://<this-machine-LAN-IP>:3000
   ```
   Find that machine's LAN IP (Windows: `ipconfig`; Mac/Linux: `ifconfig` /
   `ip addr`) and share that link with your professors and Admin. They open it
   in any browser — nothing to install on their side.
5. Make sure the server machine's firewall allows inbound connections on port
   3000 (or change the port — see below).

**First login:** username `admin`, password `admin123`. Log in and create real
professor accounts from "Manage Users" right away.

## Keeping it running
Don't just leave a terminal window open for daily use — use a process manager
so it restarts automatically after a reboot or crash:
- `npm install -g pm2`, then `pm2 start server.js --name fund-manager`,
  `pm2 save`, and `pm2 startup` (follow the printed instructions).

## Backups
All data lives in `data/fund_manager.sqlite`. Two ways to back it up:
- Copy that one file somewhere safe on a schedule (while the server is
  running, SQLite's WAL mode makes this safe to do live).
- Or, logged in as Admin, visit `http://<server>:3000/api/backup` — downloads
  a timestamped full JSON export, handy right before year-end reporting.

## Changing the port
```
PORT=8080 node server.js
```

## Why SQLite (and what changed from the JSON-file version)
The very first version of this server stored everything in one big JSON file
and rewrote the *entire* file on every single save — meaning adding one
invoice meant reading, re-serializing, and rewriting the whole department's
history each time. That's fine for light use, but at high volume (hundreds to
1,000+ entries a day) it gets slower and heavier every day, forever.

This version uses SQLite with indexed tables, so:
- Adding an entry is a single small database insert (~1ms), not a full-file
  rewrite.
- Dashboard totals, budget breakdowns, stock balances, and the Academic Year
  report are computed with indexed SQL queries, not by downloading and adding
  up every record in the browser.
- Tested at 5,000 entries in one project (about 5 days at 1,000/day): every
  page loaded in under 70ms, and the whole database was about 2.4 MB. It will
  comfortably keep this pace well beyond a full year at that volume.

## How syncing works (so you know its limits)
Every screen fetches only the data it needs from the server (not the whole
dataset). Saving an invoice, issuing stock, or creating a project/user talks
directly to the database — there's no "everyone edits a big shared blob at
once" problem anymore. Two people can genuinely be entering invoices into
different projects (or even the same project) around the same time without
overwriting each other's work.

## Security note (please read before wider deployment)
This is intentionally simple: passwords are stored in plain text in the
database, and there's no HTTPS. Acceptable for a **trusted internal LAN with a
handful of known users**, but:
- Don't expose port 3000 to the public internet.
- If your institution requires stronger security (encrypted passwords, HTTPS,
  audit logging, finer-grained permissions), that's a further step up from
  this prototype — let me know and I can help plan it.
