import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.DB_FILE = ':memory:';
process.env.MAIL_TRANSPORT = 'json';
const { handle, db } = await import('../server.js');
const { outbox } = await import('../lib/mailer.js');
const { settle, resumeDue } = await import('../lib/automation.js');
const { slotsFor, sendReminders } = await import('../lib/calendar.js');
const srv = http.createServer(handle).listen(0);
const base = `http://localhost:${srv.address().port}`;
const api = async (m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json' }, body: b && JSON.stringify(b) }); return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() }; };
test.after(() => srv.close());

// nächster Montag (mind. 2 Tage entfernt), als YYYY-MM-DD
const nextMonday = () => { const d = new Date(); d.setDate(d.getDate() + 2); while (d.getDay() !== 1) d.setDate(d.getDate() + 1); return d.toLocaleDateString('sv-SE'); };
const MON = nextMonday();
let cal;

test('Einstellungen verraten das SMTP-Passwort nicht', async () => {
  await api('PUT', '/api/settings', { agency_name: 'Webhafen', agency_email: 'info@web-hafen.de', public_url: 'https://os.web-hafen.de', smtp_host: 'smtp.ionos.de', smtp_user: 'info@web-hafen.de', smtp_pass: 'geheim', notify_email: 'ich@web-hafen.de' });
  const s = (await api('GET', '/api/settings')).body;
  assert.equal(s.smtp_pass, undefined);
  assert.equal(s.smtp_pass_set, true);
  await api('PUT', '/api/settings', { smtp_pass: '' }); // leer = behalten
  assert.equal(db.prepare(`SELECT value FROM settings WHERE key = 'smtp_pass'`).get().value, 'geheim');
});

test('Freie Zeiten berücksichtigen Dauer, Puffer und bestehende Termine', async () => {
  cal = (await api('POST', '/api/calendars', { name: 'Erstgespräch Website', duration: 30, buffer: 15, slot_step: 30, min_notice_hours: 0, max_days: 60,
    availability: { 1: [['09:00', '11:00']] }, reminder_hours: 24 })).body;
  assert.equal(cal.slug, 'erstgespraech-website');
  assert.deepEqual(slotsFor(db, cal, MON), ['09:00', '09:30', '10:00', '10:30']);
  await api('POST', '/api/appointments', { kind: 'blocker', date: MON, time: '09:30', duration: 30 });
  assert.deepEqual(slotsFor(db, cal, MON), ['10:30'], 'Puffer von 15 Min. blockiert die Nachbar-Slots');
  db.prepare(`DELETE FROM appointments`).run();
  const tue = new Date(MON + 'T12:00'); tue.setDate(tue.getDate() + 1);
  assert.deepEqual(slotsFor(db, cal, tue.toLocaleDateString('sv-SE')), [], 'dienstags nicht verfügbar');
});

test('Automation: Termin gebucht → Aufgabe, warten, E-Mail', async () => {
  const a = (await api('POST', '/api/automations', { name: 'Nach Termin', trigger: 'appointment.booked', trigger_config: {}, steps: [
    { type: 'create_task', title: 'Vorbereiten: {{kontakt.name}}', due_days: 0, due_hours: 1 },
    { type: 'wait', amount: 1, unit: 'tage' },
    { type: 'send_email', to: 'kontakt', subject: 'Danke, {{kontakt.vorname}}!', body: 'Termin war am {{termin.datum}}. Bericht: {{bericht.link}}' },
  ] })).body;
  assert.equal(a.trigger, 'appointment.booked');
});

test('Öffentliche Buchung: Kontakt, Lead, Termin, Bestätigung mit Kalendereintrag', async () => {
  const page = await api('GET', '/termin/erstgespraech-website?b=%3C/script%3E');
  assert.match(page.body, /Erstgespräch Website/);
  assert.doesNotMatch(page.body, /<\/script>"/, 'Parameter wird im Skript maskiert');
  const days = (await api('GET', '/api/public/calendars/erstgespraech-website')).body.days;
  assert.ok(days.find((d) => d.date === MON).free === 4);
  const bad = await api('POST', '/api/public/book', { slug: 'erstgespraech-website', date: MON, time: '09:00', name: 'Max', email: 'max@example.de' });
  assert.equal(bad.status, 400, 'Einwilligung ist Pflicht');
  const r = await api('POST', '/api/public/book', { slug: 'erstgespraech-website', date: MON, time: '09:00', name: 'Max Muster', email: 'max@example.de', phone: '0170 1234567', company: 'Muster GmbH', consent: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.mailed, true);
  const again = await api('POST', '/api/public/book', { slug: 'erstgespraech-website', date: MON, time: '09:00', name: 'Eva', email: 'eva@example.de', consent: true });
  assert.equal(again.status, 409, 'kein Doppelbuchen');
  await settle();
  const c = db.prepare(`SELECT * FROM contacts WHERE email = 'max@example.de'`).get();
  assert.equal(c.company, 'Muster GmbH');
  const opp = db.prepare('SELECT * FROM opportunities WHERE contact_id = ?').get(c.id);
  assert.equal(opp.source, 'Terminbuchung');
  const mail = outbox.find((m) => m.to === 'max@example.de');
  assert.match(mail.subject, /Terminbestätigung/);
  assert.ok(mail.icalEvent, 'Kalendereintrag hängt an');
  assert.match(mail.text, /termin\/absagen\//);
  // Automation lief bis zur Wartezeit
  const task = db.prepare(`SELECT * FROM tasks WHERE title = 'Vorbereiten: Max Muster'`).get();
  assert.ok(task, 'Aufgabe angelegt');
  const run = db.prepare('SELECT * FROM automation_runs ORDER BY id DESC').get();
  assert.equal(run.status, 'wartet');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM notifications').get().n >= 1, true);
  // Nach der Wartezeit geht es weiter
  const later = new Date(Date.now() + 2 * 864e5);
  await resumeDue(db, later);
  const done = db.prepare('SELECT * FROM automation_runs WHERE id = ?').get(run.id);
  assert.equal(done.status, 'fertig', done.log);
  const thanks = outbox.find((m) => m.subject === 'Danke, Max!');
  assert.ok(thanks, 'E-Mail nach der Wartezeit');
  assert.match(thanks.text, /Termin war am Montag/);
  // Verlauf des Kontakts
  const ov = (await api('GET', `/api/contacts/${c.id}/overview`)).body;
  assert.ok(ov.activities.some((x) => x.type === 'termin'));
  assert.ok(ov.activities.some((x) => x.title === 'E-Mail gesendet: Danke, Max!'));
  assert.equal(ov.appointments.length, 1);
});

test('Absage über den Link aus der E-Mail', async () => {
  const appt = db.prepare(`SELECT * FROM appointments WHERE email = 'max@example.de'`).get();
  const page = await api('GET', `/termin/absagen/${appt.token}`);
  assert.match(page.body, /Termin absagen/);
  const r = await api('POST', `/api/public/cancel/${appt.token}`);
  assert.equal(r.body.rebook, '/termin/erstgespraech-website');
  assert.equal(db.prepare('SELECT status FROM appointments WHERE id = ?').get(appt.id).status, 'abgesagt');
  assert.ok(outbox.some((m) => m.subject.startsWith('Abgesagt:')));
  assert.ok(slotsFor(db, cal, MON).includes('09:00'), 'Zeit ist wieder frei');
});

test('Erinnerung wird einmal verschickt', async () => {
  const r = await api('POST', '/api/public/book', { slug: 'erstgespraech-website', date: MON, time: '10:30', name: 'Lea Koop', email: 'lea@example.de', consent: true });
  assert.equal(r.status, 200);
  db.prepare(`UPDATE appointments SET created_at = datetime('now','localtime','-3 days') WHERE email = 'lea@example.de'`).run();
  const appt = db.prepare(`SELECT * FROM appointments WHERE email = 'lea@example.de'`).get();
  const justBefore = new Date(new Date(appt.start_at.replace(' ', 'T')).getTime() - 5 * 3600e3);
  const sent = [];
  assert.equal(await sendReminders(db, async (a) => sent.push(a.email), justBefore), 1);
  assert.equal(await sendReminders(db, async (a) => sent.push(a.email), justBefore), 0);
  assert.deepEqual(sent, ['lea@example.de']);
});

test('Bedingungen, Tags und Phasenwechsel lösen Automationen aus', async () => {
  const [p] = (await api('GET', '/api/pipelines')).body;
  await api('POST', '/api/automations', { name: 'VIP', trigger: 'contact.tag_added', trigger_config: { tag: 'vip' }, steps: [
    { type: 'condition', field: 'kontakt.email', op: 'vorhanden' },
    { type: 'notify', title: 'VIP: {{kontakt.name}}' }] });
  await api('POST', '/api/automations', { name: 'Angebot', trigger: 'opportunity.stage_changed', trigger_config: { stage_id: p.stages[3].id }, steps: [
    { type: 'create_task', title: 'Angebot nachfassen: {{lead.name}}', due_days: 5 }] });
  const noMail = (await api('POST', '/api/contacts', { name: 'Ohne Mail' })).body;
  await api('PUT', `/api/contacts/${noMail.id}`, { tags: 'vip' });
  const withMail = (await api('POST', '/api/contacts', { name: 'Mit Mail', email: 'm@x.de', tags: 'vip' })).body;
  const o = (await api('POST', '/api/opportunities', { name: 'Shop Hofladen', pipeline_id: p.id, contact_id: withMail.id })).body;
  await api('PUT', `/api/opportunities/${o.id}`, { stage_id: p.stages[3].id });
  await settle();
  const notes = db.prepare(`SELECT title FROM notifications WHERE title LIKE 'VIP:%'`).all().map((x) => x.title);
  assert.deepEqual(notes, ['VIP: Mit Mail'], 'Bedingung stoppt ohne E-Mail-Adresse');
  assert.ok(db.prepare(`SELECT * FROM tasks WHERE title = 'Angebot nachfassen: Shop Hofladen'`).get());
  const acts = db.prepare('SELECT title FROM activities WHERE opportunity_id = ?').all(o.id).map((x) => x.title);
  assert.ok(acts.includes(`Phase → ${p.stages[3].name}`));
});

test('Vorlage „Bericht geöffnet“ legt Anruf-Aufgabe an – nur beim ersten Aufruf', async () => {
  const pr = (await api('POST', '/api/automations/preset', { key: 'report-call' })).body;
  assert.equal(pr.trigger, 'report.viewed');
  const pid = db.prepare(`INSERT INTO prospects (name, phone, status) VALUES ('Fahrschule Test', '05932 1', 'geprüft')`).run().lastInsertRowid;
  db.prepare(`INSERT INTO audits (token, business_name, url, score, result, prospect_id) VALUES ('tokx', 'Fahrschule Test', 'https://x.de', 48, '{"categories":[],"meta":{}}', ?)`).run(pid);
  await api('GET', '/bericht/tokx'); await api('GET', '/bericht/tokx'); await api('GET', '/bericht/tokx?vorschau=1');
  await settle();
  const tasks = db.prepare(`SELECT * FROM tasks WHERE title LIKE 'Anrufen: Fahrschule Test%'`).all();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].priority, 'hoch');
  assert.ok(db.prepare(`SELECT * FROM notifications WHERE title LIKE '%Fahrschule Test hat den Bericht geöffnet'`).get());
});

test('Heute-Ansicht und Aufgaben', async () => {
  const t = (await api('POST', '/api/tasks', { title: 'Alte Aufgabe', due_at: '2026-01-01T09:00' })).body;
  const today = (await api('GET', '/api/today')).body;
  assert.ok(today.overdue.some((x) => x.id === t.id));
  await api('PUT', `/api/tasks/${t.id}`, { status: 'erledigt' });
  assert.ok((await api('GET', '/api/tasks?status=erledigt')).body.some((x) => x.id === t.id));
});

test('Kalender-Abo nur mit Schlüssel', async () => {
  assert.equal((await api('GET', '/kalender.ics')).status, 403);
  await api('PUT', '/api/settings', { ics_key: 'abc123' });
  const r = await api('GET', '/kalender.ics?key=abc123');
  assert.match(r.body, /BEGIN:VCALENDAR/);
  assert.match(r.body, /SUMMARY:Erstgespräch Website: Lea Koop/);
  assert.doesNotMatch(r.body, /Max Muster/, 'abgesagte Termine fehlen');
});

test('Vorlage „Termin gebucht“: Aufgabe 2 Stunden vor dem Termin, Lead auf „Qualifiziert“', async () => {
  await api('POST', '/api/automations/preset', { key: 'booked' });
  const r = await api('POST', '/api/public/book', { slug: 'erstgespraech-website', date: MON, time: '09:00', name: 'Jan Berends', email: 'jan@hofladen.de', consent: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await settle();
  const t = db.prepare(`SELECT * FROM tasks WHERE title = 'Termin vorbereiten: Jan Berends'`).get();
  assert.equal(t.due_at, `${MON} 07:00`);
  const c = db.prepare(`SELECT id FROM contacts WHERE email = 'jan@hofladen.de'`).get();
  const o = db.prepare('SELECT s.name FROM opportunities o JOIN stages s ON s.id = o.stage_id WHERE o.contact_id = ?').get(c.id);
  assert.equal(o.name, 'Qualifiziert');
});
