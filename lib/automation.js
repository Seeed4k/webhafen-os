// Automationen: Auslöser (Ereignis) → Schritte (Aktionen, Wartezeiten, Bedingungen)
import { getSettings } from './db.js';
import { localStamp, parseJSON } from './util.js';
import { logActivity, createTask, dueIn, notify } from './crm.js';
import { sendMail, mailReady } from './mailer.js';
import { formatDe } from './calendar.js';

export const TRIGGERS = {
  'contact.created': { label: 'Neuer Kontakt angelegt', fields: [] },
  'contact.tag_added': { label: 'Tag beim Kontakt hinzugefügt', fields: ['tag'] },
  'opportunity.created': { label: 'Neuer Lead angelegt', fields: ['pipeline_id'] },
  'opportunity.stage_changed': { label: 'Lead in Phase verschoben', fields: ['pipeline_id', 'stage_id'] },
  'opportunity.status_changed': { label: 'Lead gewonnen / verloren', fields: ['status'] },
  'appointment.booked': { label: 'Termin gebucht', fields: ['calendar_id'] },
  'appointment.cancelled': { label: 'Termin abgesagt', fields: ['calendar_id'] },
  'report.viewed': { label: 'Interessent öffnet Website-Check-Bericht', fields: [] },
  'widget.submitted': { label: 'Website-Check über das Widget angefragt', fields: [] },
  'prospect.created': { label: 'Neuer Interessent (Akquise)', fields: ['source'] },
};

export const STEP_TYPES = {
  send_email: 'E-Mail senden', create_task: 'Aufgabe anlegen', notify: 'Benachrichtigung an mich', wait: 'Warten',
  condition: 'Bedingung prüfen', add_tag: 'Tag hinzufügen', remove_tag: 'Tag entfernen', move_stage: 'Lead in Phase verschieben',
  set_status: 'Lead-Status setzen', create_opportunity: 'Lead anlegen (falls keiner offen)', add_note: 'Notiz im Verlauf', webhook: 'Webhook aufrufen',
};

const one = (db, sql, ...a) => db.prepare(sql).get(...a);
const MAX_DEPTH = 3;

// ---------- Kontext: alle Daten rund um das Ereignis ----------
export function loadContext(db, ctx) {
  const c = { ...ctx };
  const appt = c.appointment_id ? one(db, 'SELECT * FROM appointments WHERE id = ?', c.appointment_id) : null;
  const audit = c.audit_id ? one(db, 'SELECT * FROM audits WHERE id = ?', c.audit_id) : null;
  const prospect = c.prospect_id ? one(db, 'SELECT * FROM prospects WHERE id = ?', c.prospect_id) : audit?.prospect_id ? one(db, 'SELECT * FROM prospects WHERE id = ?', audit.prospect_id) : null;
  c.opportunity_id ??= appt?.opportunity_id ?? prospect?.opportunity_id ?? null;
  let opp = c.opportunity_id ? one(db, 'SELECT o.*, s.name stage_name FROM opportunities o LEFT JOIN stages s ON s.id = o.stage_id WHERE o.id = ?', c.opportunity_id) : null;
  c.contact_id ??= opp?.contact_id ?? appt?.contact_id ?? prospect?.contact_id ?? audit?.contact_id ?? null;
  const contact = c.contact_id ? one(db, 'SELECT * FROM contacts WHERE id = ?', c.contact_id) : null;
  if (!opp && contact) {
    opp = one(db, `SELECT o.*, s.name stage_name FROM opportunities o LEFT JOIN stages s ON s.id = o.stage_id WHERE o.contact_id = ? AND o.status = 'open' ORDER BY o.id DESC LIMIT 1`, contact.id);
    if (opp) c.opportunity_id = opp.id;
  }
  const auditFor = audit || (prospect?.audit_id ? one(db, 'SELECT * FROM audits WHERE id = ?', prospect.audit_id) : null);
  return { ids: c, contact, opp, appt, audit: auditFor, prospect };
}

export function render(tpl, data, s) {
  const base = (s.public_url || '').replace(/\/$/, '');
  const k = data.contact || {}; const o = data.opp || {}; const a = data.appt; const au = data.audit;
  const vars = {
    'kontakt.name': k.name, 'kontakt.vorname': (k.name || '').split(' ')[0], 'kontakt.email': k.email, 'kontakt.telefon': k.phone, 'kontakt.firma': k.company || o.company || data.prospect?.name || data.audit?.business_name,
    'lead.name': o.name, 'lead.wert': o.value != null ? new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(o.value || 0) : '', 'lead.phase': o.stage_name,
    'termin.datum': a ? formatDe(a.start_at, false) : '', 'termin.uhrzeit': a ? a.start_at.slice(11) : '', 'termin.ort': a?.location, 'termin.absage_link': a && base ? `${base}/termin/absagen/${a.token}` : '',
    'bericht.link': au && base ? `${base}/bericht/${au.token}` : '', 'bericht.wertung': au ? `${au.score} %` : '',
    'agentur.name': s.agency_name, 'agentur.telefon': s.agency_phone, 'agentur.email': s.agency_email, 'agentur.website': s.agency_website,
    buchungslink: s.booking_slug && base ? `${base}/termin/${s.booking_slug}` : '',
  };
  return String(tpl || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => vars[key] ?? '');
}

const addTag = (tags, t) => [...new Set(String(tags || '').split(',').map((x) => x.trim()).filter(Boolean).concat(t))].join(',');
const hasTag = (tags, t) => String(tags || '').split(',').map((x) => x.trim().toLowerCase()).includes(String(t).trim().toLowerCase());

// ---------- Aktionen ----------
const ACTIONS = {
  async send_email(db, st, d, s) {
    const to = st.to === 'ich' ? s.notify_email || s.agency_email : st.to === 'adresse' ? st.address : d.contact?.email;
    if (!to) return { msg: 'Übersprungen: keine E-Mail-Adresse' };
    if (!mailReady(db)) throw new Error('E-Mail-Versand ist nicht eingerichtet');
    const subject = render(st.subject, d, s); const text = render(st.body, d, s);
    await sendMail(db, { to, subject, text });
    if (d.contact && st.to !== 'ich') logActivity(db, { type: 'email', title: `E-Mail gesendet: ${subject}`, body: text, contact_id: d.contact.id, opportunity_id: d.opp?.id });
    return { msg: `E-Mail an ${to}` };
  },
  async create_task(db, st, d, s, run) {
    // Bei Termin-Auslösern kann die Aufgabe relativ zum Termin fällig sein („2 Stunden vorher“)
    let due = dueIn({ days: st.due_days, hours: st.due_hours });
    if (st.before_appt_hours !== undefined && st.before_appt_hours !== '' && d.appt) {
      const t = new Date(new Date(d.appt.start_at.replace(' ', 'T')).getTime() - Number(st.before_appt_hours) * 3600e3);
      due = localStamp(t < new Date() ? new Date() : t);
    }
    const id = createTask(db, { title: render(st.title, d, s), notes: render(st.notes, d, s), due_at: due,
      priority: st.priority || 'normal', contact_id: d.contact?.id, opportunity_id: d.opp?.id, prospect_id: d.prospect?.id, source: 'automation', automation_id: run.automation_id });
    return { msg: `Aufgabe #${id} angelegt` };
  },
  async notify(db, st, d, s) {
    const link = d.contact ? `#/kontakte/${d.contact.id}` : d.audit ? `#/audits/${d.audit.id}` : '#/heute';
    await notify(db, { title: render(st.title, d, s), body: render(st.body, d, s), link, email: !!st.email });
    return { msg: 'Benachrichtigt' };
  },
  async condition(db, st, d) {
    const k = d.contact || {}; const o = d.opp || {};
    const val = { 'kontakt.email': k.email, 'kontakt.telefon': k.phone, 'kontakt.tag': k.tags, 'lead.status': o.status, 'lead.phase': o.stage_name, 'lead.vorhanden': o.id ? 'ja' : '' }[st.field];
    const ok = st.op === 'vorhanden' ? !!val : st.op === 'nicht_vorhanden' ? !val
      : st.field === 'kontakt.tag' ? (st.op === 'enthält' ? hasTag(val, st.value) : !hasTag(val, st.value))
      : st.op === 'gleich' ? String(val ?? '').toLowerCase() === String(st.value ?? '').toLowerCase() : String(val ?? '').toLowerCase() !== String(st.value ?? '').toLowerCase();
    return ok ? { msg: 'Bedingung erfüllt' } : { stop: true, msg: 'Bedingung nicht erfüllt – Ablauf beendet' };
  },
  async add_tag(db, st, d, s, run) {
    if (!d.contact) return { msg: 'Übersprungen: kein Kontakt' };
    if (hasTag(d.contact.tags, st.tag)) return { msg: 'Tag war schon vorhanden' };
    db.prepare('UPDATE contacts SET tags = ? WHERE id = ?').run(addTag(d.contact.tags, st.tag.trim()), d.contact.id);
    emit(db, 'contact.tag_added', { contact_id: d.contact.id, tag: st.tag.trim(), _depth: run.depth + 1 });
    return { msg: `Tag „${st.tag}“ gesetzt` };
  },
  async remove_tag(db, st, d) {
    if (!d.contact) return { msg: 'Übersprungen: kein Kontakt' };
    const tags = String(d.contact.tags || '').split(',').map((x) => x.trim()).filter((x) => x && x.toLowerCase() !== String(st.tag).trim().toLowerCase()).join(',');
    db.prepare('UPDATE contacts SET tags = ? WHERE id = ?').run(tags, d.contact.id);
    return { msg: `Tag „${st.tag}“ entfernt` };
  },
  async move_stage(db, st, d, s, run) {
    if (!d.opp) return { msg: 'Übersprungen: kein Lead' };
    const stage = one(db, 'SELECT * FROM stages WHERE id = ?', st.stage_id);
    if (!stage) throw new Error('Phase existiert nicht mehr');
    if (d.opp.stage_id === stage.id) return { msg: 'Lead war schon in dieser Phase' };
    db.prepare('UPDATE opportunities SET stage_id = ?, pipeline_id = ?, updated_at = ? WHERE id = ?').run(stage.id, stage.pipeline_id, localStamp(), d.opp.id);
    logActivity(db, { type: 'status', title: `Phase → ${stage.name} (Automation)`, opportunity_id: d.opp.id });
    emit(db, 'opportunity.stage_changed', { opportunity_id: d.opp.id, pipeline_id: stage.pipeline_id, stage_id: stage.id, _depth: run.depth + 1 });
    return { msg: `Phase → ${stage.name}` };
  },
  async set_status(db, st, d, s, run) {
    if (!d.opp) return { msg: 'Übersprungen: kein Lead' };
    db.prepare('UPDATE opportunities SET status = ?, closed_at = ?, updated_at = ? WHERE id = ?').run(st.status, st.status === 'open' ? null : localStamp(), localStamp(), d.opp.id);
    logActivity(db, { type: 'status', title: `Status → ${st.status} (Automation)`, opportunity_id: d.opp.id });
    emit(db, 'opportunity.status_changed', { opportunity_id: d.opp.id, status: st.status, _depth: run.depth + 1 });
    return { msg: `Status → ${st.status}` };
  },
  async create_opportunity(db, st, d, s, run) {
    if (d.opp) return { msg: 'Es gibt schon einen offenen Lead' };
    if (!d.contact) return { msg: 'Übersprungen: kein Kontakt' };
    const stage = one(db, 'SELECT * FROM stages WHERE id = ?', st.stage_id) || one(db, 'SELECT * FROM stages ORDER BY pipeline_id, position LIMIT 1');
    const id = Number(db.prepare('INSERT INTO opportunities (name, contact_id, pipeline_id, stage_id, company, source, updated_at) VALUES (?,?,?,?,?,?,?)')
      .run(render(st.name || '{{kontakt.name}}', d, s), d.contact.id, stage.pipeline_id, stage.id, d.contact.company || '', 'Automation', localStamp()).lastInsertRowid);
    logActivity(db, { type: 'status', title: 'Lead angelegt (Automation)', opportunity_id: id });
    emit(db, 'opportunity.created', { opportunity_id: id, pipeline_id: stage.pipeline_id, _depth: run.depth + 1 });
    return { msg: `Lead #${id} angelegt`, ctx: { opportunity_id: id } };
  },
  async add_note(db, st, d, s) {
    if (!d.contact && !d.opp) return { msg: 'Übersprungen: kein Kontakt' };
    logActivity(db, { type: 'notiz', title: render(st.text, d, s).slice(0, 120), body: render(st.text, d, s), contact_id: d.contact?.id, opportunity_id: d.opp?.id });
    return { msg: 'Notiz gespeichert' };
  },
  async webhook(db, st, d) {
    const r = await fetch(st.url, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ kontakt: d.contact, lead: d.opp, termin: d.appt, interessent: d.prospect, bericht: d.audit ? { id: d.audit.id, score: d.audit.score, token: d.audit.token } : null }) });
    if (!r.ok) throw new Error(`Webhook antwortete mit ${r.status}`);
    return { msg: `Webhook ${r.status}` };
  },
};

function waitUntil(st, now = new Date()) {
  const n = Number(st.amount) || 0; const d = new Date(now);
  if (st.unit === 'minuten') d.setMinutes(d.getMinutes() + n);
  else if (st.unit === 'stunden') d.setHours(d.getHours() + n);
  else d.setDate(d.getDate() + n);
  return localStamp(d);
}

// ---------- Ablauf ----------
async function execute(db, runId, now = new Date()) {
  const run = one(db, 'SELECT * FROM automation_runs WHERE id = ?', runId);
  const a = one(db, 'SELECT * FROM automations WHERE id = ?', run.automation_id);
  if (!a) return;
  const steps = parseJSON(a.steps, []); const log = parseJSON(run.log, []); const ctx = parseJSON(run.context, {});
  const s = getSettings(db);
  const save = (status, extra = {}) => db.prepare('UPDATE automation_runs SET status = ?, log = ?, context = ?, next_step = ?, resume_at = ?, finished_at = ? WHERE id = ?')
    .run(status, JSON.stringify(log), JSON.stringify(ctx), extra.next ?? steps.length, extra.resume ?? null, ['fertig', 'beendet', 'fehler'].includes(status) ? localStamp() : null, runId);
  for (let i = run.next_step; i < steps.length; i++) {
    const st = steps[i];
    if (st.type === 'wait') {
      const resume = waitUntil(st, now);
      log.push({ at: localStamp(now), step: i, ok: true, msg: `Wartet bis ${resume}` });
      return save('wartet', { next: i + 1, resume });
    }
    const fn = ACTIONS[st.type];
    if (!fn) { log.push({ at: localStamp(now), step: i, ok: false, msg: `Unbekannter Schritt ${st.type}` }); return save('fehler', { next: i }); }
    try {
      const r = (await fn(db, st, loadContext(db, ctx), s, { automation_id: a.id, depth: ctx._depth || 0 })) || {};
      if (r.ctx) Object.assign(ctx, r.ctx);
      log.push({ at: localStamp(now), step: i, ok: true, msg: r.msg || 'OK' });
      if (r.stop) return save('beendet');
    } catch (e) {
      log.push({ at: localStamp(now), step: i, ok: false, msg: e.message });
      return save('fehler', { next: i });
    }
  }
  return save('fertig');
}

function matches(a, ctx) {
  const cfg = parseJSON(a.trigger_config, {});
  return Object.entries(cfg).every(([k, v]) => v === '' || v == null || String(ctx[k] ?? '').toLowerCase() === String(v).toLowerCase());
}

export async function startRun(db, a, ctx, now = new Date()) {
  const id = Number(db.prepare('INSERT INTO automation_runs (automation_id, context) VALUES (?, ?)').run(a.id, JSON.stringify(ctx)).lastInsertRowid);
  db.prepare('UPDATE automations SET run_count = run_count + 1, last_run = ? WHERE id = ?').run(localStamp(now), a.id);
  await execute(db, id, now);
  return id;
}

// Ereignis auslösen. Läuft im Hintergrund, damit Anfragen nicht warten müssen.
const pending = new Set();
export function emit(db, event, ctx = {}) {
  if ((ctx._depth || 0) > MAX_DEPTH) return;
  const list = db.prepare('SELECT * FROM automations WHERE active = 1 AND trigger = ?').all(event).filter((a) => matches(a, ctx));
  if (!list.length) return;
  const p = (async () => { for (const a of list) { try { await startRun(db, a, ctx); } catch (e) { console.error('Automation:', e); } } })();
  pending.add(p); p.finally(() => pending.delete(p));
}
export const settle = () => Promise.all([...pending]); // für Tests

// Wartende Abläufe fortsetzen (läuft im Planer)
export async function resumeDue(db, now = new Date()) {
  for (const r of db.prepare(`SELECT id FROM automation_runs WHERE status = 'wartet' AND resume_at <= ?`).all(localStamp(now))) {
    db.prepare(`UPDATE automation_runs SET status = 'läuft' WHERE id = ?`).run(r.id);
    await execute(db, r.id, now);
  }
}

// ---------- Vorlagen ----------
export function presets(db) {
  const stage = (re) => one(db, `SELECT s.id FROM stages s JOIN pipelines p ON p.id = s.pipeline_id WHERE s.name LIKE ? ORDER BY p.id, s.position LIMIT 1`, re)?.id ?? '';
  return [
    { key: 'report-call', name: 'Bericht geöffnet → anrufen', description: 'Sobald ein Interessent seinen Website-Check öffnet: Handy-Benachrichtigung und Anruf-Aufgabe für heute.',
      trigger: 'report.viewed', trigger_config: {}, steps: [
        { type: 'notify', title: '🔥 {{kontakt.firma}} hat den Bericht geöffnet', body: 'Wertung {{bericht.wertung}} – jetzt ist ein guter Moment für einen Anruf.', email: false },
        { type: 'create_task', title: 'Anrufen: {{kontakt.firma}} (Bericht geöffnet)', notes: 'Bericht: {{bericht.link}}\nTelefon: {{kontakt.telefon}}', due_hours: 2, priority: 'hoch' }] },
    { key: 'booked', name: 'Termin gebucht → vorbereiten', description: 'Bei jeder Buchung: Lead auf „Qualifiziert“ und eine Vorbereitungs-Aufgabe 2 Stunden vor dem Termin.',
      trigger: 'appointment.booked', trigger_config: {}, steps: [
        { type: 'move_stage', stage_id: stage('%ualifiz%') },
        { type: 'create_task', title: 'Termin vorbereiten: {{kontakt.name}}', notes: 'Termin: {{termin.datum}}, {{termin.uhrzeit}} Uhr\n{{bericht.link}}', before_appt_hours: 2 }] },
    { key: 'widget', name: 'Widget-Anfrage → Danke-Mail & Nachfassen', description: 'Danke-Mail mit Bericht und Buchungslink, nach 3 Tagen eine Nachfass-Aufgabe, falls noch kein Termin.',
      trigger: 'widget.submitted', trigger_config: {}, steps: [
        { type: 'send_email', to: 'kontakt', subject: 'Ihr Website-Check für {{kontakt.firma}}', body: 'Hallo {{kontakt.vorname}},\n\nvielen Dank für Ihr Interesse! Ihr Ergebnis: {{bericht.wertung}}.\nDen ausführlichen Bericht finden Sie hier: {{bericht.link}}\n\nWenn Sie möchten, gehen wir die Punkte in einem kostenlosen 15-Minuten-Gespräch durch: {{buchungslink}}\n\nViele Grüße\n{{agentur.name}}\n{{agentur.telefon}}' },
        { type: 'wait', amount: 3, unit: 'tage' },
        { type: 'condition', field: 'kontakt.tag', op: 'enthält_nicht', value: 'termin' },
        { type: 'create_task', title: 'Nachfassen: {{kontakt.firma}} (Widget-Check)', notes: 'Bericht: {{bericht.link}}', due_days: 0, due_hours: 1 }] },
    { key: 'tag-booked', name: 'Termin gebucht → Tag „termin“', description: 'Markiert Kontakte mit Termin – andere Abläufe (z. B. Nachfassen) überspringen sie dann.',
      trigger: 'appointment.booked', trigger_config: {}, steps: [{ type: 'add_tag', tag: 'termin' }] },
    { key: 'offer-followup', name: 'Angebot gesendet → nach 5 Tagen nachfassen', description: 'Wenn ein Lead in „Angebot gesendet“ landet und nach 5 Tagen immer noch dort steht: Erinnerung.',
      trigger: 'opportunity.stage_changed', trigger_config: { stage_id: stage('%ngebot%') }, steps: [
        { type: 'wait', amount: 5, unit: 'tage' },
        { type: 'condition', field: 'lead.phase', op: 'gleich', value: one(db, 'SELECT name FROM stages WHERE id = ?', stage('%ngebot%'))?.name || 'Angebot gesendet' },
        { type: 'create_task', title: 'Angebot nachfassen: {{lead.name}}', notes: 'Wert: {{lead.wert}}', due_days: 0, due_hours: 1, priority: 'hoch' }] },
    { key: 'won-review', name: 'Lead gewonnen → Danke & Bewertungsbitte', description: 'Danke-Mail sofort, nach 14 Tagen die Bitte um eine Google-Bewertung.',
      trigger: 'opportunity.status_changed', trigger_config: { status: 'won' }, steps: [
        { type: 'send_email', to: 'kontakt', subject: 'Danke für Ihren Auftrag!', body: 'Hallo {{kontakt.vorname}},\n\nvielen Dank für Ihr Vertrauen – wir freuen uns auf die Zusammenarbeit!\n\nViele Grüße\n{{agentur.name}}' },
        { type: 'wait', amount: 14, unit: 'tage' },
        { type: 'send_email', to: 'kontakt', subject: 'Eine kleine Bitte', body: 'Hallo {{kontakt.vorname}},\n\nwaren Sie mit uns zufrieden? Dann würden wir uns sehr über eine kurze Google-Bewertung freuen. Das hilft uns enorm.\n\nHerzlichen Dank!\n{{agentur.name}}' }] },
  ];
}

