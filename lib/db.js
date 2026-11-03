import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;`);
  db.exec(`
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT, phone TEXT, company TEXT,
    tags TEXT DEFAULT '', notes TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now','localtime')));

  CREATE TABLE IF NOT EXISTS pipelines (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, use_opp_probability INTEGER DEFAULT 0,
    color_mode TEXT DEFAULT 'none', created_at TEXT DEFAULT (datetime('now','localtime')));
  CREATE TABLE IF NOT EXISTS stages (
    id INTEGER PRIMARY KEY, pipeline_id INTEGER NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
    name TEXT NOT NULL, probability INTEGER DEFAULT 0, position INTEGER DEFAULT 0, color TEXT DEFAULT '#3b82f6');
  CREATE TABLE IF NOT EXISTS opportunities (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL,
    contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    pipeline_id INTEGER NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
    stage_id INTEGER REFERENCES stages(id) ON DELETE SET NULL,
    status TEXT DEFAULT 'open', value REAL DEFAULT 0, probability INTEGER,
    owner TEXT DEFAULT '', followers TEXT DEFAULT '', company TEXT DEFAULT '', source TEXT DEFAULT '',
    close_date TEXT, tags TEXT DEFAULT '', notes TEXT DEFAULT '',
    slip_count INTEGER DEFAULT 0, slip_days INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT, closed_at TEXT);

  CREATE TABLE IF NOT EXISTS social_accounts (
    id INTEGER PRIMARY KEY, platform TEXT NOT NULL, name TEXT NOT NULL,
    webhook_url TEXT DEFAULT '', handle TEXT DEFAULT '', secret TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime')));
  CREATE TABLE IF NOT EXISTS social_categories (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, days TEXT DEFAULT '[]', time TEXT DEFAULT '09:00',
    account_ids TEXT DEFAULT '[]', active INTEGER DEFAULT 1, last_run TEXT);
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY, content TEXT NOT NULL, media_url TEXT DEFAULT '', link TEXT DEFAULT '',
    account_ids TEXT DEFAULT '[]', scheduled_at TEXT, status TEXT DEFAULT 'draft',
    category_id INTEGER REFERENCES social_categories(id) ON DELETE SET NULL,
    recurrence TEXT, last_run TEXT, source TEXT DEFAULT 'manuell', last_error TEXT,
    publish_count INTEGER DEFAULT 0, published_at TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')));
  CREATE TABLE IF NOT EXISTS post_log (
    id INTEGER PRIMARY KEY, post_id INTEGER, account_id INTEGER, ok INTEGER, message TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')));
  CREATE TABLE IF NOT EXISTS rss_feeds (
    id INTEGER PRIMARY KEY, name TEXT, url TEXT NOT NULL, account_ids TEXT DEFAULT '[]',
    mode TEXT DEFAULT 'draft', template TEXT DEFAULT '{title}\n\n{link}', seen TEXT DEFAULT '[]',
    last_checked TEXT, last_error TEXT);

  CREATE TABLE IF NOT EXISTS aff_campaigns (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, target_type TEXT DEFAULT 'extern', target_url TEXT NOT NULL,
    commission_type TEXT DEFAULT 'percent', commission_value REAL DEFAULT 10, cookie_days INTEGER DEFAULT 30,
    active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now','localtime')));
  CREATE TABLE IF NOT EXISTS affiliates (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT DEFAULT '', code TEXT UNIQUE NOT NULL,
    campaign_id INTEGER REFERENCES aff_campaigns(id) ON DELETE CASCADE, active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime')));
  CREATE TABLE IF NOT EXISTS aff_clicks (
    id INTEGER PRIMARY KEY, affiliate_id INTEGER REFERENCES affiliates(id) ON DELETE CASCADE,
    referer TEXT, created_at TEXT DEFAULT (datetime('now','localtime')));
  CREATE TABLE IF NOT EXISTS aff_sales (
    id INTEGER PRIMARY KEY, affiliate_id INTEGER REFERENCES affiliates(id) ON DELETE CASCADE,
    campaign_id INTEGER, customer_name TEXT DEFAULT '', customer_email TEXT DEFAULT '',
    amount REAL DEFAULT 0, commission REAL DEFAULT 0, status TEXT DEFAULT 'pending', note TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime')), paid_at TEXT);

  CREATE TABLE IF NOT EXISTS trigger_links (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, target_url TEXT NOT NULL,
    tag TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now','localtime')));
  CREATE TABLE IF NOT EXISTS link_clicks (
    id INTEGER PRIMARY KEY, link_id INTEGER REFERENCES trigger_links(id) ON DELETE CASCADE,
    referer TEXT, created_at TEXT DEFAULT (datetime('now','localtime')));

  CREATE TABLE IF NOT EXISTS audits (
    id INTEGER PRIMARY KEY, token TEXT UNIQUE NOT NULL, business_name TEXT NOT NULL, url TEXT DEFAULT '',
    industry TEXT DEFAULT '', phone TEXT DEFAULT '', address TEXT DEFAULT '', score INTEGER,
    result TEXT, contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    created_at TEXT DEFAULT (datetime('now','localtime')));
  `);

  db.exec(`
  CREATE TABLE IF NOT EXISTS prospects (
    id INTEGER PRIMARY KEY, place_id TEXT UNIQUE, name TEXT NOT NULL, address TEXT DEFAULT '', lat REAL, lng REAL,
    phone TEXT DEFAULT '', website TEXT DEFAULT '', category TEXT DEFAULT '', rating REAL, review_count INTEGER DEFAULT 0,
    photos INTEGER DEFAULT 0, maps_url TEXT DEFAULT '', potential INTEGER, potential_why TEXT DEFAULT '[]',
    status TEXT DEFAULT 'neu', source TEXT DEFAULT 'manuell', audit_id INTEGER, contact_id INTEGER, opportunity_id INTEGER,
    agent_id INTEGER, outreach TEXT, notes TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now','localtime')));
  CREATE TABLE IF NOT EXISTS prospect_agents (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, query TEXT NOT NULL, location TEXT NOT NULL, radius_km REAL DEFAULT 10,
    frequency TEXT DEFAULT 'weekly', weekday INTEGER DEFAULT 1, time TEXT DEFAULT '07:00', only_no_website INTEGER DEFAULT 0,
    min_potential INTEGER DEFAULT 0, max_per_run INTEGER DEFAULT 10, auto_audit INTEGER DEFAULT 1, auto_crm INTEGER DEFAULT 0,
    auto_outreach INTEGER DEFAULT 0, active INTEGER DEFAULT 1, last_run TEXT, last_result TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')));
  CREATE TABLE IF NOT EXISTS report_views (
    id INTEGER PRIMARY KEY, audit_id INTEGER REFERENCES audits(id) ON DELETE CASCADE, referer TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')));
  CREATE TABLE IF NOT EXISTS site_checks (url TEXT PRIMARY KEY, data TEXT, checked_at TEXT DEFAULT (datetime('now','localtime')));
  CREATE TABLE IF NOT EXISTS widget_submissions (
    id INTEGER PRIMARY KEY, name TEXT, email TEXT, phone TEXT, business_name TEXT, url TEXT, audit_id INTEGER, prospect_id INTEGER,
    error TEXT, created_at TEXT DEFAULT (datetime('now','localtime')));
  `);
  const addColumn = (table, col, def) => {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  };
  addColumn('prospects', 'site', 'TEXT');
  addColumn('prospects', 'has_hours', 'INTEGER DEFAULT 0');
  addColumn('audits', 'prospect_id', 'INTEGER');
  addColumn('audits', 'place_id', "TEXT DEFAULT ''");
  addColumn('audits', 'source', "TEXT DEFAULT 'manuell'");
  addColumn('audits', 'heatmaps', "TEXT DEFAULT '[]'");
  // Ältere Audits bekommen einen Interessenten-Eintrag
  for (const a of db.prepare('SELECT * FROM audits WHERE prospect_id IS NULL').all()) {
    const pid = db.prepare(`INSERT INTO prospects (name, address, phone, website, category, status, source, audit_id, contact_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(a.business_name, a.address || '', a.phone || '', a.url || '', a.industry || '', a.contact_id ? 'im CRM' : 'geprüft', a.source || 'manuell', a.id, a.contact_id, a.created_at).lastInsertRowid;
    db.prepare('UPDATE audits SET prospect_id = ? WHERE id = ?').run(pid, a.id);
  }

  // Erststart: Standard-Pipeline anlegen
  const count = db.prepare('SELECT COUNT(*) AS n FROM pipelines').get().n;
  if (!count) {
    const p = db.prepare('INSERT INTO pipelines (name) VALUES (?)').run('Marketing-Pipeline');
    const ins = db.prepare('INSERT INTO stages (pipeline_id, name, probability, position) VALUES (?,?,?,?)');
    [['Neuer Lead', 10], ['Kontaktiert', 20], ['Qualifiziert', 40], ['Angebot gesendet', 60], ['Verhandlung', 80], ['Abgeschlossen', 100]]
      .forEach(([n, pr], i) => ins.run(p.lastInsertRowid, n, pr, i));
  }
  return db;
}

export function getSettings(db) {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
  return out;
}
export function setSettings(db, obj) {
  const st = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, v] of Object.entries(obj)) st.run(k, v == null ? '' : String(v));
}
