const express = require('express');
const path = require('path');
const { db, uid } = require('./db');

const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const BASE_CATS = [
  { k: "Equipment", multi: true },
  { k: "Chemicals and Glasswares", multi: true },
  { k: "Gas", multi: true },
  { k: "Travelling Allowances", multi: false },
  { k: "Guest Lectures", multi: false },
  { k: "University Research Fellowship", multi: false },
  { k: "Equipment Maintenance", multi: false },
  { k: "Contingency/Electrical & Repair works", multi: false },
  { k: "Educational Tours", multi: false },
  { k: "Garden Maintenance", multi: false },
  { k: "Software", multi: false },
  { k: "Mentor Professor/Industrial Expert/Guest Lecture", multi: false }
];
const BASE_PTYPES = ["College Project"];
const STOCK_CATS = ["Equipment", "Chemicals and Glasswares"];
const LOWPCT = 0.10;

function getUser(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}
function requireAdmin(req, res) {
  const actingUserId = req.body.actingUserId || req.query.actingUserId;
  const u = actingUserId && getUser(actingUserId);
  if (!u || u.role !== 'Admin') { res.status(403).json({ error: 'Admin access required.' }); return null; }
  return u;
}
function publicUser(u) { return { id: u.id, name: u.name, username: u.username, role: u.role, lab: u.lab }; }
function allCats() {
  const custom = db.prepare('SELECT k, multi FROM custom_categories').all().map(r => ({ k: r.k, multi: !!r.multi }));
  return BASE_CATS.concat(custom);
}
function allPTypes() {
  return BASE_PTYPES.concat(db.prepare('SELECT name FROM custom_ptypes').all().map(r => r.name));
}
function statusFor(sanc, sp) {
  const bal = sanc - sp;
  if (sanc <= 0) return { bal, tag: 'ok', label: 'No budget set' };
  if (bal < 0) return { bal, tag: 'danger', label: 'Over budget' };
  if (bal < sanc * LOWPCT) return { bal, tag: 'warn', label: 'Low balance' };
  return { bal, tag: 'ok', label: 'Healthy' };
}

// ---------- Auth ----------
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const u = db.prepare('SELECT * FROM users WHERE username = ? AND password = ?').get(username || '', password || '');
  if (!u) return res.status(401).json({ error: 'Incorrect username or password.' });
  res.json(publicUser(u));
});

// ---------- Users (Admin only) ----------
app.get('/api/users', (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json(db.prepare('SELECT id,name,username,role,lab FROM users').all());
});
app.post('/api/users', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { name, username, password, role, lab } = req.body;
  if (!name || !username || !password || !role) return res.status(400).json({ error: 'Missing required fields.' });
  const dup = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (dup) return res.status(409).json({ error: 'That username is already taken.' });
  const id = uid('u_');
  db.prepare('INSERT INTO users (id,name,username,password,role,lab) VALUES (?,?,?,?,?,?)')
    .run(id, name, username, password, role, lab || '');
  res.json(publicUser(getUser(id)));
});

// ---------- Categories & Project Types (shared, extendable by anyone logged in) ----------
app.get('/api/meta', (req, res) => {
  res.json({ cats: allCats(), ptypes: allPTypes(), stockCats: STOCK_CATS });
});
app.post('/api/categories', (req, res) => {
  const { name, multi } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Category name required.' });
  const exists = allCats().some(c => c.k.toLowerCase() === name.trim().toLowerCase());
  if (!exists) db.prepare('INSERT INTO custom_categories (k,multi) VALUES (?,?)').run(name.trim(), multi ? 1 : 0);
  res.json({ cats: allCats() });
});
app.post('/api/ptypes', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Project type name required.' });
  const exists = allPTypes().some(t => t.toLowerCase() === name.trim().toLowerCase());
  if (!exists) db.prepare('INSERT INTO custom_ptypes (name) VALUES (?)').run(name.trim());
  res.json({ ptypes: allPTypes() });
});

// ---------- Projects ----------
function projectSummary(p) {
  const cats = db.prepare('SELECT category, sanctioned FROM project_categories WHERE projectId = ?').all(p.id);
  let totalSanc = 0, totalSpent = 0, flags = 0;
  cats.forEach(c => {
    const spentRow = db.prepare('SELECT COALESCE(SUM(total),0) AS s FROM entries WHERE projectId = ? AND category = ?').get(p.id, c.category);
    const sp = spentRow.s;
    totalSanc += c.sanctioned; totalSpent += sp;
    const st = statusFor(c.sanctioned, sp);
    if (st.tag !== 'ok' && c.sanctioned > 0) flags++;
  });
  const owner = getUser(p.ownerId);
  return {
    id: p.id, ownerId: p.ownerId, ownerName: owner ? owner.name : 'Unknown',
    name: p.name, type: p.type, year: p.year, lab: p.lab, extended: !!p.extended,
    totalSanctioned: totalSanc, totalSpent: totalSpent, flags
  };
}
app.get('/api/projects', (req, res) => {
  const actingUserId = req.query.actingUserId;
  const u = getUser(actingUserId);
  if (!u) return res.status(401).json({ error: 'Not logged in.' });
  const rows = u.role === 'Admin'
    ? db.prepare('SELECT * FROM projects').all()
    : db.prepare('SELECT * FROM projects WHERE ownerId = ?').all(u.id);
  res.json(rows.map(projectSummary));
});
app.get('/api/projects/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found.' });
  const cats = db.prepare('SELECT category, sanctioned FROM project_categories WHERE projectId = ?').all(p.id);
  const catDefs = allCats();
  const detail = cats.map(c => {
    const spentRow = db.prepare('SELECT COALESCE(SUM(total),0) AS s FROM entries WHERE projectId = ? AND category = ?').get(p.id, c.category);
    const st = statusFor(c.sanctioned, spentRow.s);
    const def = catDefs.find(d => d.k === c.category) || { k: c.category, multi: false };
    return { category: c.category, multi: def.multi, sanctioned: c.sanctioned, spent: spentRow.s, balance: st.bal, status: st.tag, label: st.label };
  });
  res.json({ ...projectSummary(p), categories: detail });
});
app.post('/api/projects', (req, res) => {
  const actingUserId = req.body.actingUserId;
  const acting = getUser(actingUserId);
  if (!acting) return res.status(401).json({ error: 'Not logged in.' });
  const { name, type, year, lab, extended, categories, ownerId } = req.body;
  if (!name || !year || !Array.isArray(categories) || categories.length === 0) {
    return res.status(400).json({ error: 'Project name, academic year and at least one category are required.' });
  }
  let finalOwnerId = acting.id;
  if (acting.role === 'Admin') {
    if (!ownerId) return res.status(400).json({ error: 'Admin must assign the project to a professor.' });
    const owner = getUser(ownerId);
    if (!owner || owner.role === 'Admin') return res.status(400).json({ error: 'Invalid professor selected.' });
    finalOwnerId = ownerId;
  }
  const id = uid('p_');
  const insertProject = db.prepare('INSERT INTO projects (id,ownerId,name,type,year,lab,extended,createdAt) VALUES (?,?,?,?,?,?,?,?)');
  const insertCat = db.prepare('INSERT INTO project_categories (projectId,category,sanctioned) VALUES (?,?,?)');
  const tx = db.transaction(() => {
    insertProject.run(id, finalOwnerId, name, type || BASE_PTYPES[0], year, lab || '', extended ? 1 : 0, new Date().toISOString());
    categories.forEach(c => insertCat.run(id, c.k, Number(c.amount) || 0));
  });
  tx();
  res.json(projectSummary(db.prepare('SELECT * FROM projects WHERE id = ?').get(id)));
});

// ---------- Entries ----------
app.get('/api/entries', (req, res) => {
  const projectId = req.query.projectId;
  if (!projectId) return res.status(400).json({ error: 'projectId required.' });
  const entries = db.prepare('SELECT * FROM entries WHERE projectId = ? ORDER BY invoiceDate ASC').all(projectId);
  const itemStmt = db.prepare('SELECT * FROM entry_items WHERE entryId = ?');
  res.json(entries.map(e => ({ ...e, details: JSON.parse(e.detailsJson || '{}'), items: itemStmt.all(e.id) })));
});
app.post('/api/entries', (req, res) => {
  const acting = getUser(req.body.actingUserId);
  if (!acting) return res.status(401).json({ error: 'Not logged in.' });
  const { projectId, category, vendor, invoiceDate, invoiceNo, voucherNo, voucherDate, items, details } = req.body;
  const missing = [];
  if (!vendor) missing.push('Vendor / Payee');
  if (!invoiceDate) missing.push('Invoice Date');
  if (!invoiceNo) missing.push('Invoice No.');
  if (!voucherNo) missing.push('Finance Office Voucher No.');
  if (!voucherDate) missing.push('Voucher Date');
  if (!Array.isArray(items) || !items.length) missing.push('Items / amount');
  if (missing.length) return res.status(400).json({ error: 'Missing required field(s): ' + missing.join(', ') });

  // Recompute totals server-side rather than trusting the client.
  const computedItems = items.map(it => {
    const qty = Number(it.qty) || 0, rate = Number(it.rate) || 0;
    const discPct = Number(it.discPct) || 0, gstPct = Number(it.gstPct) || 0;
    const base = qty * rate;
    const afterDisc = base - (base * discPct / 100);
    const total = afterDisc + (afterDisc * gstPct / 100);
    return { name: (it.name || '').trim(), qty, rate, discPct, gstPct, total, expiry: it.expiry || '' };
  }).filter(it => it.name);
  if (!computedItems.length) return res.status(400).json({ error: 'At least one item with a name is required.' });
  const total = computedItems.reduce((s, i) => s + i.total, 0);

  const entryId = uid('e_');
  const insertEntry = db.prepare(`INSERT INTO entries (id,projectId,category,vendor,invoiceDate,invoiceNo,voucherNo,voucherDate,total,detailsJson,enteredBy,enteredAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertItem = db.prepare('INSERT INTO entry_items (id,entryId,name,qty,rate,discPct,gstPct,total,expiry) VALUES (?,?,?,?,?,?,?,?,?)');
  const insertStock = db.prepare('INSERT INTO stock_tx (id,projectId,category,itemName,type,qty,expiry,refEntryId,note,date,by) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  const tx = db.transaction(() => {
    insertEntry.run(entryId, projectId, category, vendor, invoiceDate, invoiceNo, voucherNo, voucherDate, total, JSON.stringify(details || {}), acting.name, new Date().toISOString());
    computedItems.forEach(it => {
      insertItem.run(uid('it_'), entryId, it.name, it.qty, it.rate, it.discPct, it.gstPct, it.total, it.expiry);
      if (STOCK_CATS.includes(category)) {
        insertStock.run(uid('st_'), projectId, category, it.name, 'in', it.qty, it.expiry, entryId, 'Purchase — Invoice ' + invoiceNo, invoiceDate, acting.name);
      }
    });
  });
  tx();
  res.json({ id: entryId, total, items: computedItems });
});

// ---------- Stock ----------
app.get('/api/stock', (req, res) => {
  const projectId = req.query.projectId;
  if (!projectId) return res.status(400).json({ error: 'projectId required.' });
  const rows = db.prepare(`
    SELECT category, itemName,
      SUM(CASE WHEN type='in' THEN qty ELSE 0 END) AS inQty,
      SUM(CASE WHEN type='out' THEN qty ELSE 0 END) AS outQty,
      MIN(CASE WHEN type='in' AND expiry != '' THEN expiry END) AS nearestExpiry
    FROM stock_tx WHERE projectId = ? GROUP BY category, itemName ORDER BY category, itemName
  `).all(projectId);
  res.json(rows);
});
app.get('/api/stock/tx', (req, res) => {
  const projectId = req.query.projectId;
  res.json(db.prepare('SELECT * FROM stock_tx WHERE projectId = ? ORDER BY date DESC').all(projectId));
});
app.post('/api/stock/issue', (req, res) => {
  const acting = getUser(req.body.actingUserId);
  if (!acting) return res.status(401).json({ error: 'Not logged in.' });
  const { projectId, category, itemName, qty, date, note } = req.body;
  const missing = [];
  if (!itemName) missing.push('Item Name');
  if (!(Number(qty) > 0)) missing.push('Qty Issued');
  if (!date) missing.push('Date');
  if (missing.length) return res.status(400).json({ error: 'Please fill: ' + missing.join(', ') });
  const bal = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN type='in' THEN qty ELSE -qty END),0) AS bal
    FROM stock_tx WHERE projectId = ? AND category = ? AND itemName = ?
  `).get(projectId, category, itemName).bal;
  if (Number(qty) > bal) return res.status(400).json({ error: `Cannot issue ${qty} — only ${bal} in stock for "${itemName}".` });
  db.prepare('INSERT INTO stock_tx (id,projectId,category,itemName,type,qty,expiry,refEntryId,note,date,by) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(uid('st_'), projectId, category, itemName, 'out', Number(qty), '', '', note || '', date, acting.name);
  res.json({ ok: true, newBalance: bal - Number(qty) });
});

// ---------- Academic Year Report (Admin only, computed in SQL) ----------
app.get('/api/years', (req, res) => {
  res.json(db.prepare('SELECT DISTINCT year FROM projects ORDER BY year').all().map(r => r.year));
});
app.get('/api/report', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const year = req.query.year;
  if (!year) return res.status(400).json({ error: 'year required.' });
  const projects = db.prepare('SELECT * FROM projects WHERE year = ?').all(year);
  const byOwner = {};
  projects.forEach(p => {
    if (!byOwner[p.ownerId]) byOwner[p.ownerId] = { projects: [], sanctioned: 0, spent: 0, entryCount: 0 };
    const cats = db.prepare('SELECT category, sanctioned FROM project_categories WHERE projectId = ?').all(p.id);
    let sanc = 0, spent = 0;
    cats.forEach(c => {
      sanc += c.sanctioned;
      spent += db.prepare('SELECT COALESCE(SUM(total),0) AS s FROM entries WHERE projectId = ? AND category = ?').get(p.id, c.category).s;
    });
    const entryCount = db.prepare('SELECT COUNT(*) AS n FROM entries WHERE projectId = ?').get(p.id).n;
    byOwner[p.ownerId].projects.push(p.name);
    byOwner[p.ownerId].sanctioned += sanc;
    byOwner[p.ownerId].spent += spent;
    byOwner[p.ownerId].entryCount += entryCount;
  });
  const rows = Object.keys(byOwner).map(ownerId => {
    const o = byOwner[ownerId];
    const user = getUser(ownerId);
    return { ownerId, ownerName: user ? user.name : 'Unknown', projectCount: o.projects.length, projectNames: o.projects, entryCount: o.entryCount, sanctioned: o.sanctioned, spent: o.spent };
  });
  res.json(rows);
});

// ---------- Backup (full export, for occasional manual backups only — not used for normal reads) ----------
app.get('/api/backup', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const dump = {
    users: db.prepare('SELECT id,name,username,role,lab FROM users').all(),
    projects: db.prepare('SELECT * FROM projects').all(),
    project_categories: db.prepare('SELECT * FROM project_categories').all(),
    entries: db.prepare('SELECT * FROM entries').all(),
    entry_items: db.prepare('SELECT * FROM entry_items').all(),
    stock_tx: db.prepare('SELECT * FROM stock_tx').all(),
    custom_categories: db.prepare('SELECT * FROM custom_categories').all(),
    custom_ptypes: db.prepare('SELECT * FROM custom_ptypes').all()
  };
  res.setHeader('Content-Disposition', 'attachment; filename="fund-manager-backup-' + Date.now() + '.json"');
  res.json(dump);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('Dept. Project Fund Manager server running (SQLite-backed).');
  console.log('On this machine:      http://localhost:' + PORT);
  console.log('On the intranet, find this machine\'s LAN IP (ipconfig / ifconfig) and share:');
  console.log('                       http://<this-machine-LAN-IP>:' + PORT);
});
