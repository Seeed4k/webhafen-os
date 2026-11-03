// Kontaktverlauf, Aufgaben und Benachrichtigungen
import { getSettings } from './db.js';
import { localStamp } from './util.js';
import { sendMail, mailReady } from './mailer.js';

const ins = (db, table, data) => {
  const k = Object.keys(data);
  return Number(db.prepare(`INSERT INTO ${table} (${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`).run(...Object.values(data)).lastInsertRowid);
};

export function logActivity(db, { type, title, body = '', contact_id = null, opportunity_id = null, prospect_id = null }) {
  if (!contact_id && opportunity_id) contact_id = db.prepare('SELECT contact_id FROM opportunities WHERE id = ?').get(opportunity_id)?.contact_id ?? null;
  return ins(db, 'activities', { type, title, body, contact_id, opportunity_id, prospect_id });
}

export function createTask(db, { title, notes = '', due_at = null, priority = 'normal', contact_id = null, opportunity_id = null, prospect_id = null, source = 'manuell', automation_id = null }) {
  if (!contact_id && opportunity_id) contact_id = db.prepare('SELECT contact_id FROM opportunities WHERE id = ?').get(opportunity_id)?.contact_id ?? null;
  return ins(db, 'tasks', { title, notes, due_at, priority, contact_id, opportunity_id, prospect_id, source, automation_id });
}

// Fälligkeit „in X Tagen/Stunden“; Tage landen um 09:00 Uhr
export function dueIn({ days = 0, hours = 0 }, now = new Date()) {
  const d = new Date(now);
  if (Number(hours)) d.setHours(d.getHours() + Number(hours));
  if (Number(days)) { d.setDate(d.getDate() + Number(days)); if (!Number(hours)) d.setHours(9, 0, 0, 0); }
  return localStamp(d);
}

// Benachrichtigung: in der App, optional aufs Handy (ntfy) und per E-Mail an dich
export async function notify(db, { title, body = '', link = '', email = false }) {
  ins(db, 'notifications', { title, body, link });
  const s = getSettings(db);
  const jobs = [];
  if (s.ntfy_url) {
    try {
      const u = new URL(s.ntfy_url);
      const topic = u.pathname.replace(/^\/+|\/+$/g, '');
      const click = link && s.public_url ? `${s.public_url.replace(/\/$/, '')}/${link.replace(/^\//, '')}` : undefined;
      jobs.push(fetch(u.origin, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(10000),
        body: JSON.stringify({ topic, title, message: body || title, click, tags: ['anchor'] }) }).catch((e) => console.error('ntfy:', e.message)));
    } catch (e) { console.error('ntfy-URL ungültig:', e.message); }
  }
  if (email && s.notify_email && mailReady(db)) {
    jobs.push(sendMail(db, { to: s.notify_email, subject: `Webhafen OS: ${title}`, text: `${body}\n\n${s.public_url ? `${s.public_url.replace(/\/$/, '')}/${link.replace(/^\//, '')}` : ''}` }).catch((e) => console.error('Benachrichtigungs-Mail:', e.message)));
  }
  await Promise.all(jobs);
}

export const nowStamp = () => localStamp();
