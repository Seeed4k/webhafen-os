process.env.TZ ||= 'Europe/Berlin';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, renameSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, timingSafeEqual } from 'node:crypto';
import { openDb, getSettings, setSettings } from './lib/db.js';
import { token, parseJSON, parseCSV, toCSV, slugify, daysBetween, localStamp } from './lib/util.js';
import { forecast } from './lib/forecast.js';
import { publishPost, runScheduler, checkFeed, PLATFORMS } from './lib/social.js';
import { renderReport, renderWidget } from './lib/report.js';
import { searchArea, leadPotential, heatmapScan, hasPlacesKey } from './lib/places.js';
import { createAudit, auditProspect, prospectToCrm, outreachForProspect, upsertProspect, runAgent, runDueAgents, checkSites, cachedSite } from './lib/prospects.js';
import { emit, resumeDue, startRun, TRIGGERS, STEP_TYPES, presets } from './lib/automation.js';
import { logActivity, createTask, notify } from './lib/crm.js';
import { sendMail, mailReady, outbox } from './lib/mailer.js';
import { slotsFor, availableDays, book, icsInvite, icsFeed, appointmentMail, sendReminders, formatDe, toDate } from './lib/calendar.js';
import { renderBookingPage, renderCancelPage } from './lib/booking-page.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const PASSWORD = process.env.ADMIN_PASSWORD || '';
const DEFAULT_DB = join(ROOT, 'data', 'webhafen-os.db');
// Datenbank aus der Zeit vor der Umbenennung übernehmen (data/cockpit.db)
if (!process.env.DB_FILE && !existsSync(DEFAULT_DB) && existsSync(join(ROOT, 'data', 'cockpit.db'))) {
  for (const ext of ['', '-wal', '-shm']) if (existsSync(join(ROOT, 'data', 'cockpit.db' + ext))) renameSync(join(ROOT, 'data', 'cockpit.db' + ext), DEFAULT_DB + ext);
}
export const db = openDb(process.env.DB_FILE || DEFAULT_DB);
const sessions = new Map();

// ---------- Hilfsfunktionen ----------
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const send = (res, status, body, type = 'application/json; charset=utf-8', extra = {}) => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...extra });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
};
const readBody = (req) => new Promise((resolve, reject) => {
  let size = 0; const chunks = [];
  req.on('data', (c) => { size += c.length; if (size > 5e6) { reject(new HttpError(413, 'Zu groß')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  req.on('error', reject);
});
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(/;\s*/).filter(Boolean).map((c) => { const i = c.indexOf('='); return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))]; }));
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k] === '' && /(_id|value|probability|commission|amount|days)$/.test(k) ? null : obj[k]]));
const need = (v, msg) => { if (v === undefined || v === null || String(v).trim() === '') throw new HttpError(400, msg); return v; };
const asJSON = (v) => (typeof v === 'string' ? v : JSON.stringify(v ?? []));

function insert(table, data) {
  const k = Object.keys(data);
  return db.prepare(`INSERT INTO ${table} (${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`).run(...Object.values(data)).lastInsertRowid;
}
function update(table, id, data) {
  const k = Object.keys(data); if (!k.length) return;
  db.prepare(`UPDATE ${table} SET ${k.map((x) => `${x} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(data), id);
}
const one = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);

// ---------- Router ----------
const routes = [];
const route = (method, path, handler, { pub = false } = {}) => {
  const keys = []; const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, handler, pub });
};

// Generisches CRUD
function crud(base, table, fields, { order = 'id DESC', required = ['name'], prepare = (d) => d, list } = {}) {
  route('GET', base, list || (() => all(`SELECT * FROM ${table} ORDER BY ${order}`)));
  route('POST', base, ({ body }) => { required.forEach((r) => need(body[r], `Feld „${r}“ fehlt`)); const id = insert(table, prepare(pick(body, fields), body)); return one(`SELECT * FROM ${table} WHERE id = ?`, id); });
  route('PUT', base + '/:id', ({ body, params }) => { update(table, params.id, prepare(pick(body, fields), body)); return one(`SELECT * FROM ${table} WHERE id = ?`, params.id); });
  route('DELETE', base + '/:id', ({ params }) => { db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(params.id); return { ok: true }; });
}

// ---------- Auth ----------
route('GET', '/api/session', ({ req }) => ({ loggedIn: !PASSWORD || sessions.has(cookies(req).sid), passwordSet: !!PASSWORD, demo: process.env.DEMO === '1' }), { pub: true });
// Demo-Modus: statt zu versenden werden E-Mails gesammelt und hier angezeigt
route('GET', '/api/demo/outbox', () => {
  if (process.env.DEMO !== '1') throw new HttpError(404, 'Nur im Demo-Modus');
  return outbox.slice(-50).reverse().map((m) => ({ to: m.to, subject: m.subject, text: m.text, ics: !!m.icalEvent }));
});
route('POST', '/api/login', ({ body, res }) => {
  const a = createHash('sha256').update(String(body.password || '')).digest();
  const b = createHash('sha256').update(PASSWORD).digest();
  if (!PASSWORD || !timingSafeEqual(a, b)) throw new HttpError(401, 'Falsches Passwort');
  const sid = token(24); sessions.set(sid, Date.now());
  res.setHeader('set-cookie', `sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${process.env.HTTPS === '1' ? '; Secure' : ''}`);
  return { ok: true };
}, { pub: true });
route('POST', '/api/logout', ({ req, res }) => { sessions.delete(cookies(req).sid); res.setHeader('set-cookie', 'sid=; Path=/; Max-Age=0'); return { ok: true }; });

// ---------- Einstellungen & Dashboard ----------
route('GET', '/api/settings', () => ({ ...getSettings(db), smtp_pass: undefined, smtp_pass_set: !!getSettings(db).smtp_pass, mail_ready: mailReady(db), platforms: PLATFORMS, places_key: !!process.env.GOOGLE_PLACES_API_KEY, pagespeed_key: !!process.env.PAGESPEED_API_KEY, ai_key: !!process.env.ANTHROPIC_API_KEY }));
route('PUT', '/api/settings', ({ body }) => {
  const { platforms, places_key, pagespeed_key, ai_key, smtp_pass_set, mail_ready, ...rest } = body;
  if (rest.smtp_pass === '' || rest.smtp_pass == null) delete rest.smtp_pass; // leeres Feld = Passwort behalten
  setSettings(db, rest); return { ...getSettings(db), smtp_pass: undefined, smtp_pass_set: !!getSettings(db).smtp_pass, mail_ready: mailReady(db) };
});
route('GET', '/api/dashboard', () => {
  const f = forecast(db, null);
  return {
    forecast: f.totals,
    contacts: one('SELECT COUNT(*) n FROM contacts').n,
    posts: Object.fromEntries(all('SELECT status, COUNT(*) n FROM posts GROUP BY status').map((r) => [r.status, r.n])),
    upcoming: all(`SELECT id, content, scheduled_at, status FROM posts WHERE status = 'scheduled' ORDER BY scheduled_at LIMIT 5`),
    affiliate: one(`SELECT COALESCE(SUM(amount),0) revenue, COALESCE(SUM(CASE WHEN status IN ('pending','approved') THEN commission END),0) owed FROM aff_sales WHERE status != 'refunded'`),
    audits: all('SELECT id, token, business_name, score, created_at FROM audits ORDER BY id DESC LIMIT 5'),
    recentOpps: all(`SELECT o.id, o.name, o.value, o.status, s.name stage FROM opportunities o LEFT JOIN stages s ON s.id = o.stage_id ORDER BY o.id DESC LIMIT 5`),
  };
});

// ---------- Kontakte ----------
const CONTACT_FIELDS = ['name', 'email', 'phone', 'company', 'tags', 'notes'];
const tagList = (t) => String(t || '').split(',').map((x) => x.trim()).filter(Boolean);
function contactCreated(id) {
  const c = one('SELECT * FROM contacts WHERE id = ?', id);
  emit(db, 'contact.created', { contact_id: id });
  for (const tag of tagList(c.tags)) emit(db, 'contact.tag_added', { contact_id: id, tag });
}
route('GET', '/api/contacts', () => all('SELECT * FROM contacts ORDER BY name COLLATE NOCASE'));
route('POST', '/api/contacts', ({ body }) => { need(body.name, 'Name fehlt'); const id = insert('contacts', pick(body, CONTACT_FIELDS)); contactCreated(id); return one('SELECT * FROM contacts WHERE id = ?', id); });
route('PUT', '/api/contacts/:id', ({ body, params }) => {
  const old = one('SELECT * FROM contacts WHERE id = ?', params.id); if (!old) throw new HttpError(404, 'Nicht gefunden');
  update('contacts', params.id, pick(body, CONTACT_FIELDS));
  const before = tagList(old.tags).map((t) => t.toLowerCase());
  if (body.tags !== undefined) for (const tag of tagList(body.tags)) if (!before.includes(tag.toLowerCase())) emit(db, 'contact.tag_added', { contact_id: Number(params.id), tag });
  return one('SELECT * FROM contacts WHERE id = ?', params.id);
});
route('DELETE', '/api/contacts/:id', ({ params }) => { db.prepare('DELETE FROM contacts WHERE id = ?').run(params.id); return { ok: true }; });
route('POST', '/api/contacts/import', ({ body }) => {
  let n = 0;
  for (const r of parseCSV(body.csv || '')) {
    const name = r.name || [r.vorname, r.nachname].filter(Boolean).join(' ') || r.firma || r.company;
    if (!name) continue;
    insert('contacts', { name, email: r.email || r['e-mail'] || '', phone: r.phone || r.telefon || '', company: r.company || r.firma || '', tags: r.tags || '' }); n++;
  }
  return { imported: n };
});

// ---------- Pipelines ----------
const pipelineWithStages = (p) => ({ ...p, stages: all('SELECT * FROM stages WHERE pipeline_id = ? ORDER BY position', p.id) });
route('GET', '/api/pipelines', () => all('SELECT * FROM pipelines ORDER BY id').map(pipelineWithStages));
function saveStages(pid, stages = []) {
  const keep = stages.filter((s) => s.id).map((s) => Number(s.id));
  const existing = all('SELECT id FROM stages WHERE pipeline_id = ?', pid).map((s) => s.id);
  for (const id of existing) if (!keep.includes(id)) db.prepare('DELETE FROM stages WHERE id = ?').run(id);
  stages.forEach((s, i) => {
    const d = { name: need(s.name, 'Phasenname fehlt'), probability: Number(s.probability) || 0, position: i, color: s.color || '#3b82f6' };
    if (s.id && existing.includes(Number(s.id))) update('stages', s.id, d); else insert('stages', { ...d, pipeline_id: pid });
  });
}
route('POST', '/api/pipelines', ({ body }) => {
  need(body.name, 'Pipeline-Name fehlt');
  const id = insert('pipelines', { name: body.name, use_opp_probability: body.use_opp_probability ? 1 : 0, color_mode: body.color_mode || 'none' });
  saveStages(id, body.stages); return pipelineWithStages(one('SELECT * FROM pipelines WHERE id = ?', id));
});
route('PUT', '/api/pipelines/:id', ({ body, params }) => {
  update('pipelines', params.id, pick({ ...body, use_opp_probability: body.use_opp_probability ? 1 : 0 }, ['name', 'use_opp_probability', 'color_mode']));
  if (body.stages) saveStages(Number(params.id), body.stages);
  return pipelineWithStages(one('SELECT * FROM pipelines WHERE id = ?', params.id));
});
route('DELETE', '/api/pipelines/:id', ({ params }) => { db.prepare('DELETE FROM pipelines WHERE id = ?').run(params.id); return { ok: true }; });

// ---------- Opportunities (Leads) ----------
const OPP_FIELDS = ['name', 'contact_id', 'pipeline_id', 'stage_id', 'status', 'value', 'probability', 'owner', 'followers', 'company', 'source', 'close_date', 'tags', 'notes'];
const oppQuery = `SELECT o.*, c.name contact_name, c.email contact_email, c.phone contact_phone FROM opportunities o LEFT JOIN contacts c ON c.id = o.contact_id`;
function resolveContact(body) {
  if (body.contact_id) return body.contact_id;
  if (body.contact_name) return insert('contacts', { name: body.contact_name, email: body.contact_email || '', phone: body.contact_phone || '', company: body.company || '' });
  return null;
}
route('GET', '/api/opportunities', ({ query }) => {
  const where = []; const args = [];
  if (query.pipeline_id) { where.push('o.pipeline_id = ?'); args.push(query.pipeline_id); }
  if (query.status) { where.push('o.status = ?'); args.push(query.status); }
  if (query.q) { where.push('(o.name LIKE ? OR c.name LIKE ? OR o.company LIKE ? OR o.tags LIKE ?)'); args.push(...Array(4).fill(`%${query.q}%`)); }
  return all(`${oppQuery} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY o.updated_at DESC, o.id DESC`, ...args);
});
route('POST', '/api/opportunities', ({ body }) => {
  need(body.name, 'Name der Opportunity fehlt'); need(body.pipeline_id, 'Pipeline fehlt');
  const d = pick(body, OPP_FIELDS); d.contact_id = resolveContact(body);
  if (!d.stage_id) d.stage_id = one('SELECT id FROM stages WHERE pipeline_id = ? ORDER BY position LIMIT 1', body.pipeline_id)?.id ?? null;
  d.updated_at = localStamp(); if (d.status && d.status !== 'open') d.closed_at = localStamp();
  const id = insert('opportunities', d);
  if (!body.contact_id && d.contact_id) contactCreated(d.contact_id);
  logActivity(db, { type: 'status', title: `Lead angelegt: ${d.name}`, opportunity_id: id });
  emit(db, 'opportunity.created', { opportunity_id: id, pipeline_id: d.pipeline_id });
  return one(`${oppQuery} WHERE o.id = ?`, id);
});
function oppChanged(old, id) {
  const now = one('SELECT o.*, s.name stage_name FROM opportunities o LEFT JOIN stages s ON s.id = o.stage_id WHERE o.id = ?', id);
  if (!now) return;
  if (now.stage_id !== old.stage_id && now.stage_id) {
    logActivity(db, { type: 'status', title: `Phase → ${now.stage_name}`, opportunity_id: id });
    emit(db, 'opportunity.stage_changed', { opportunity_id: id, pipeline_id: now.pipeline_id, stage_id: now.stage_id });
  }
  if (now.status !== old.status) {
    logActivity(db, { type: 'status', title: `Status → ${({ open: 'Offen', won: 'Gewonnen', lost: 'Verloren', abandoned: 'Aufgegeben' })[now.status] || now.status}`, opportunity_id: id });
    emit(db, 'opportunity.status_changed', { opportunity_id: id, status: now.status });
  }
}
route('PUT', '/api/opportunities/:id', ({ body, params }) => {
  const old = one('SELECT * FROM opportunities WHERE id = ?', params.id); if (!old) throw new HttpError(404, 'Nicht gefunden');
  const d = pick(body, OPP_FIELDS);
  if (body.contact_name && !body.contact_id) d.contact_id = resolveContact(body);
  // Verschiebung des Abschlussdatums nach hinten = "Slip" (für Risiko-Erkennung)
  if (d.close_date && old.close_date && d.close_date > old.close_date) {
    d.slip_count = old.slip_count + 1; d.slip_days = old.slip_days + daysBetween(old.close_date, d.close_date);
  }
  if (d.status && d.status !== old.status) d.closed_at = d.status === 'open' ? null : localStamp();
  d.updated_at = localStamp();
  update('opportunities', params.id, d);
  if (d.contact_id && d.contact_id !== old.contact_id && !body.contact_id) contactCreated(d.contact_id);
  oppChanged(old, Number(params.id));
  return one(`${oppQuery} WHERE o.id = ?`, params.id);
});
route('DELETE', '/api/opportunities/:id', ({ params }) => { db.prepare('DELETE FROM opportunities WHERE id = ?').run(params.id); return { ok: true }; });
route('POST', '/api/opportunities/bulk', ({ body }) => {
  const ids = (body.ids || []).map(Number);
  for (const id of ids) {
    const old = one('SELECT * FROM opportunities WHERE id = ?', id); if (!old) continue;
    if (body.action === 'delete') db.prepare('DELETE FROM opportunities WHERE id = ?').run(id);
    else if (body.action === 'status') update('opportunities', id, { status: body.value, closed_at: body.value === 'open' ? null : localStamp(), updated_at: localStamp() });
    else if (body.action === 'stage') update('opportunities', id, { stage_id: body.value, updated_at: localStamp() });
    else if (body.action === 'tag') db.prepare(`UPDATE opportunities SET tags = TRIM(COALESCE(tags,'') || ',' || ?, ',') WHERE id = ?`).run(body.value, id);
    if (body.action !== 'delete') oppChanged(old, id);
  }
  return { ok: true, count: ids.length };
});
route('POST', '/api/opportunities/import', ({ body }) => {
  const pid = need(body.pipeline_id, 'Pipeline fehlt');
  const stages = all('SELECT * FROM stages WHERE pipeline_id = ? ORDER BY position', pid);
  let n = 0;
  for (const r of parseCSV(body.csv || '')) {
    const name = r.name || r.opportunity || r.titel; if (!name) continue;
    const stage = stages.find((s) => s.name.toLowerCase() === (r.phase || r.stage || '').toLowerCase()) || stages[0];
    const contact_id = r.kontakt || r.contact ? resolveContact({ contact_name: r.kontakt || r.contact, contact_email: r.email, contact_phone: r.telefon || r.phone, company: r.firma }) : null;
    insert('opportunities', { name, pipeline_id: pid, stage_id: stage?.id ?? null, contact_id, value: Number(String(r.wert || r.value || 0).replace(/\./g, '').replace(',', '.')) || 0,
      company: r.firma || r.company || '', source: r.quelle || r.source || '', close_date: r.abschluss || r.close_date || null, tags: r.tags || '', updated_at: localStamp() });
    n++;
  }
  return { imported: n };
});
route('GET', '/api/forecast', ({ query }) => forecast(db, query.pipeline_id ? Number(query.pipeline_id) : null));

// ---------- Social Planner ----------
crud('/api/social/accounts', 'social_accounts', ['platform', 'name', 'webhook_url', 'handle', 'secret'], {
  list: () => all('SELECT id, platform, name, webhook_url, handle, CASE WHEN secret != \'\' THEN 1 ELSE 0 END has_secret, created_at FROM social_accounts ORDER BY platform, name'),
  prepare: (d) => { if (d.secret === '') delete d.secret; return d; },
});
const POST_FIELDS = ['content', 'media_url', 'link', 'account_ids', 'scheduled_at', 'status', 'category_id', 'recurrence'];
const postPrep = (d) => {
  if (d.account_ids !== undefined) d.account_ids = asJSON(d.account_ids);
  if (d.recurrence !== undefined) d.recurrence = d.recurrence ? asJSON(d.recurrence) : null;
  if (d.scheduled_at) d.scheduled_at = String(d.scheduled_at).replace('T', ' ').slice(0, 16);
  return d;
};
crud('/api/social/posts', 'posts', POST_FIELDS, { required: ['content'], prepare: postPrep,
  list: ({ query }) => all(`SELECT * FROM posts ${query.status ? 'WHERE status = ?' : ''} ORDER BY COALESCE(scheduled_at, created_at) DESC`, ...(query.status ? [query.status] : [])) });
route('POST', '/api/social/posts/:id/publish', async ({ params }) => {
  const p = one('SELECT * FROM posts WHERE id = ?', params.id); if (!p) throw new HttpError(404, 'Nicht gefunden');
  return publishPost(db, p, { keepStatus: ['recurring', 'evergreen'].includes(p.status) });
});
route('GET', '/api/social/posts/:id/log', ({ params }) => all('SELECT l.*, a.name account_name, a.platform FROM post_log l LEFT JOIN social_accounts a ON a.id = l.account_id WHERE post_id = ? ORDER BY l.id DESC', params.id));
route('POST', '/api/social/import', ({ body }) => {
  // CSV-Spalten: text/inhalt, datum (YYYY-MM-DD HH:MM oder DD.MM.YYYY HH:MM), bild, link, konten (Namen, mit | getrennt)
  const accounts = all('SELECT id, name, platform FROM social_accounts');
  let n = 0; const errors = [];
  parseCSV(body.csv || '').forEach((r, i) => {
    const content = r.text || r.inhalt || r.content || r.beitrag; if (!content) { errors.push(`Zeile ${i + 2}: kein Text`); return; }
    let when = r.datum || r.date || r.zeit || r.scheduled_at || '';
    const de = when.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\s*(\d{1,2}:\d{2})?/);
    if (de) when = `${de[3]}-${de[2].padStart(2, '0')}-${de[1].padStart(2, '0')} ${(de[4] || '09:00').padStart(5, '0')}`;
    const names = (r.konten || r.accounts || r.plattformen || '').split(/[|,]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    const ids = names.length ? accounts.filter((a) => names.includes(a.name.toLowerCase()) || names.includes(a.platform)).map((a) => a.id) : (body.account_ids || []);
    insert('posts', { content, media_url: r.bild || r.image || r.media_url || '', link: r.link || '', account_ids: JSON.stringify(ids),
      scheduled_at: when ? when.replace('T', ' ').slice(0, 16) : null, status: when ? 'scheduled' : 'draft', source: 'CSV-Import' });
    n++;
  });
  return { imported: n, errors };
});
crud('/api/social/categories', 'social_categories', ['name', 'days', 'time', 'account_ids', 'active'], {
  order: 'name', prepare: (d) => { if (d.days !== undefined) d.days = asJSON(d.days); if (d.account_ids !== undefined) d.account_ids = asJSON(d.account_ids); return d; },
  list: () => all(`SELECT c.*, (SELECT COUNT(*) FROM posts p WHERE p.category_id = c.id AND p.status = 'evergreen') post_count FROM social_categories c ORDER BY name`),
});
crud('/api/social/feeds', 'rss_feeds', ['name', 'url', 'account_ids', 'mode', 'template'], {
  required: ['url'], prepare: (d) => { if (d.account_ids !== undefined) d.account_ids = asJSON(d.account_ids); return d; },
  list: () => all('SELECT id, name, url, account_ids, mode, template, last_checked, last_error FROM rss_feeds ORDER BY id DESC'),
});
route('POST', '/api/social/feeds/:id/check', ({ params }) => checkFeed(db, one('SELECT * FROM rss_feeds WHERE id = ?', params.id)));

// ---------- Affiliate-Manager ----------
crud('/api/aff/campaigns', 'aff_campaigns', ['name', 'target_type', 'target_url', 'commission_type', 'commission_value', 'cookie_days', 'active'], {
  required: ['name', 'target_url'],
  list: () => all(`SELECT c.*, (SELECT COUNT(*) FROM affiliates a WHERE a.campaign_id = c.id) affiliate_count,
    (SELECT COALESCE(SUM(amount),0) FROM aff_sales s WHERE s.campaign_id = c.id AND s.status != 'refunded') revenue FROM aff_campaigns c ORDER BY id DESC`),
});
crud('/api/aff/affiliates', 'affiliates', ['name', 'email', 'code', 'campaign_id', 'active'], {
  required: ['name', 'campaign_id'],
  prepare: (d, body) => { if (body.code !== undefined || !body.id) d.code = slugify(body.code || body.name + '-' + token(2)); return d; },
  list: () => all(`SELECT a.*, c.name campaign_name,
    (SELECT COUNT(*) FROM aff_clicks k WHERE k.affiliate_id = a.id) clicks,
    (SELECT COUNT(*) FROM aff_sales s WHERE s.affiliate_id = a.id AND s.status != 'refunded') sales,
    (SELECT COALESCE(SUM(amount),0) FROM aff_sales s WHERE s.affiliate_id = a.id AND s.status != 'refunded') revenue,
    (SELECT COALESCE(SUM(commission),0) FROM aff_sales s WHERE s.affiliate_id = a.id AND s.status IN ('pending','approved')) owed
    FROM affiliates a LEFT JOIN aff_campaigns c ON c.id = a.campaign_id ORDER BY a.id DESC`),
});
function commissionFor(campaign, amount) {
  return campaign.commission_type === 'fixed' ? Number(campaign.commission_value) : Math.round(amount * campaign.commission_value) / 100;
}
function recordSale({ code, affiliate_id, amount, customer_name = '', customer_email = '', note = '' }) {
  const a = affiliate_id ? one('SELECT * FROM affiliates WHERE id = ?', affiliate_id) : one('SELECT * FROM affiliates WHERE code = ?', code);
  if (!a) throw new HttpError(404, 'Affiliate nicht gefunden');
  const c = one('SELECT * FROM aff_campaigns WHERE id = ?', a.campaign_id);
  amount = Number(String(amount).replace(',', '.')) || 0;
  const id = insert('aff_sales', { affiliate_id: a.id, campaign_id: c.id, customer_name, customer_email, amount, commission: commissionFor(c, amount), note });
  return one('SELECT * FROM aff_sales WHERE id = ?', id);
}
const salesQuery = `SELECT s.*, a.name affiliate_name, a.code, c.name campaign_name FROM aff_sales s LEFT JOIN affiliates a ON a.id = s.affiliate_id LEFT JOIN aff_campaigns c ON c.id = s.campaign_id`;
route('GET', '/api/aff/sales', ({ query }) => all(`${salesQuery} ${query.status ? 'WHERE s.status = ?' : ''} ORDER BY s.id DESC`, ...(query.status ? [query.status] : [])));
route('POST', '/api/aff/sales', ({ body }) => recordSale(body));
route('PUT', '/api/aff/sales/:id', ({ body, params }) => {
  const d = pick(body, ['status', 'note', 'commission']); if (d.status === 'paid') d.paid_at = localStamp();
  update('aff_sales', params.id, d); return one('SELECT * FROM aff_sales WHERE id = ?', params.id);
});
route('DELETE', '/api/aff/sales/:id', ({ params }) => { db.prepare('DELETE FROM aff_sales WHERE id = ?').run(params.id); return { ok: true }; });
route('GET', '/api/aff/dashboard', ({ query }) => {
  const from = query.from || '0000'; const to = (query.to || '9999') + ' 23:59';
  const cf = query.campaign_id ? ' AND s.campaign_id = ' + Number(query.campaign_id) : '';
  const s = one(`SELECT COALESCE(SUM(amount),0) revenue, COUNT(*) sales, COUNT(DISTINCT COALESCE(NULLIF(customer_email,''), customer_name, s.id)) customers,
    COALESCE(SUM(CASE WHEN status IN ('pending','approved') THEN commission END),0) owed, COALESCE(SUM(CASE WHEN status = 'paid' THEN commission END),0) paid,
    COUNT(CASE WHEN status = 'pending' THEN 1 END) pending_count, COUNT(CASE WHEN status = 'approved' THEN 1 END) approved_count
    FROM aff_sales s WHERE status != 'refunded' AND created_at BETWEEN ? AND ? ${cf}`, from, to);
  const refunded = one(`SELECT COUNT(*) n FROM aff_sales s WHERE status = 'refunded' AND created_at BETWEEN ? AND ? ${cf}`, from, to).n;
  const clicks = one(`SELECT COUNT(*) n FROM aff_clicks k JOIN affiliates a ON a.id = k.affiliate_id WHERE k.created_at BETWEEN ? AND ? ${query.campaign_id ? 'AND a.campaign_id = ' + Number(query.campaign_id) : ''}`, from, to).n;
  const daily = all(`SELECT substr(created_at,1,10) day, SUM(amount) revenue, SUM(commission) commission FROM aff_sales s WHERE status != 'refunded' AND created_at BETWEEN ? AND ? ${cf} GROUP BY day ORDER BY day`, from, to);
  const top = all(`SELECT a.id, a.name, COALESCE(SUM(s.amount),0) revenue, COUNT(s.id) sales FROM affiliates a JOIN aff_sales s ON s.affiliate_id = a.id AND s.status != 'refunded' AND s.created_at BETWEEN ? AND ? ${cf} GROUP BY a.id ORDER BY revenue DESC LIMIT 5`, from, to);
  return { ...s, refunded, clicks, conversion: clicks ? Math.round((s.sales / clicks) * 1000) / 10 : 0, affiliates: one('SELECT COUNT(*) n FROM affiliates').n, daily, top };
});
route('GET', '/api/aff/sales.csv', ({ res }) => {
  const rows = all(`${salesQuery} ORDER BY s.id DESC`);
  send(res, 200, toCSV(rows, [{ key: 'created_at', label: 'Datum' }, { key: 'status', label: 'Status' }, { key: 'amount', label: 'Umsatz' }, { key: 'commission', label: 'Provision' },
    { key: 'affiliate_name', label: 'Affiliate' }, { key: 'code', label: 'Code' }, { key: 'campaign_name', label: 'Kampagne' }, { key: 'customer_name', label: 'Kunde' }, { key: 'customer_email', label: 'E-Mail' }]),
  'text/csv; charset=utf-8', { 'content-disposition': 'attachment; filename="provisionen.csv"' });
});

// Öffentlich: Affiliate-Link
route('GET', '/go/:code', ({ params, req, res }) => {
  const a = one('SELECT a.*, c.target_url, c.cookie_days, c.active campaign_active FROM affiliates a JOIN aff_campaigns c ON c.id = a.campaign_id WHERE a.code = ?', params.code);
  if (!a || !a.active || !a.campaign_active) throw new HttpError(404, 'Link nicht gefunden');
  insert('aff_clicks', { affiliate_id: a.id, referer: req.headers.referer || '' });
  const target = new URL(a.target_url); target.searchParams.set('ref', a.code);
  res.writeHead(302, { location: target.toString(), 'set-cookie': `aff_ref=${a.code}; Path=/; Max-Age=${a.cookie_days * 86400}; SameSite=Lax` });
  res.end(); return null;
}, { pub: true });
// Öffentlich: Verkauf melden (z. B. vom Shop/Formular per Webhook)
route('POST', '/api/public/sale', ({ body }) => {
  const key = getSettings(db).aff_api_key;
  if (!key || body.key !== key) throw new HttpError(403, 'Ungültiger API-Schlüssel');
  const s = recordSale({ code: body.ref || body.code, amount: body.amount, customer_name: body.customer_name || body.name, customer_email: body.customer_email || body.email, note: body.note || 'API' });
  return { ok: true, id: s.id, commission: s.commission };
}, { pub: true });

// ---------- Trigger-Links ----------
crud('/api/links', 'trigger_links', ['name', 'slug', 'target_url', 'tag'], {
  required: ['name', 'target_url'],
  prepare: (d, body) => { if (body.slug !== undefined || !body.id) d.slug = slugify(body.slug || body.name); return d; },
  list: () => all(`SELECT l.*, (SELECT COUNT(*) FROM link_clicks k WHERE k.link_id = l.id) clicks,
    (SELECT COUNT(*) FROM link_clicks k WHERE k.link_id = l.id AND k.created_at >= datetime('now','localtime','-7 days')) clicks_7d FROM trigger_links l ORDER BY id DESC`),
});
route('GET', '/l/:slug', ({ params, req, res }) => {
  const l = one('SELECT * FROM trigger_links WHERE slug = ?', params.slug); if (!l) throw new HttpError(404, 'Link nicht gefunden');
  insert('link_clicks', { link_id: l.id, referer: req.headers.referer || '' });
  res.writeHead(302, { location: l.target_url }); res.end(); return null;
}, { pub: true });

// ---------- Website-Audits ----------
route('GET', '/api/audits', () => all(`SELECT a.id, a.token, a.business_name, a.url, a.industry, a.score, a.source, a.prospect_id, a.created_at,
  (SELECT COUNT(*) FROM report_views v WHERE v.audit_id = a.id) views FROM audits a ORDER BY a.id DESC`));
route('GET', '/api/audits/:id', ({ params }) => {
  const a = one('SELECT * FROM audits WHERE id = ?', params.id); if (!a) throw new HttpError(404, 'Nicht gefunden');
  return { ...a, result: parseJSON(a.result, null), heatmaps: parseJSON(a.heatmaps, []), views: one('SELECT COUNT(*) n FROM report_views WHERE audit_id = ?', a.id).n,
    prospect: a.prospect_id ? one('SELECT * FROM prospects WHERE id = ?', a.prospect_id) : null };
});
const auditError = (e) => new HttpError(e.status || 422, e.status ? e.message : `Website konnte nicht geprüft werden: ${e.cause?.code || e.message}`);
route('POST', '/api/audits', async ({ body }) => {
  need(body.business_name, 'Firmenname fehlt');
  if (!body.url && !hasPlacesKey()) throw new HttpError(400, 'Website fehlt');
  try { return await createAudit(db, body, { source: body.source || 'manuell', prospect_id: body.prospect_id ? Number(body.prospect_id) : null }); } catch (e) { throw auditError(e); }
});
route('POST', '/api/audits/:id/to-lead', ({ params }) => {
  const a = one('SELECT * FROM audits WHERE id = ?', params.id); if (!a) throw new HttpError(404, 'Nicht gefunden');
  return toCrm(a.prospect_id);
});
route('POST', '/api/audits/:id/heatmap', async ({ params, body }) => {
  const a = one('SELECT * FROM audits WHERE id = ?', params.id); if (!a) throw new HttpError(404, 'Nicht gefunden');
  const place = parseJSON(a.result, {}).meta?.place;
  if (!place?.lat) throw new HttpError(400, 'Für eine Heatmap muss das Google-Unternehmensprofil gefunden worden sein (GOOGLE_PLACES_API_KEY).');
  const scan = await heatmapScan({ keyword: need(body.keyword, 'Suchbegriff fehlt'), lat: place.lat, lng: place.lng, placeId: place.place_id, size: Number(body.size) || 3, radiusKm: Number(body.radius_km) || 3 });
  const maps = [scan, ...parseJSON(a.heatmaps, []).filter((h) => h.keyword.toLowerCase() !== scan.keyword.toLowerCase())].slice(0, 5);
  update('audits', a.id, { heatmaps: JSON.stringify(maps) });
  return scan;
});
route('DELETE', '/api/audits/:id', ({ params }) => {
  db.prepare('UPDATE prospects SET audit_id = NULL WHERE audit_id = ?').run(params.id);
  db.prepare('DELETE FROM audits WHERE id = ?').run(params.id); return { ok: true };
});
route('GET', '/bericht/:token', ({ params, req, res, query }) => {
  const a = one('SELECT * FROM audits WHERE token = ?', params.token); if (!a) throw new HttpError(404, 'Bericht nicht gefunden');
  if (!query.vorschau && !/bot|crawl|spider|preview|facebookexternalhit|whatsapp/i.test(req.headers['user-agent'] || '')) {
    // Nur der erste Aufruf innerhalb von 24 Stunden löst Automationen aus
    const recent = one(`SELECT COUNT(*) n FROM report_views WHERE audit_id = ? AND created_at >= datetime('now','localtime','-1 day')`, a.id).n;
    insert('report_views', { audit_id: a.id, referer: req.headers.referer || '' });
    if (!recent) {
      const pr = a.prospect_id ? one('SELECT * FROM prospects WHERE id = ?', a.prospect_id) : null;
      const contact_id = pr?.contact_id || a.contact_id || null;
      if (contact_id) logActivity(db, { type: 'bericht', title: `Website-Check-Bericht geöffnet (${a.score} %)`, contact_id, prospect_id: pr?.id });
      emit(db, 'report.viewed', { audit_id: a.id, prospect_id: pr?.id ?? null, contact_id });
    }
  }
  send(res, 200, renderReport({ ...a, result: parseJSON(a.result, {}), heatmaps: parseJSON(a.heatmaps, []) }, getSettings(db)), 'text/html; charset=utf-8'); return null;
}, { pub: true });

// ---------- Interessenten & Lead-Finder ----------
function toCrm(prospectId) {
  const before = one('SELECT contact_id FROM prospects WHERE id = ?', prospectId);
  const r = prospectToCrm(db, prospectId);
  if (!r.existed) {
    if (!before?.contact_id) contactCreated(r.contact_id);
    logActivity(db, { type: 'status', title: 'Aus der Akquise ins CRM übernommen', opportunity_id: r.opportunity_id, prospect_id: Number(prospectId) });
    emit(db, 'opportunity.created', { opportunity_id: r.opportunity_id });
  }
  return r;
}
const prospectQuery = `SELECT p.*, a.score audit_score, a.token audit_token, (SELECT COUNT(*) FROM report_views v WHERE v.audit_id = p.audit_id) views FROM prospects p LEFT JOIN audits a ON a.id = p.audit_id`;
route('GET', '/api/prospects', ({ query }) => {
  const where = []; const args = [];
  if (query.status) { where.push('p.status = ?'); args.push(query.status); }
  if (query.source) { where.push('p.source = ?'); args.push(query.source); }
  if (query.q) { where.push('(p.name LIKE ? OR p.address LIKE ? OR p.category LIKE ?)'); args.push(...Array(3).fill(`%${query.q}%`)); }
  return all(`${prospectQuery} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.id DESC`, ...args);
});
route('POST', '/api/prospects/search', async ({ body }) => {
  need(body.query, 'Suchbegriff fehlt'); need(body.location, 'Standort fehlt');
  const r = await searchArea({ query: body.query, location: body.location, radiusKm: Number(body.radius_km) || 5 });
  const known = new Map(all('SELECT id, place_id, status FROM prospects WHERE place_id IS NOT NULL').map((p) => [p.place_id, p]));
  return { center: r.center, results: r.results.map((p) => { const site = cachedSite(db, p.website); return { ...p, site, potential: leadPotential(p, site), prospect: known.get(p.place_id) || null }; }) };
});
// Websites der Treffer schnell prüfen (Baukasten, Mobilfähigkeit, https …) und Potenzial neu berechnen
route('POST', '/api/prospects/quick-check', async ({ body }) => {
  const items = (body.items || []).slice(0, 20);
  const sites = await checkSites(db, items.map((p) => p.website));
  return items.map((p) => ({ place_id: p.place_id, site: sites[p.website] || null, potential: leadPotential(p, sites[p.website]) }));
});
route('POST', '/api/prospects', async ({ body }) => {
  // Einzeln oder mehrere Treffer aus dem Lead-Finder übernehmen; optional sofort prüfen
  const items = body.items || [body];
  const out = [];
  for (const it of items) {
    need(it.name, 'Name fehlt');
    const r = upsertProspect(db, it, { source: it.source || (it.place_id ? 'lead-finder' : 'manuell') });
    if (body.audit && r.created) { try { await auditProspect(db, r.id); } catch (e) { out.push({ ...r, error: e.message }); continue; } }
    out.push(r);
  }
  return { added: out.filter((r) => r.created).length, items: out };
});
route('PUT', '/api/prospects/:id', ({ params, body }) => { update('prospects', params.id, pick(body, ['name', 'address', 'phone', 'website', 'category', 'status', 'notes'])); return one(`${prospectQuery} WHERE p.id = ?`, params.id); });
route('DELETE', '/api/prospects/:id', ({ params }) => { db.prepare('DELETE FROM prospects WHERE id = ?').run(params.id); return { ok: true }; });
route('POST', '/api/prospects/:id/audit', async ({ params }) => { try { return await auditProspect(db, params.id); } catch (e) { throw auditError(e); } });
route('POST', '/api/prospects/:id/crm', ({ params }) => toCrm(params.id));
route('POST', '/api/prospects/:id/outreach', ({ params }) => outreachForProspect(db, params.id));

// ---------- Prospect-Agent ----------
crud('/api/agents', 'prospect_agents', ['name', 'query', 'location', 'radius_km', 'frequency', 'weekday', 'time', 'only_no_website', 'min_potential', 'max_per_run', 'auto_audit', 'auto_crm', 'auto_outreach', 'active'], {
  required: ['name', 'query', 'location'],
  list: () => all(`SELECT g.*, (SELECT COUNT(*) FROM prospects p WHERE p.agent_id = g.id) prospect_count FROM prospect_agents g ORDER BY g.id DESC`),
});
route('POST', '/api/agents/:id/run', async ({ params }) => {
  const g = one('SELECT * FROM prospect_agents WHERE id = ?', params.id); if (!g) throw new HttpError(404, 'Nicht gefunden');
  return runAgent(db, g);
});

// ---------- Analytics (Prospecting) ----------
route('GET', '/api/analytics', ({ query }) => {
  const months = Math.min(24, Number(query.months) || 6);
  const since = new Date(); since.setDate(1); since.setMonth(since.getMonth() - months + 1);
  const from = since.toISOString().slice(0, 10);
  const keys = []; for (let i = 0; i < months; i++) { const d = new Date(since); d.setMonth(since.getMonth() + i); keys.push(d.toISOString().slice(0, 7)); }
  const series = (sql) => { const m = Object.fromEntries(all(sql, from).map((r) => [r.k + '|' + (r.s || ''), r.n])); return m; };
  const reports = series(`SELECT substr(created_at,1,7) k, source s, COUNT(*) n FROM audits WHERE created_at >= ? GROUP BY k, s`);
  const views = series(`SELECT substr(created_at,1,7) k, '' s, COUNT(*) n FROM report_views WHERE created_at >= ? GROUP BY k`);
  const sources = ['manuell', 'lead-finder', 'agent', 'widget'];
  const weeks = Math.max(1, months * 4.345);
  const prospects = one('SELECT COUNT(*) n FROM prospects WHERE created_at >= ?', from).n;
  return {
    totals: {
      reports: one('SELECT COUNT(*) n FROM audits WHERE created_at >= ?', from).n,
      contacts: one('SELECT COUNT(*) n FROM prospects WHERE contact_id IS NOT NULL AND created_at >= ?', from).n,
      prospects, per_week: Math.round((prospects / weeks) * 10) / 10,
      views: one('SELECT COUNT(*) n FROM report_views WHERE created_at >= ?', from).n,
    },
    months: keys,
    reports_by_month: keys.map((k) => Object.fromEntries([['month', k], ...sources.map((s) => [s, reports[k + '|' + s] || 0])])),
    views_by_month: keys.map((k) => ({ month: k, views: views[k + '|'] || 0 })),
    contacts_by_source: sources.map((s) => ({ source: s, n: one('SELECT COUNT(*) n FROM prospects WHERE contact_id IS NOT NULL AND source = ? AND created_at >= ?', s, from).n })),
    top_reports: all(`SELECT a.id, a.business_name, a.score, COUNT(v.id) views, MAX(v.created_at) last_view FROM audits a JOIN report_views v ON v.audit_id = a.id GROUP BY a.id ORDER BY views DESC LIMIT 10`),
    widget: all('SELECT w.*, a.score FROM widget_submissions w LEFT JOIN audits a ON a.id = w.audit_id ORDER BY w.id DESC LIMIT 20'),
  };
});

// ---------- Website-Check-Widget (öffentlich, zum Einbetten auf der eigenen Website) ----------
const hits = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now(); const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) return false; arr.push(now); hits.set(key, arr); return true;
}
route('GET', '/widget', ({ res }) => { send(res, 200, renderWidget(getSettings(db)), 'text/html; charset=utf-8', { 'cache-control': 'public, max-age=300' }); return null; }, { pub: true });
route('GET', '/widget.js', ({ res }) => {
  const base = (getSettings(db).public_url || '').replace(/\/$/, '');
  send(res, 200, `(function(){var el=document.getElementById('webhafen-check')||document.currentScript.parentNode.insertBefore(document.createElement('div'),document.currentScript);
var f=document.createElement('iframe');f.src='${base}/widget';f.title='Kostenloser Website-Check';f.loading='lazy';f.style.cssText='width:100%;border:0;min-height:560px;border-radius:14px';
el.appendChild(f);window.addEventListener('message',function(e){if(e.source===f.contentWindow&&e.data&&e.data.wcHeight){f.style.height=e.data.wcHeight+'px'}});})();`,
  'text/javascript; charset=utf-8', { 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' }); return null;
}, { pub: true });
route('POST', '/api/public/widget', async ({ body, req }) => {
  if (body.website_hp) throw new HttpError(400, 'Ungültig'); // Honeypot gegen Bots
  need(body.business_name, 'Bitte den Firmennamen angeben'); need(body.url, 'Bitte die Website angeben'); need(body.email, 'Bitte eine E-Mail-Adresse angeben');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) throw new HttpError(400, 'Bitte eine gültige E-Mail-Adresse angeben');
  if (!body.consent) throw new HttpError(400, 'Bitte der Kontaktaufnahme zustimmen');
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const ipKey = createHash('sha256').update(ip + (process.env.ADMIN_PASSWORD || '')).digest('hex').slice(0, 16);
  if (!rateLimit('w:' + ipKey, 3, 3600e3) || !rateLimit('w:all', 50, 86400e3)) throw new HttpError(429, 'Zu viele Anfragen – bitte später erneut versuchen.');
  const sub = insert('widget_submissions', { name: body.name || '', email: body.email, phone: body.phone || '', business_name: body.business_name, url: body.url });
  try {
    const a = await createAudit(db, { business_name: body.business_name, url: body.url, phone: body.phone || '' }, { source: 'widget' });
    const contact_id = insert('contacts', { name: body.name || body.business_name, email: body.email, phone: body.phone || '', company: body.business_name, tags: 'widget,website-check', notes: `Website-Check über Widget: ${a.score} %\nEinwilligung zur Kontaktaufnahme: ${localStamp()}` });
    update('prospects', a.prospect_id, { contact_id, status: 'im CRM' });
    const crm = prospectToCrm(db, a.prospect_id);
    update('widget_submissions', sub, { audit_id: a.id, prospect_id: a.prospect_id });
    logActivity(db, { type: 'bericht', title: `Website-Check über Widget angefragt (${a.score} %)`, contact_id, prospect_id: a.prospect_id });
    contactCreated(contact_id);
    emit(db, 'widget.submitted', { contact_id, audit_id: a.id, prospect_id: a.prospect_id, opportunity_id: crm.opportunity_id });
    return { ok: true, score: a.score, report_url: `/bericht/${a.token}` };
  } catch (e) {
    update('widget_submissions', sub, { error: e.message });
    throw new HttpError(422, 'Die Website konnte nicht geprüft werden. Bitte Adresse prüfen.');
  }
}, { pub: true });

// ---------- Aufgaben ----------
const taskQuery = `SELECT t.*, c.name contact_name, o.name opportunity_name, p.name prospect_name FROM tasks t
  LEFT JOIN contacts c ON c.id = t.contact_id LEFT JOIN opportunities o ON o.id = t.opportunity_id LEFT JOIN prospects p ON p.id = t.prospect_id`;
const TASK_FIELDS = ['title', 'notes', 'due_at', 'priority', 'contact_id', 'opportunity_id', 'prospect_id'];
const normDue = (v) => (v ? String(v).replace('T', ' ').slice(0, 16) : null);
route('GET', '/api/tasks', ({ query }) => {
  const where = []; const args = []; const now = localStamp(); const today = now.slice(0, 10);
  if (query.status === 'erledigt') where.push(`t.status = 'erledigt'`); else where.push(`t.status = 'offen'`);
  if (query.scope === 'heute') { where.push('t.due_at IS NOT NULL AND substr(t.due_at,1,10) <= ?'); args.push(today); }
  // Aufgaben ohne Uhrzeit (nur Datum) sind erst am Folgetag überfällig
  if (query.scope === 'ueberfaellig') { where.push(`t.due_at IS NOT NULL AND ((length(t.due_at) <= 10 AND t.due_at < ?) OR (length(t.due_at) > 10 AND t.due_at < ?))`); args.push(today, now); }
  if (query.scope === 'woche') { const w = new Date(); w.setDate(w.getDate() + 7); where.push('t.due_at IS NOT NULL AND t.due_at <= ?'); args.push(localStamp(w)); }
  for (const k of ['contact_id', 'opportunity_id', 'prospect_id']) if (query[k]) { where.push(`t.${k} = ?`); args.push(query[k]); }
  const order = query.status === 'erledigt' ? 't.done_at DESC' : `CASE WHEN t.due_at IS NULL THEN 1 ELSE 0 END, t.due_at, CASE t.priority WHEN 'hoch' THEN 0 ELSE 1 END, t.id`;
  return all(`${taskQuery} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 300`, ...args);
});
route('POST', '/api/tasks', ({ body }) => {
  need(body.title, 'Titel fehlt');
  const d = pick(body, TASK_FIELDS); d.due_at = normDue(d.due_at);
  return one(`${taskQuery} WHERE t.id = ?`, createTask(db, d));
});
route('PUT', '/api/tasks/:id', ({ body, params }) => {
  const old = one('SELECT * FROM tasks WHERE id = ?', params.id); if (!old) throw new HttpError(404, 'Nicht gefunden');
  const d = pick(body, [...TASK_FIELDS, 'status']); if (d.due_at !== undefined) d.due_at = normDue(d.due_at);
  if (d.status && d.status !== old.status) d.done_at = d.status === 'erledigt' ? localStamp() : null;
  update('tasks', params.id, d);
  if (d.status === 'erledigt' && old.status !== 'erledigt' && (old.contact_id || old.opportunity_id)) logActivity(db, { type: 'aufgabe', title: `Aufgabe erledigt: ${old.title}`, contact_id: old.contact_id, opportunity_id: old.opportunity_id });
  return one(`${taskQuery} WHERE t.id = ?`, params.id);
});
route('DELETE', '/api/tasks/:id', ({ params }) => { db.prepare('DELETE FROM tasks WHERE id = ?').run(params.id); return { ok: true }; });

// ---------- Verlauf (Aktivitäten) ----------
route('GET', '/api/activities', ({ query }) => {
  const where = []; const args = [];
  for (const k of ['contact_id', 'opportunity_id', 'prospect_id']) if (query[k]) { where.push(`a.${k} = ?`); args.push(query[k]); }
  return all(`SELECT a.*, o.name opportunity_name FROM activities a LEFT JOIN opportunities o ON o.id = a.opportunity_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.created_at DESC, a.id DESC LIMIT 200`, ...args);
});
route('POST', '/api/activities', ({ body }) => {
  need(body.title || body.body, 'Text fehlt');
  const type = ['notiz', 'anruf', 'email', 'treffen'].includes(body.type) ? body.type : 'notiz';
  const id = logActivity(db, { type, title: body.title || String(body.body).slice(0, 120), body: body.body || '', contact_id: body.contact_id || null, opportunity_id: body.opportunity_id || null });
  return one('SELECT * FROM activities WHERE id = ?', id);
});
route('DELETE', '/api/activities/:id', ({ params }) => { db.prepare('DELETE FROM activities WHERE id = ?').run(params.id); return { ok: true }; });

// ---------- Kontakt-Detail ----------
route('GET', '/api/contacts/:id/overview', ({ params }) => {
  const c = one('SELECT * FROM contacts WHERE id = ?', params.id); if (!c) throw new HttpError(404, 'Kontakt nicht gefunden');
  return {
    contact: c,
    opportunities: all(`SELECT o.*, s.name stage_name, p.name pipeline_name FROM opportunities o LEFT JOIN stages s ON s.id = o.stage_id LEFT JOIN pipelines p ON p.id = o.pipeline_id WHERE o.contact_id = ? ORDER BY o.id DESC`, c.id),
    tasks: all(`${taskQuery} WHERE t.contact_id = ? ORDER BY t.status DESC, t.due_at`, c.id),
    appointments: all(`SELECT a.*, k.name calendar_name FROM appointments a LEFT JOIN calendars k ON k.id = a.calendar_id WHERE a.contact_id = ? ORDER BY a.start_at DESC`, c.id),
    activities: all('SELECT a.*, o.name opportunity_name FROM activities a LEFT JOIN opportunities o ON o.id = a.opportunity_id WHERE a.contact_id = ? ORDER BY a.created_at DESC, a.id DESC LIMIT 200', c.id),
    prospects: all('SELECT p.*, a.score audit_score, a.token audit_token FROM prospects p LEFT JOIN audits a ON a.id = p.audit_id WHERE p.contact_id = ?', c.id),
  };
});
route('POST', '/api/contacts/:id/email', async ({ params, body }) => {
  const c = one('SELECT * FROM contacts WHERE id = ?', params.id); if (!c?.email) throw new HttpError(400, 'Der Kontakt hat keine E-Mail-Adresse');
  need(body.subject, 'Betreff fehlt'); need(body.body, 'Text fehlt');
  await sendMail(db, { to: c.email, subject: body.subject, text: body.body });
  logActivity(db, { type: 'email', title: `E-Mail gesendet: ${body.subject}`, body: body.body, contact_id: c.id, opportunity_id: body.opportunity_id || null });
  return { ok: true };
});

// ---------- Benachrichtigungen ----------
route('GET', '/api/notifications', () => ({
  unread: one('SELECT COUNT(*) n FROM notifications WHERE read = 0').n,
  items: all('SELECT * FROM notifications ORDER BY id DESC LIMIT 30'),
}));
route('POST', '/api/notifications/read', ({ body }) => {
  if (body.id) db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(body.id); else db.prepare('UPDATE notifications SET read = 1').run();
  return { ok: true };
});

// ---------- Heute ----------
route('GET', '/api/today', () => {
  const now = localStamp(); const today = now.slice(0, 10);
  const week = new Date(); week.setDate(week.getDate() + 7);
  const f = forecast(db, null);
  return {
    now,
    overdue: all(`${taskQuery} WHERE t.status = 'offen' AND t.due_at IS NOT NULL AND substr(t.due_at,1,10) < ? ORDER BY t.due_at`, today),
    today: all(`${taskQuery} WHERE t.status = 'offen' AND substr(t.due_at,1,10) = ? ORDER BY t.due_at`, today),
    upcoming: all(`${taskQuery} WHERE t.status = 'offen' AND (t.due_at IS NULL OR (t.due_at > ? AND t.due_at <= ?)) ORDER BY CASE WHEN t.due_at IS NULL THEN 1 ELSE 0 END, t.due_at LIMIT 10`, `${today} 23:59`, localStamp(week)),
    appointments: all(`SELECT a.*, k.name calendar_name, k.color FROM appointments a LEFT JOIN calendars k ON k.id = a.calendar_id WHERE a.status = 'gebucht' AND a.end_at >= ? AND a.start_at <= ? ORDER BY a.start_at LIMIT 12`, now, localStamp(week)),
    hot: all(`SELECT a.id audit_id, a.business_name, a.score, p.id prospect_id, p.status, p.contact_id, COUNT(v.id) views, MAX(v.created_at) last_view
      FROM report_views v JOIN audits a ON a.id = v.audit_id LEFT JOIN prospects p ON p.id = a.prospect_id
      WHERE v.created_at >= datetime('now','localtime','-7 days') GROUP BY a.id ORDER BY last_view DESC LIMIT 8`),
    widget: all(`SELECT w.*, a.score FROM widget_submissions w LEFT JOIN audits a ON a.id = w.audit_id WHERE w.created_at >= datetime('now','localtime','-7 days') AND w.error IS NULL ORDER BY w.id DESC LIMIT 5`),
    newProspects: one(`SELECT COUNT(*) n FROM prospects WHERE status = 'neu' OR (status = 'geprüft' AND created_at >= datetime('now','localtime','-7 days'))`).n,
    posts: all(`SELECT id, content, scheduled_at, status FROM posts WHERE (status = 'scheduled' AND substr(scheduled_at,1,10) = ?) OR status IN ('failed','manual') ORDER BY scheduled_at LIMIT 5`, today),
    forecast: f.totals,
  };
});

// ---------- Kalender & Termine ----------
const DEFAULT_AVAIL = JSON.stringify({ 1: [['09:00', '17:00']], 2: [['09:00', '17:00']], 3: [['09:00', '17:00']], 4: [['09:00', '17:00']], 5: [['09:00', '15:00']] });
crud('/api/calendars', 'calendars', ['name', 'slug', 'description', 'duration', 'buffer', 'slot_step', 'min_notice_hours', 'max_days', 'availability', 'location', 'reminder_hours', 'create_lead', 'color', 'active'], {
  order: 'id',
  prepare: (d, body) => {
    if (body.slug !== undefined || !body.id) d.slug = slugify(body.slug || body.name);
    if (d.availability !== undefined) d.availability = typeof d.availability === 'string' ? d.availability : JSON.stringify(d.availability || {});
    else if (!body.id) d.availability = DEFAULT_AVAIL;
    return d;
  },
});
const apptQuery = `SELECT a.*, k.name calendar_name, k.color, c.name contact_name FROM appointments a LEFT JOIN calendars k ON k.id = a.calendar_id LEFT JOIN contacts c ON c.id = a.contact_id`;
route('GET', '/api/appointments', ({ query }) => {
  const from = query.from || localStamp(new Date(Date.now() - 864e5)).slice(0, 10); const to = query.to || '9999';
  return all(`${apptQuery} WHERE a.start_at >= ? AND a.start_at <= ? ${query.all ? '' : `AND a.status != 'abgesagt'`} ORDER BY a.start_at LIMIT 500`, `${from} 00:00`, `${to} 23:59`);
});
async function confirmAppointment(a, cal, kind = 'confirm') {
  if (!a.email || !mailReady(db)) return false;
  const s = getSettings(db); const m = appointmentMail(a, cal, s, kind);
  try {
    await sendMail(db, { to: a.email, subject: m.subject, text: m.text, ics: icsInvite(a, s, kind === 'cancel' ? 'CANCEL' : 'REQUEST'), icsMethod: kind === 'cancel' ? 'CANCEL' : 'REQUEST' });
    if (a.contact_id) logActivity(db, { type: 'email', title: m.subject, body: m.text, contact_id: a.contact_id, opportunity_id: a.opportunity_id });
    return true;
  } catch (e) { console.error('Termin-Mail:', e.message); return false; }
}
route('POST', '/api/appointments', async ({ body }) => {
  need(body.date, 'Datum fehlt'); need(body.time, 'Uhrzeit fehlt');
  const kind = body.kind === 'blocker' ? 'blocker' : 'termin';
  const start = toDate(`${body.date} ${body.time}`); if (Number.isNaN(start.getTime())) throw new HttpError(400, 'Ungültiges Datum');
  const end = new Date(start.getTime() + (Number(body.duration) || 30) * 60000);
  const c = body.contact_id ? one('SELECT * FROM contacts WHERE id = ?', body.contact_id) : null;
  const id = insert('appointments', {
    calendar_id: body.calendar_id || null, title: body.title || (kind === 'blocker' ? 'Blocker' : c ? `Termin: ${c.name}` : 'Termin'), start_at: localStamp(start), end_at: localStamp(end), kind,
    contact_id: c?.id ?? null, opportunity_id: body.opportunity_id || null, name: c?.name || '', email: c?.email || '', phone: c?.phone || '', message: body.message || '',
    location: body.location || '', token: token(16), source: 'manuell',
  });
  const a = one('SELECT * FROM appointments WHERE id = ?', id);
  if (c) logActivity(db, { type: 'termin', title: `Termin eingetragen: ${formatDe(a.start_at)}`, contact_id: c.id, opportunity_id: a.opportunity_id });
  const mailed = body.send_mail && kind === 'termin' ? await confirmAppointment(a, a.calendar_id ? one('SELECT * FROM calendars WHERE id = ?', a.calendar_id) : null) : false;
  return { ...one(`${apptQuery} WHERE a.id = ?`, id), mailed };
});
route('PUT', '/api/appointments/:id', async ({ params, body }) => {
  const old = one('SELECT * FROM appointments WHERE id = ?', params.id); if (!old) throw new HttpError(404, 'Nicht gefunden');
  const d = pick(body, ['title', 'status', 'location', 'message', 'contact_id']);
  if (body.date && body.time) {
    const start = toDate(`${body.date} ${body.time}`);
    const dur = Number(body.duration) || (toDate(old.end_at) - toDate(old.start_at)) / 60000;
    Object.assign(d, { start_at: localStamp(start), end_at: localStamp(new Date(start.getTime() + dur * 60000)), reminder_sent: 0 });
  }
  update('appointments', params.id, d);
  const a = one('SELECT * FROM appointments WHERE id = ?', params.id);
  if (d.status && d.status !== old.status) {
    if (a.contact_id) logActivity(db, { type: 'termin', title: `Termin ${d.status}: ${formatDe(a.start_at)}`, contact_id: a.contact_id, opportunity_id: a.opportunity_id });
    if (d.status === 'abgesagt') {
      if (body.notify_customer) await confirmAppointment(a, a.calendar_id ? one('SELECT * FROM calendars WHERE id = ?', a.calendar_id) : null, 'cancel');
      emit(db, 'appointment.cancelled', { appointment_id: a.id, calendar_id: a.calendar_id, contact_id: a.contact_id });
    }
  }
  return one(`${apptQuery} WHERE a.id = ?`, params.id);
});
route('DELETE', '/api/appointments/:id', ({ params }) => { db.prepare('DELETE FROM appointments WHERE id = ?').run(params.id); return { ok: true }; });

// Kalender-Abo (z. B. in Google Kalender, Apple Kalender oder Outlook abonnieren)
route('GET', '/kalender.ics', ({ query, res }) => {
  const key = getSettings(db).ics_key;
  if (!key || query.key !== key) throw new HttpError(403, 'Ungültiger Schlüssel');
  send(res, 200, icsFeed(db), 'text/calendar; charset=utf-8', { 'content-disposition': 'inline; filename="webhafen-os.ics"' }); return null;
}, { pub: true });

// ---------- Öffentliche Terminbuchung ----------
const pubCal = (slug) => { const c = one('SELECT * FROM calendars WHERE slug = ? AND active = 1', slug); if (!c) throw new HttpError(404, 'Diese Buchungsseite gibt es nicht (mehr).'); return c; };
route('GET', '/termin/:slug', ({ params, query, res }) => {
  const cal = pubCal(params.slug);
  send(res, 200, renderBookingPage(cal, getSettings(db), { ref: query.b || '' }), 'text/html; charset=utf-8'); return null;
}, { pub: true });
route('GET', '/api/public/calendars/:slug', ({ params }) => {
  const c = pubCal(params.slug);
  return { name: c.name, description: c.description, duration: c.duration, location: c.location, days: availableDays(db, c) };
}, { pub: true });
route('GET', '/api/public/calendars/:slug/slots', ({ params, query }) => ({ slots: slotsFor(db, pubCal(params.slug), String(query.date || '')) }), { pub: true });
route('POST', '/api/public/book', async ({ body, req }) => {
  if (body.website_hp) throw new HttpError(400, 'Ungültig');
  const cal = pubCal(body.slug);
  need(body.name, 'Bitte den Namen angeben'); need(body.email, 'Bitte eine E-Mail-Adresse angeben');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) throw new HttpError(400, 'Bitte eine gültige E-Mail-Adresse angeben');
  if (!body.consent) throw new HttpError(400, 'Bitte der Verarbeitung der Daten zustimmen');
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (!rateLimit('b:' + createHash('sha256').update(ip).digest('hex').slice(0, 16), 5, 3600e3)) throw new HttpError(429, 'Zu viele Anfragen – bitte später erneut versuchen.');
  // Kontakt finden: über den Berichtslink (?b=…), die E-Mail-Adresse oder neu anlegen
  const audit = body.ref ? one('SELECT * FROM audits WHERE token = ?', body.ref) : null;
  const prospect = audit?.prospect_id ? one('SELECT * FROM prospects WHERE id = ?', audit.prospect_id) : null;
  let contact = prospect?.contact_id ? one('SELECT * FROM contacts WHERE id = ?', prospect.contact_id) : null;
  contact ||= one('SELECT * FROM contacts WHERE lower(email) = lower(?)', body.email.trim());
  let isNew = false;
  if (!contact) {
    const id = insert('contacts', { name: body.name.trim(), email: body.email.trim(), phone: body.phone || '', company: body.company || prospect?.name || '', tags: 'terminbuchung',
      notes: `Termin über Buchungsseite „${cal.name}“ gebucht. Einwilligung zur Datenverarbeitung: ${localStamp()}` });
    contact = one('SELECT * FROM contacts WHERE id = ?', id); isNew = true;
  } else if (!contact.email || !contact.phone) {
    update('contacts', contact.id, { email: contact.email || body.email.trim(), phone: contact.phone || body.phone || '' });
  }
  if (prospect && !prospect.contact_id) update('prospects', prospect.id, { contact_id: contact.id, status: 'im CRM' });
  let opp = one(`SELECT * FROM opportunities WHERE contact_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1`, contact.id);
  let oppNew = false;
  if (!opp && cal.create_lead) {
    const p = one('SELECT * FROM pipelines ORDER BY id LIMIT 1'); const st = one('SELECT id FROM stages WHERE pipeline_id = ? ORDER BY position LIMIT 1', p.id);
    const oid = insert('opportunities', { name: `${contact.company || contact.name} – ${cal.name}`, contact_id: contact.id, pipeline_id: p.id, stage_id: st?.id ?? null, company: contact.company || '', source: 'Terminbuchung', updated_at: localStamp() });
    opp = one('SELECT * FROM opportunities WHERE id = ?', oid); oppNew = true;
    if (prospect) update('prospects', prospect.id, { opportunity_id: oid });
  }
  const a = book(db, cal, { date: body.date, time: body.time, name: body.name.trim(), email: body.email.trim(), phone: body.phone || '', message: String(body.message || '').slice(0, 2000), contact_id: contact.id, opportunity_id: opp?.id ?? null });
  logActivity(db, { type: 'termin', title: `Termin gebucht: ${cal.name}, ${formatDe(a.start_at)}`, body: a.message, contact_id: contact.id, opportunity_id: opp?.id });
  if (isNew) contactCreated(contact.id);
  if (oppNew) emit(db, 'opportunity.created', { opportunity_id: opp.id });
  emit(db, 'appointment.booked', { appointment_id: a.id, calendar_id: cal.id, contact_id: contact.id, opportunity_id: opp?.id ?? null, audit_id: audit?.id ?? null });
  const mailed = await confirmAppointment(a, cal);
  notify(db, { title: `📅 Neuer Termin: ${a.name}`, body: `${cal.name} · ${formatDe(a.start_at)}`, link: `#/kontakte/${contact.id}`, email: !mailed }).catch(() => {});
  return { ok: true, when: formatDe(a.start_at), mailed, cancel_url: `/termin/absagen/${a.token}` };
}, { pub: true });
route('GET', '/termin/absagen/:token', ({ params, res }) => {
  const a = one(`${apptQuery} WHERE a.token = ?`, params.token); if (!a) throw new HttpError(404, 'Termin nicht gefunden');
  send(res, 200, renderCancelPage(a, getSettings(db)), 'text/html; charset=utf-8'); return null;
}, { pub: true });
route('POST', '/api/public/cancel/:token', async ({ params }) => {
  const a = one('SELECT * FROM appointments WHERE token = ?', params.token); if (!a) throw new HttpError(404, 'Termin nicht gefunden');
  if (a.status === 'abgesagt') return { ok: true, already: true };
  if (toDate(a.start_at) < new Date()) throw new HttpError(400, 'Der Termin liegt in der Vergangenheit.');
  update('appointments', a.id, { status: 'abgesagt' });
  const cal = a.calendar_id ? one('SELECT * FROM calendars WHERE id = ?', a.calendar_id) : null;
  if (a.contact_id) logActivity(db, { type: 'termin', title: `Termin vom Kunden abgesagt: ${formatDe(a.start_at)}`, contact_id: a.contact_id, opportunity_id: a.opportunity_id });
  await confirmAppointment({ ...a, status: 'abgesagt' }, cal, 'cancel');
  notify(db, { title: `❌ Termin abgesagt: ${a.name}`, body: formatDe(a.start_at), link: a.contact_id ? `#/kontakte/${a.contact_id}` : '#/kalender', email: true }).catch(() => {});
  emit(db, 'appointment.cancelled', { appointment_id: a.id, calendar_id: a.calendar_id, contact_id: a.contact_id });
  return { ok: true, rebook: cal ? `/termin/${cal.slug}` : null };
}, { pub: true });

// ---------- Automationen ----------
route('GET', '/api/automations/meta', () => ({ triggers: TRIGGERS, steps: STEP_TYPES, presets: presets(db) }));
crud('/api/automations', 'automations', ['name', 'trigger', 'trigger_config', 'steps', 'active'], {
  required: ['name', 'trigger'], order: 'id DESC',
  prepare: (d) => {
    if (d.trigger !== undefined && !TRIGGERS[d.trigger]) throw new HttpError(400, 'Unbekannter Auslöser');
    for (const k of ['trigger_config', 'steps']) if (d[k] !== undefined && typeof d[k] !== 'string') d[k] = JSON.stringify(d[k]);
    return d;
  },
  list: () => all(`SELECT a.*, (SELECT COUNT(*) FROM automation_runs r WHERE r.automation_id = a.id AND r.status = 'wartet') waiting,
    (SELECT COUNT(*) FROM automation_runs r WHERE r.automation_id = a.id AND r.status = 'fehler') errors FROM automations a ORDER BY a.id DESC`),
});
route('POST', '/api/automations/preset', ({ body }) => {
  const p = presets(db).find((x) => x.key === body.key); if (!p) throw new HttpError(404, 'Vorlage nicht gefunden');
  const id = insert('automations', { name: p.name, trigger: p.trigger, trigger_config: JSON.stringify(p.trigger_config), steps: JSON.stringify(p.steps), active: body.active === false ? 0 : 1 });
  return one('SELECT * FROM automations WHERE id = ?', id);
});
route('GET', '/api/automations/:id/runs', ({ params }) => all('SELECT * FROM automation_runs WHERE automation_id = ? ORDER BY id DESC LIMIT 50', params.id));
route('POST', '/api/automations/:id/test', async ({ params, body }) => {
  const a = one('SELECT * FROM automations WHERE id = ?', params.id); if (!a) throw new HttpError(404, 'Nicht gefunden');
  need(body.contact_id, 'Bitte einen Kontakt zum Testen wählen');
  const runId = await startRun(db, a, { contact_id: Number(body.contact_id), _test: true });
  return one('SELECT * FROM automation_runs WHERE id = ?', runId);
});

// ---------- Einstellungen: Tests ----------
route('POST', '/api/settings/test-mail', async ({ body }) => {
  const s = getSettings(db); const to = body.to || s.notify_email || s.agency_email;
  need(to, 'Bitte eine Empfängeradresse angeben');
  await sendMail(db, { to, subject: 'Test aus Webhafen OS ✅', text: 'Der E-Mail-Versand funktioniert.\n\nViele Grüße\nWebhafen OS' });
  return { ok: true, to };
});
route('POST', '/api/settings/test-ntfy', async () => {
  if (!getSettings(db).ntfy_url) throw new HttpError(400, 'Keine ntfy-Adresse eingetragen');
  await notify(db, { title: 'Test aus Webhafen OS ✅', body: 'Benachrichtigungen aufs Handy funktionieren.', link: '#/heute' });
  return { ok: true };
});

// ---------- Statische Dateien ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
async function serveStatic(res, path) {
  const file = join(ROOT, 'public', path === '/' ? 'index.html' : path.replace(/\.\.+/g, ''));
  try { const data = await readFile(file); res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' }); res.end(data); return true; } catch { return false; }
}

export async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  try {
    const r = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
    if (!r) {
      if (req.method === 'GET' && !url.pathname.startsWith('/api/') && await serveStatic(res, url.pathname)) return;
      throw new HttpError(404, 'Nicht gefunden');
    }
    if (!r.pub && PASSWORD && !sessions.has(cookies(req).sid)) throw new HttpError(401, 'Bitte anmelden');
    const m = url.pathname.match(r.re); const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    let body = {};
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      const raw = await readBody(req);
      body = (req.headers['content-type'] || '').includes('application/x-www-form-urlencoded') ? Object.fromEntries(new URLSearchParams(raw)) : parseJSON(raw, {}) || {};
    }
    const out = await r.handler({ req, res, params, query: Object.fromEntries(url.searchParams), body });
    if (out !== null && !res.headersSent) send(res, 200, out);
  } catch (e) {
    const status = e.status || (/UNIQUE/.test(e.message) ? 409 : 500);
    if (status === 500) console.error(e);
    if (!res.headersSent) {
      const msg = /UNIQUE/.test(e.message) ? 'Dieser Code / Kurzlink ist schon vergeben' : e.message;
      if (url.pathname.startsWith('/api/')) send(res, status, { error: msg });
      else send(res, status, `<!doctype html><meta charset="utf-8"><title>${status}</title><p style="font-family:sans-serif;padding:2rem">${msg}</p>`, 'text/html; charset=utf-8');
    }
  }
}

// Startet Webserver und Planer (von `npm start` und vom Demo-Skript genutzt)
export function start({ port = PORT, host = process.env.HOST } = {}) {
  const server = http.createServer(handle).listen(port, host || undefined, () => {
    console.log(`Webhafen OS läuft auf http://${host || 'localhost'}:${port}`);
    if (!PASSWORD) console.warn('⚠  ADMIN_PASSWORD ist nicht gesetzt – die App ist ohne Login erreichbar. Nur lokal so betreiben!');
  });
  let busy = false;
  setInterval(async () => { if (busy) return; busy = true; try {
      await runScheduler(db); await runDueAgents(db); await resumeDue(db);
      if (mailReady(db)) await sendReminders(db, (a, cal) => confirmAppointment(a, cal, 'reminder'));
    } catch (e) { console.error('Planer:', e); } busy = false; }, 30_000);
  const feeds = async () => { for (const f of all('SELECT * FROM rss_feeds')) await checkFeed(db, f); };
  setInterval(() => feeds().catch((e) => console.error('RSS:', e)), 30 * 60_000);
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) start();
