// Demo-Daten zum Ausprobieren. Alle Firmen, Personen und Adressen sind erfunden.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setSettings } from '../lib/db.js';
import { localStamp, token } from '../lib/util.js';
import { presets } from '../lib/automation.js';

const HERE = dirname(fileURLToPath(import.meta.url));

export function seedDemo(db, { baseUrl = 'http://localhost:3000' } = {}) {
  const ins = (table, data) => {
    const k = Object.keys(data);
    return Number(db.prepare(`INSERT INTO ${table} (${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`).run(...Object.values(data)).lastInsertRowid);
  };
  const day = (n, time = null) => { const d = new Date(); d.setDate(d.getDate() + n); const s = localStamp(d); return time ? `${s.slice(0, 10)} ${time}` : s.slice(0, 10); };
  const workday = (n, time) => { const d = new Date(); d.setDate(d.getDate() + n); while ([0, 6].includes(d.getDay())) d.setDate(d.getDate() + 1); return `${localStamp(d).slice(0, 10)} ${time}`; };
  const ago = (hours) => localStamp(new Date(Date.now() - hours * 3600e3));
  const addMin = (stamp, min) => localStamp(new Date(new Date(stamp.replace(' ', 'T')).getTime() + min * 60000));

  setSettings(db, {
    agency_name: 'Webhafen – Webdesign & Entwicklung', agency_website: 'web-hafen.de', agency_email: 'info@web-hafen.de', agency_phone: '+49 160 4323105',
    public_url: baseUrl, booking_slug: 'kostenloses-erstgespraech', notify_email: 'info@web-hafen.de', default_location: 'Haren (Ems)', brand_color: '#0B4AA0', ics_key: 'demo-kalender',
  });

  // ---------- Kontakte ----------
  const C = {};
  for (const [key, name, company, email, tags, notes] of [
    ['bernd', 'Bernd Muster', 'Fahrschule Musterweg', 'bernd@fahrschule-musterweg.example', 'audit,termin', 'Über den Website-Check gekommen. Will mehr Anmeldungen über die Website.'],
    ['lena', 'Lena Brink', 'Bäckerei Brink', 'lena@baeckerei-brink.example', 'stammkunde', 'Website von uns seit 2024. Empfiehlt uns weiter (Affiliate).'],
    ['jan', 'Jan Kuper', 'Dachdeckerei Kuper', 'jan@dachdeckerei-kuper.example', 'handwerk', ''],
    ['maria', 'Maria Wessels', 'Physiotherapie am Hafen', 'praxis@physio-am-hafen.example', 'wartung', 'Wartungsvertrag läuft Ende des Monats aus.'],
    ['tim', 'Tim Rolfes', 'Autohaus Rolfes', 'tim@autohaus-rolfes.example', 'kunde', ''],
    ['sabine', 'Sabine Koop', 'Hofladen Koop', 'sabine@hofladen-koop.example', 'shop', 'Möchte Hofladen-Produkte online verkaufen, Abholung vor Ort.'],
  ]) C[key] = ins('contacts', { name, company, email, phone: '05932 000000', tags, notes });

  // ---------- Leads ----------
  const pipe = db.prepare('SELECT id FROM pipelines ORDER BY id LIMIT 1').get().id;
  const st = Object.fromEntries(db.prepare('SELECT id, name FROM stages WHERE pipeline_id = ?').all(pipe).map((s) => [s.name, s.id]));
  const O = {};
  for (const [key, name, contact, stage, value, close, extra] of [
    ['bernd', 'Fahrschule Musterweg – Neue Website', 'bernd', 'Qualifiziert', 3900, day(14), { source: 'Website-Check' }],
    ['lena', 'Bäckerei Brink – SEO-Paket', 'lena', 'Kontaktiert', 1200, day(7), { source: 'Bestandskunde' }],
    ['jan', 'Dachdeckerei Kuper – Website + Google-Profil', 'jan', 'Angebot gesendet', 4800, day(5), { source: 'Lead-Finder', slip_count: 2, slip_days: 16 }],
    ['maria', 'Physiotherapie am Hafen – Wartungsvertrag', 'maria', 'Verhandlung', 900, day(-2), { source: 'Bestandskunde' }],
    ['sabine', 'Hofladen Koop – Onlineshop', 'sabine', 'Neuer Lead', 6500, null, { source: 'Empfehlung', tags: 'shop' }],
    ['tim', 'Autohaus Rolfes – Landingpage', 'tim', 'Abgeschlossen', 2500, day(-10), { status: 'won', closed_at: ago(240) }],
  ]) O[key] = ins('opportunities', { name, contact_id: C[contact], pipeline_id: pipe, stage_id: st[stage], value, close_date: close, company: name.split(' – ')[0], updated_at: ago(5), ...extra });
  ins('opportunities', { name: 'Café am Deich – Relaunch', pipeline_id: pipe, stage_id: st['Angebot gesendet'], value: 2000, status: 'lost', closed_at: ago(400), company: 'Café am Deich', source: 'Messe', updated_at: ago(400) });

  // ---------- Verlauf ----------
  for (const [contact, type, title, body, hours, opp] of [
    ['bernd', 'bericht', 'Website-Check-Bericht geöffnet (68 %)', '', 3, null],
    ['bernd', 'anruf', 'Telefonat', 'Interesse an neuer Website + besserem Google-Profil. Budget ca. 4.000 €. Will Referenzen anderer Fahrschulen sehen.', 26, 'bernd'],
    ['bernd', 'status', 'Phase → Qualifiziert', '', 26, 'bernd'],
    ['jan', 'email', 'E-Mail gesendet: Ihr Angebot für die neue Website', 'Hallo Herr Kuper,\n\nanbei wie besprochen unser Angebot …', 120, 'jan'],
    ['jan', 'notiz', 'Rückruf vereinbart', 'Will das Angebot mit seiner Frau besprechen, meldet sich nach dem Urlaub.', 70, 'jan'],
    ['maria', 'treffen', 'Treffen in der Praxis', 'Will den Wartungsvertrag verlängern, wünscht aber zusätzlich einen Online-Terminkalender.', 50, 'maria'],
    ['lena', 'notiz', 'Empfehlung', 'Hat uns an Sabine Koop (Hofladen) empfohlen.', 200, null],
  ]) ins('activities', { type, title, body, contact_id: C[contact], opportunity_id: opp ? O[opp] : null, created_at: ago(hours) });

  // ---------- Aufgaben ----------
  for (const [title, due, contact, opp, priority, extra] of [
    ['Angebot für Hofladen Koop schreiben', day(-1), 'sabine', 'sabine', 'hoch', {}],
    ['Kuper wegen Angebot anrufen', day(0, '10:00'), 'jan', 'jan', 'hoch', { source: 'automation' }],
    ['Domain für Physiotherapie am Hafen verlängern', day(0), 'maria', null, 'normal', {}],
    ['Referenzen für Fahrschule Musterweg zusammenstellen', day(1), 'bernd', 'bernd', 'normal', {}],
    ['Monatsbericht an Bäckerei Brink schicken', day(3), 'lena', null, 'normal', {}],
    ['Blogartikel „5 Tipps für Handwerker-Websites“ schreiben', null, null, null, 'normal', {}],
  ]) ins('tasks', { title, due_at: due, contact_id: contact ? C[contact] : null, opportunity_id: opp ? O[opp] : null, priority, ...extra });
  ins('tasks', { title: 'Landingpage Autohaus Rolfes livestellen', status: 'erledigt', done_at: ago(30), contact_id: C.tim, opportunity_id: O.tim });

  // ---------- Kalender & Termine ----------
  const cal = ins('calendars', { name: 'Kostenloses Erstgespräch', slug: 'kostenloses-erstgespraech', duration: 15, buffer: 15, slot_step: 15, min_notice_hours: 2, max_days: 30,
    location: 'Telefon – wir rufen Sie an', description: 'In 15 Minuten gehen wir gemeinsam Ihre Website und Ihr Google-Profil durch – kostenlos und unverbindlich.' });
  const cal2 = ins('calendars', { name: 'Projektbesprechung', slug: 'projektbesprechung', duration: 60, buffer: 15, slot_step: 30, min_notice_hours: 24, max_days: 45, color: '#16a34a',
    location: 'Videocall (Link folgt per E-Mail)', description: 'Für bestehende Kunden: Abstimmung zu laufenden Projekten.', create_lead: 0,
    availability: JSON.stringify({ 2: [['10:00', '12:00']], 4: [['14:00', '17:00']] }) });
  const t1 = workday(1, '10:00'); const t2 = workday(2, '14:00'); const t3 = workday(1, '12:00');
  ins('appointments', { calendar_id: cal, title: 'Kostenloses Erstgespräch: Bernd Muster', start_at: t1, end_at: addMin(t1, 15), contact_id: C.bernd, opportunity_id: O.bernd,
    name: 'Bernd Muster', email: 'bernd@fahrschule-musterweg.example', phone: '05932 000000', message: 'Unsere Website ist auf dem Handy kaum zu bedienen.', location: 'Telefon – wir rufen Sie an', token: token(16), source: 'buchungsseite', created_at: ago(3) });
  ins('appointments', { calendar_id: cal2, title: 'Projektbesprechung: Jan Kuper', start_at: t2, end_at: addMin(t2, 60), contact_id: C.jan, opportunity_id: O.jan,
    name: 'Jan Kuper', email: 'jan@dachdeckerei-kuper.example', location: 'Videocall', token: token(16), source: 'manuell' });
  ins('appointments', { title: 'Blocker: Steuerberater', start_at: t3, end_at: addMin(t3, 60), kind: 'blocker', token: token(16) });

  // ---------- Akquise: Interessenten & Website-Check ----------
  const fx = JSON.parse(readFileSync(join(HERE, 'demo-audit.json'), 'utf8'));
  const pBernd = ins('prospects', { name: 'Fahrschule Musterweg', address: 'Hafenstraße 12, 49733 Haren (Ems)', phone: '05932 000000', website: 'https://example.org/', category: 'Fahrschule',
    rating: 4.7, review_count: 93, photos: 0, potential: 45, potential_why: JSON.stringify(['kaum Fotos', 'kein Chat/WhatsApp', 'kein Tracking']), status: 'im CRM', source: 'lead-finder',
    contact_id: C.bernd, opportunity_id: O.bernd, created_at: ago(30) });
  const aid = ins('audits', { token: 'demo-musterweg', business_name: 'Fahrschule Musterweg', url: 'https://example.org/', industry: 'Fahrschule', phone: '05932 000000',
    address: 'Hafenstraße 12, 49733 Haren (Ems)', score: fx.score, result: JSON.stringify(fx.result), heatmaps: JSON.stringify(fx.heatmaps), prospect_id: pBernd, contact_id: C.bernd, source: 'lead-finder', created_at: ago(28) });
  db.prepare('UPDATE prospects SET audit_id = ? WHERE id = ?').run(aid, pBernd);
  for (const h of [3, 5, 27]) ins('report_views', { audit_id: aid, created_at: ago(h) });
  for (const [name, address, website, rating, reviews, photos, pot, why] of [
    ['Dachtechnik Nord', 'Landegge 3, 49733 Haren (Ems)', '', 3.8, 12, 1, 87, ['keine Website', 'nur 3,8 Sterne', 'wenige Bewertungen (12)', 'kaum Fotos']],
    ['Holzbau Ems-Tal', 'Wesuwe 8, 49733 Haren (Ems)', '', null, 0, 0, 82, ['keine Website', 'keine Bewertungen', 'wenige Bewertungen (0)', 'kaum Fotos']],
    ['Zimmerei am Kanal', 'Emmelner Str. 14, 49733 Haren (Ems)', 'https://example.com/', 4.9, 41, 8, 23, ['kein Tracking']],
  ]) ins('prospects', { name, address, website, rating, review_count: reviews, photos, potential: pot, potential_why: JSON.stringify(why), category: 'Dachdecker', status: 'neu', source: 'lead-finder', created_at: ago(20) });

  // ---------- Automationen (Vorlagen) ----------
  for (const key of ['report-call', 'booked', 'tag-booked', 'widget', 'won-review']) {
    const p = presets(db).find((x) => x.key === key);
    ins('automations', { name: p.name, trigger: p.trigger, trigger_config: JSON.stringify(p.trigger_config), steps: JSON.stringify(p.steps), active: 1 });
  }

  // ---------- Social, Affiliate, Trigger-Links ----------
  const ig = ins('social_accounts', { platform: 'instagram', name: 'Webhafen Instagram' });
  const li = ins('social_accounts', { platform: 'linkedin', name: 'Webhafen LinkedIn' });
  ins('posts', { content: '5 Gründe, warum Ihre Website ein Chat-Widget braucht 💬 Neuer Blogartikel!', link: 'https://web-hafen.de/blog', account_ids: JSON.stringify([ig, li]), scheduled_at: day(1, '09:00'), status: 'scheduled' });
  ins('posts', { content: 'Tipp der Woche: Pflegen Sie Ihr Google-Unternehmensprofil – Öffnungszeiten, Fotos, Antworten auf Bewertungen.', account_ids: JSON.stringify([ig]), status: 'recurring', recurrence: JSON.stringify({ days: [2, 4], time: '09:00' }) });
  const camp = ins('aff_campaigns', { name: 'Kunden werben Kunden', target_url: 'https://web-hafen.de', commission_type: 'percent', commission_value: 10 });
  const aff = ins('affiliates', { name: 'Lena Brink', email: 'lena@baeckerei-brink.example', code: 'lena', campaign_id: camp });
  for (let i = 0; i < 6; i++) ins('aff_clicks', { affiliate_id: aff, created_at: ago(24 * (i + 1)) });
  ins('aff_sales', { affiliate_id: aff, campaign_id: camp, customer_name: 'Autohaus Rolfes', customer_email: 'tim@autohaus-rolfes.example', amount: 2500, commission: 250, status: 'pending', created_at: ago(240) });
  const link = ins('trigger_links', { name: 'Flyer Herbst', slug: 'flyer-herbst', target_url: 'https://web-hafen.de', tag: 'print' });
  for (let i = 0; i < 9; i++) ins('link_clicks', { link_id: link, created_at: ago(10 * (i + 1)) });

  // ---------- Benachrichtigungen ----------
  ins('notifications', { title: '📅 Neuer Termin: Bernd Muster', body: 'Kostenloses Erstgespräch', link: `#/kontakte/${C.bernd}`, created_at: ago(3) });
  ins('notifications', { title: '🔥 Fahrschule Musterweg hat den Bericht geöffnet', body: 'Wertung 68 % – jetzt ist ein guter Moment für einen Anruf.', link: `#/kontakte/${C.bernd}`, created_at: ago(3) });
  return { contacts: Object.keys(C).length };
}
