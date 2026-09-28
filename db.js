const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'fund_manager.sqlite'));
db.pragma('journal_mode = WAL'); // lets reads and writes happen concurrently without locking each other out

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL,
  lab TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  ownerId TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  year TEXT NOT NULL,
  lab TEXT DEFAULT '',
  extended INTEGER DEFAULT 0,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(ownerId);
CREATE INDEX IF NOT EXISTS idx_projects_year ON projects(year);

CREATE TABLE IF NOT EXISTS project_categories (
  projectId TEXT NOT NULL,
  category TEXT NOT NULL,
  sanctioned REAL DEFAULT 0,
  PRIMARY KEY (projectId, category)
);
CREATE INDEX IF NOT EXISTS idx_pc_project ON project_categories(projectId);

CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL,
  category TEXT NOT NULL,
  vendor TEXT DEFAULT '',
  invoiceDate TEXT,
  invoiceNo TEXT,
  voucherNo TEXT,
  voucherDate TEXT,
  total REAL DEFAULT 0,
  detailsJson TEXT DEFAULT '{}',
  enteredBy TEXT,
  enteredAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_entries_project ON entries(projectId);
CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(invoiceDate);

CREATE TABLE IF NOT EXISTS entry_items (
  id TEXT PRIMARY KEY,
  entryId TEXT NOT NULL,
  name TEXT,
  qty REAL DEFAULT 0,
  rate REAL DEFAULT 0,
  discPct REAL DEFAULT 0,
  gstPct REAL DEFAULT 0,
  total REAL DEFAULT 0,
  expiry TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_items_entry ON entry_items(entryId);

CREATE TABLE IF NOT EXISTS stock_tx (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL,
  category TEXT NOT NULL,
  itemName TEXT NOT NULL,
  type TEXT NOT NULL, -- 'in' or 'out'
  qty REAL DEFAULT 0,
  expiry TEXT DEFAULT '',
  refEntryId TEXT DEFAULT '',
  note TEXT DEFAULT '',
  date TEXT,
  by TEXT
);
CREATE INDEX IF NOT EXISTS idx_stock_project ON stock_tx(projectId);

CREATE TABLE IF NOT EXISTS custom_categories (
  k TEXT PRIMARY KEY,
  multi INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS custom_ptypes (
  name TEXT PRIMARY KEY
);
`);

// Seed the first Admin account if the users table is empty.
const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
if (userCount === 0) {
  db.prepare('INSERT INTO users (id,name,username,password,role,lab) VALUES (?,?,?,?,?,?)')
    .run(uid('u_'), 'Administrator', 'admin', 'admin123', 'Admin', '');
}

function uid(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

module.exports = { db, uid };
