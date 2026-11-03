import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { parseCSV } from '../lib/util.js';
import { analyzeHtml, normalizeUrl } from '../lib/audit.js';
import { parseFeed, runScheduler } from '../lib/social.js';

process.env.DB_FILE = ':memory:';
const { handle, db } = await import('../server.js');
const srv = http.createServer(handle).listen(0);
const base = `http://localhost:${srv.address().port}`;
const api = async (m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json' }, body: b && JSON.stringify(b), redirect: 'manual' }); return { status: r.status, headers: r.headers, body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() }; };
test.after(() => srv.close());

test('CSV mit Semikolon und Anführungszeichen', () => {
  const rows = parseCSV('﻿text;datum\n"Hallo; ""Welt""\nzweite Zeile";10.11.2026 09:00\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].text, 'Hallo; "Welt"\nzweite Zeile');
  assert.equal(rows[0].datum, '10.11.2026 09:00');
});

test('Audit erkennt Tracking und Pflichtangaben', () => {
  const html = `<html lang="de"><head><title>Fahrschule Muster in Haren (Ems)</title><meta name="viewport" content="width=device-width">
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123"></script><script>fbq('init','123')</script></head>
    <body><h1>Willkommen</h1><a href="tel:+495932123">Anrufen</a><a href="/impressum">Impressum</a><a href="/datenschutz">Datenschutz</a><img src="a.jpg" alt="Auto"></body></html>`;
  const r = analyzeHtml(html, { url: 'https://muster.de/', phone: '05932 123' });
  const get = (cat, label) => r.categories.find((c) => c.key === cat).checks.find((c) => c.label === label);
  assert.equal(get('tech', 'Google Analytics').ok, true);
  assert.equal(get('tech', 'Meta-Pixel').ok, true);
  assert.equal(get('tech', 'Google Tag Manager').ok, false);
  assert.equal(get('business', 'Impressum verlinkt').ok, true);
  assert.equal(get('business', 'Chat-Widget auf der Website').ok, false);
  assert.equal(get('business', 'Nachrichtenfähige Nummer (Mobil/WhatsApp)').ok, false);
  assert.equal(get('seo', 'Genau eine H1-Überschrift').ok, true);
});

test('Interne Adressen werden für Audits abgelehnt', () => {
  assert.throws(() => normalizeUrl('http://127.0.0.1/'));
  assert.throws(() => normalizeUrl('localhost:3000'));
  assert.equal(normalizeUrl('neehoff.de'), 'https://neehoff.de/');
});

test('RSS und Atom werden gelesen', () => {
  const rss = parseFeed('<rss><channel><item><title><![CDATA[Neu & frisch]]></title><link>https://a.de/1</link><guid>1</guid></item></channel></rss>');
  assert.deepEqual([rss[0].title, rss[0].link], ['Neu & frisch', 'https://a.de/1']);
  const atom = parseFeed('<feed><entry><title>Hallo</title><link href="https://b.de/x"/><id>x</id></entry></feed>');
  assert.equal(atom[0].link, 'https://b.de/x');
});

test('Leads, Slips und Prognose', async () => {
  const [p] = (await api('GET', '/api/pipelines')).body;
  const o = (await api('POST', '/api/opportunities', { name: 'Relaunch', pipeline_id: p.id, value: 1000, contact_name: 'Bernd', close_date: '2026-11-10' })).body;
  assert.equal(o.contact_name, 'Bernd');
  assert.equal(o.stage_id, p.stages[0].id);
  await api('PUT', '/api/opportunities/' + o.id, { stage_id: p.stages[3].id, close_date: '2026-11-30' }); // +20 Tage → hohes Risiko
  await api('POST', '/api/opportunities', { name: 'Gewonnen', pipeline_id: p.id, value: 500, status: 'won' });
  const f = (await api('GET', '/api/forecast?pipeline_id=' + p.id)).body;
  assert.equal(f.totals.max_potential, 1000);
  assert.equal(f.totals.expected, 1000 * p.stages[3].probability / 100);
  assert.equal(f.totals.won, 500);
  assert.equal(f.risk.high.count, 1);
});

test('Affiliate-Link, Klick und Provision', async () => {
  const c = (await api('POST', '/api/aff/campaigns', { name: 'Empfehlung', target_url: 'https://web-hafen.de/angebot', commission_type: 'percent', commission_value: 10 })).body;
  const a = (await api('POST', '/api/aff/affiliates', { name: 'Anna', campaign_id: c.id, code: 'anna' })).body;
  assert.equal(a.code, 'anna');
  const go = await api('GET', '/go/anna');
  assert.equal(go.status, 302);
  assert.equal(go.headers.get('location'), 'https://web-hafen.de/angebot?ref=anna');
  await api('PUT', '/api/settings', { aff_api_key: 'geheim' });
  assert.equal((await api('POST', '/api/public/sale', { key: 'falsch', ref: 'anna', amount: 100 })).status, 403);
  const s = (await api('POST', '/api/public/sale', { key: 'geheim', ref: 'anna', amount: '499,00', email: 'k@x.de' })).body;
  assert.equal(s.commission, 49.9);
  const d = (await api('GET', '/api/aff/dashboard')).body;
  assert.equal(d.clicks, 1); assert.equal(d.revenue, 499); assert.equal(d.conversion, 100);
});

test('Trigger-Link zählt Klicks', async () => {
  const l = (await api('POST', '/api/links', { name: 'Flyer Herbst', target_url: 'https://web-hafen.de' })).body;
  assert.equal(l.slug, 'flyer-herbst');
  assert.equal((await api('GET', '/l/flyer-herbst')).status, 302);
  assert.equal((await api('GET', '/api/links')).body[0].clicks, 1);
});

test('Planer veröffentlicht fällige Beiträge über Webhook', async () => {
  const got = [];
  const hook = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { got.push(JSON.parse(b)); res.end('ok'); }); }).listen(0);
  const acc = (await api('POST', '/api/social/accounts', { platform: 'instagram', name: 'Test-IG', webhook_url: `http://localhost:${hook.address().port}/` })).body;
  await api('POST', '/api/social/posts', { content: 'Fällig', account_ids: [acc.id], status: 'scheduled', scheduled_at: '2020-01-01T09:00' });
  await api('POST', '/api/social/posts', { content: 'Zukunft', account_ids: [acc.id], status: 'scheduled', scheduled_at: '2099-01-01T09:00' });
  const now = new Date();
  await api('POST', '/api/social/posts', { content: 'Jede Woche', account_ids: [acc.id], status: 'recurring', recurrence: { days: [now.getDay()], time: '00:00' } });
  await runScheduler(db, now);
  await runScheduler(db, now); // darf nicht doppelt posten
  hook.close();
  assert.deepEqual(got.map((g) => g.content).sort(), ['Fällig', 'Jede Woche']);
  const posts = (await api('GET', '/api/social/posts')).body;
  assert.equal(posts.find((p) => p.content === 'Fällig').status, 'published');
  assert.equal(posts.find((p) => p.content === 'Zukunft').status, 'scheduled');
});

test('Bericht-Seite ist öffentlich, API geschützt nur mit Passwort', async () => {
  db.prepare(`INSERT INTO audits (token, business_name, url, score, result) VALUES ('tok', 'Muster <GmbH>', 'https://m.de', 54, ?)`)
    .run(JSON.stringify({ url: 'https://m.de', categories: [{ key: 'seo', name: 'SEO', description: '', score: 54, checks: [{ label: 'Titel', ok: false, detail: 'fehlt', tip: 'Titel setzen' }] }], meta: {} }));
  const r = await api('GET', '/bericht/tok');
  assert.equal(r.status, 200);
  assert.match(r.body, /Muster &lt;GmbH&gt;/);
  assert.match(r.body, /Titel setzen/);
});
