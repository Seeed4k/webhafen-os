// Terminbuchung: freie Zeiten berechnen, buchen, absagen, Kalenderdateien (ICS) und Erinnerungen.
// Alle Zeiten werden als lokale Zeit „YYYY-MM-DD HH:MM“ (Europe/Berlin, über process.env.TZ) gespeichert.
import { localStamp, parseJSON, token } from './util.js';
import { getSettings } from './db.js';

const pad = (n) => String(n).padStart(2, '0');
export const toDate = (s) => new Date(String(s).replace(' ', 'T'));
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addMin = (d, m) => new Date(d.getTime() + m * 60000);
export const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

export function formatDe(s, withTime = true) {
  const d = toDate(s);
  const date = d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return withTime ? `${date}, ${hm(d)} Uhr` : date;
}

// Alle belegten Zeiträume (gebuchte Termine und Blocker – kalenderübergreifend, du bist ja eine Person)
function busy(db, fromStamp, toStamp) {
  return db.prepare(`SELECT start_at, end_at FROM appointments WHERE status = 'gebucht' AND end_at > ? AND start_at < ?`).all(fromStamp, toStamp)
    .map((a) => [toDate(a.start_at), toDate(a.end_at)]);
}

export function slotsFor(db, cal, dateStr, now = new Date()) {
  const day = toDate(`${dateStr} 00:00`);
  if (Number.isNaN(day.getTime())) return [];
  const last = new Date(now); last.setDate(last.getDate() + cal.max_days);
  if (day > last) return [];
  const windows = parseJSON(cal.availability, {})[String(day.getDay())] || [];
  const earliest = addMin(now, cal.min_notice_hours * 60);
  const taken = busy(db, `${dateStr} 00:00`, `${dateStr} 23:59`);
  const buf = Number(cal.buffer) || 0; const dur = Number(cal.duration) || 30; const step = Number(cal.slot_step) || 30;
  const out = [];
  for (const [from, to] of windows) {
    const end = toDate(`${dateStr} ${to}`);
    for (let t = toDate(`${dateStr} ${from}`); addMin(t, dur) <= end; t = addMin(t, step)) {
      if (t < earliest) continue;
      const s = addMin(t, -buf); const e = addMin(t, dur + buf);
      if (taken.some(([bs, be]) => s < be && e > bs)) continue;
      out.push(hm(t));
    }
  }
  return out;
}

export function availableDays(db, cal, now = new Date()) {
  const days = [];
  for (let i = 0; i <= cal.max_days; i++) {
    const d = new Date(now); d.setDate(d.getDate() + i);
    const key = ymd(d);
    const n = slotsFor(db, cal, key, now).length;
    days.push({ date: key, weekday: d.getDay(), free: n });
  }
  return days;
}

// Bucht einen Termin; prüft unmittelbar vorher erneut, ob der Platz noch frei ist
export function book(db, cal, { date, time, name, email = '', phone = '', message = '', contact_id = null, opportunity_id = null, source = 'buchungsseite' }, now = new Date()) {
  if (!slotsFor(db, cal, date, now).includes(time)) throw Object.assign(new Error('Dieser Termin ist leider nicht mehr frei. Bitte eine andere Uhrzeit wählen.'), { status: 409 });
  const start = toDate(`${date} ${time}`);
  const appt = {
    calendar_id: cal.id, title: `${cal.name}: ${name}`, start_at: localStamp(start), end_at: localStamp(addMin(start, cal.duration)),
    name, email, phone, message, location: cal.location || '', contact_id, opportunity_id, token: token(16), source,
  };
  const k = Object.keys(appt);
  const id = Number(db.prepare(`INSERT INTO appointments (${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`).run(...Object.values(appt)).lastInsertRowid);
  return db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
}

// ---------- ICS (iCalendar) ----------
const icsTime = (s) => toDate(s).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function fold(line) { // Zeilen > 75 Zeichen umbrechen (RFC 5545)
  const out = []; let l = line;
  while (Buffer.byteLength(l) > 74) { let n = 74; while (Buffer.byteLength(l.slice(0, n)) > 74) n--; out.push(l.slice(0, n)); l = ' ' + l.slice(n); }
  out.push(l); return out.join('\r\n');
}
function vevent(a, s, { method } = {}) {
  const host = (s.public_url || 'https://webhafen-os.local').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const cancelled = a.status === 'abgesagt' || method === 'CANCEL';
  return [
    'BEGIN:VEVENT', `UID:termin-${a.id}@${host}`, `DTSTAMP:${icsTime(localStamp())}`, `DTSTART:${icsTime(a.start_at)}`, `DTEND:${icsTime(a.end_at)}`,
    `SUMMARY:${icsText(a.title)}`, a.location ? `LOCATION:${icsText(a.location)}` : null,
    `DESCRIPTION:${icsText([a.name, a.email, a.phone, a.message].filter(Boolean).join('\n'))}`,
    s.agency_email ? `ORGANIZER;CN=${icsText(s.agency_name || 'Webhafen')}:mailto:${s.agency_email}` : null,
    a.email && method ? `ATTENDEE;CN=${icsText(a.name)};RSVP=FALSE:mailto:${a.email}` : null,
    `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`, `SEQUENCE:${cancelled ? 1 : 0}`, 'END:VEVENT',
  ].filter(Boolean).map(fold).join('\r\n');
}
export function icsInvite(a, s, method = 'REQUEST') {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Webhafen OS//DE', 'CALSCALE:GREGORIAN', `METHOD:${method}`, vevent(a, s, { method }), 'END:VCALENDAR'].join('\r\n') + '\r\n';
}
export function icsFeed(db) {
  const s = getSettings(db);
  const since = new Date(); since.setDate(since.getDate() - 60);
  const rows = db.prepare(`SELECT * FROM appointments WHERE status != 'abgesagt' AND end_at >= ? ORDER BY start_at`).all(localStamp(since));
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Webhafen OS//DE', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Webhafen OS – Termine', 'X-PUBLISHED-TTL:PT15M',
    ...rows.map((a) => vevent(a, s)), 'END:VCALENDAR'].join('\r\n') + '\r\n';
}

// Text der Bestätigungs- und Erinnerungsmails
export function appointmentMail(a, cal, s, kind) {
  const base = (s.public_url || '').replace(/\/$/, '');
  const when = formatDe(a.start_at);
  const lines = [
    `Hallo ${a.name.split(' ')[0] || a.name},`, '',
    kind === 'reminder' ? 'kurze Erinnerung an unseren Termin:' : kind === 'cancel' ? 'Ihr Termin wurde abgesagt:' : 'vielen Dank für Ihre Buchung. Hiermit bestätigen wir Ihren Termin:', '',
    `📅 ${when} (${cal?.duration || Math.round((toDate(a.end_at) - toDate(a.start_at)) / 60000)} Minuten)`,
    `📌 ${cal?.name || a.title}`, a.location ? `📍 ${a.location}` : null, '',
    kind !== 'cancel' && base ? `Termin absagen oder verschieben: ${base}/termin/absagen/${a.token}` : null,
    kind === 'cancel' && base && cal ? `Neuen Termin buchen: ${base}/termin/${cal.slug}` : null, '',
    'Viele Grüße', [s.agency_name, s.agency_phone, s.agency_email, s.agency_website].filter(Boolean).join('\n'),
  ].filter((l) => l !== null);
  const subject = kind === 'reminder' ? `Erinnerung: ${cal?.name || 'Termin'} am ${formatDe(a.start_at)}`
    : kind === 'cancel' ? `Abgesagt: ${cal?.name || 'Termin'} am ${formatDe(a.start_at)}` : `Terminbestätigung: ${cal?.name || 'Termin'} am ${formatDe(a.start_at)}`;
  return { subject, text: lines.join('\n') };
}

// Erinnerungen X Stunden vorher verschicken (läuft im Planer)
export async function sendReminders(db, send, now = new Date()) {
  const rows = db.prepare(`SELECT a.*, c.reminder_hours, c.name cal_name, c.slug, c.duration FROM appointments a LEFT JOIN calendars c ON c.id = a.calendar_id
    WHERE a.status = 'gebucht' AND a.kind = 'termin' AND a.reminder_sent = 0 AND a.email != '' AND a.start_at > ?`).all(localStamp(now));
  let sent = 0;
  for (const a of rows) {
    const hours = a.reminder_hours ?? 24;
    if (!hours || toDate(a.start_at) - now > hours * 3600e3) continue;
    // Bei kurzfristigen Buchungen keine Erinnerung direkt nach der Bestätigung
    if (toDate(a.start_at) - toDate(a.created_at) < hours * 3600e3 && now - toDate(a.created_at) < 3600e3) continue;
    db.prepare('UPDATE appointments SET reminder_sent = 1 WHERE id = ?').run(a.id);
    try { await send(a, { name: a.cal_name, slug: a.slug, duration: a.duration }); sent++; } catch (e) { console.error('Erinnerung:', e.message); }
  }
  return sent;
}
