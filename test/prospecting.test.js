import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// --- Nachgebaute Google Places API ---
const CENTER = { latitude: 52.79, longitude: 7.24 };
const PLACES = [
  { id: 'p-neehoff', displayName: { text: 'Fahrschule Neehoff' }, formattedAddress: 'Lange Str. 56, 49733 Haren (Ems)', location: { latitude: 52.791, longitude: 7.241 },
    rating: 4.7, userRatingCount: 93, websiteUri: 'https://neehoff.de/', nationalPhoneNumber: '05932 2195', businessStatus: 'OPERATIONAL', primaryTypeDisplayName: { text: 'Fahrschule' }, photos: new Array(10).fill({}), regularOpeningHours: {} },
  { id: 'p-dach', displayName: { text: 'Dachdecker Brink' }, formattedAddress: 'Dieselstr. 2, 49733 Haren (Ems)', location: { latitude: 52.80, longitude: 7.25 },
    rating: 4.3, userRatingCount: 6, nationalPhoneNumber: '05932 1234', businessStatus: 'OPERATIONAL', primaryTypeDisplayName: { text: 'Dachdecker' }, photos: [{}] },
  { id: 'p-fern', displayName: { text: 'Dachbau Berlin' }, formattedAddress: 'Berlin', location: { latitude: 52.52, longitude: 13.40 }, rating: 5, userRatingCount: 10 },
];
let calls = 0;
const fake = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    calls++;
    if (req.headers['x-goog-api-key'] !== 'test') { res.writeHead(403); return res.end('{}'); }
    const json = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.method === 'GET') {
      const id = decodeURIComponent(req.url.split('/places/')[1].split('?')[0]);
      const p = PLACES.find((x) => x.id === id);
      return json({ ...p, reviews: [{ rating: 5, text: { text: 'Super Fahrschule!' }, authorAttribution: { displayName: 'Rolf' }, relativePublishTimeDescription: 'vor 2 Wochen', publishTime: new Date(Date.now() - 14 * 864e5).toISOString() },
        { rating: 1, text: { text: 'Nie wieder' }, authorAttribution: { displayName: 'Max' }, relativePublishTimeDescription: 'vor einem Jahr', publishTime: '2025-01-01T00:00:00Z' }] });
    }
    const q = JSON.parse(b);
    if (req.headers['x-goog-fieldmask'] === 'places.location,places.formattedAddress') return json({ places: [{ location: CENTER, formattedAddress: 'Haren (Ems), Deutschland' }] });
    if (req.headers['x-goog-fieldmask'] === 'places.id') return json({ places: [{ id: q.textQuery.includes('Neehoff') ? 'p-neehoff' : 'p-dach' }] });
    if (/fahrschule/i.test(q.textQuery)) {
      // Ranking hängt vom Suchpunkt ab: nördlich Platz 1, südlich Platz 2
      const north = q.locationBias.circle.center.latitude >= CENTER.latitude;
      const comp = { id: 'p-comp', displayName: { text: 'Fahrschule Konkurrenz' }, rating: 5, userRatingCount: 64, photos: [{}] };
      return json({ places: north ? [PLACES[0], comp] : [comp, PLACES[0]] });
    }
    return json({ places: PLACES.slice(1) });
  });
}).listen(0);

process.env.DB_FILE = ':memory:';
process.env.GOOGLE_PLACES_API_KEY = 'test';
process.env.PLACES_BASE_URL = `http://localhost:${fake.address().port}`;
const { handle, db } = await import('../server.js');
const { runAgent, agentDue } = await import('../lib/prospects.js');
const srv = http.createServer(handle).listen(0);
const base = `http://localhost:${srv.address().port}`;
const api = async (m, p, b, h = {}) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...h }, body: b && JSON.stringify(b) }); return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() }; };
test.after(() => { srv.close(); fake.close(); });

test('Lead-Finder sucht im Umkreis und bewertet das Potenzial', async () => {
  const r = (await api('POST', '/api/prospects/search', { query: 'Dachdecker', location: 'Haren (Ems)', radius_km: 5 })).body;
  assert.deepEqual(r.results.map((p) => p.name), ['Dachdecker Brink']); // Berlin liegt außerhalb
  assert.ok(r.results[0].potential.score >= 60);
  assert.ok(r.results[0].potential.why.includes('keine Website'));
  assert.equal(r.results[0].prospect, null);
});

test('Interessent ohne Website hinzufügen und prüfen', async () => {
  const s = (await api('POST', '/api/prospects/search', { query: 'Dachdecker', location: 'Haren (Ems)', radius_km: 5 })).body;
  const add = (await api('POST', '/api/prospects', { items: [{ ...s.results[0], potential: undefined }], audit: true })).body;
  assert.equal(add.added, 1);
  const again = (await api('POST', '/api/prospects', { items: [s.results[0]] })).body;
  assert.equal(again.added, 0, 'kein Duplikat');
  const [p] = (await api('GET', '/api/prospects')).body;
  assert.equal(p.status, 'geprüft');
  const a = (await api('GET', '/api/audits/' + p.audit_id)).body;
  const keys = a.result.categories.map((c) => c.key);
  assert.deepEqual(keys, ['website', 'gbp', 'reputation', 'local']);
  assert.equal(a.result.categories[0].score, 0);
  assert.ok(a.score < 60);
});

test('Manueller Check mit Google-Daten: Ranking, Online-Ruf, Heatmap und Bericht', async () => {
  const a = (await api('POST', '/api/audits', { business_name: 'Fahrschule Neehoff', address: 'Haren', industry: 'Fahrschule' })).body;
  const full = (await api('GET', '/api/audits/' + a.id)).body;
  const local = full.result.categories.find((c) => c.key === 'local');
  assert.ok(local, 'Kategorie Lokale Sichtbarkeit vorhanden');
  assert.equal(full.result.meta.ranking.rank, 1); // Suchpunkt am Standort liegt im fiktiven Datensatz „nördlich“ → Platz 1
  const rep = full.result.categories.find((c) => c.key === 'reputation');
  assert.equal(rep.checks.find((c) => c.label.startsWith('Kaum negative')).ok, false); // 1 von 2 negativ
  const h = (await api('POST', `/api/audits/${a.id}/heatmap`, { keyword: 'Fahrschule', size: 3, radius_km: 3 })).body;
  assert.equal(h.points.length, 9);
  assert.deepEqual(h.points.map((p) => p.rank), [1, 1, 1, 1, 1, 1, 2, 2, 2]);
  assert.equal(h.score, 100); // Platz 2 zählt ebenfalls als Top 3
  assert.equal(h.avg_rank, 1.3);
  const tok = full.token;
  const page = await api('GET', `/bericht/${tok}`);
  assert.match(page.body, /Lokaler Ranking-Tracker/);
  assert.match(page.body, /Ihr Unternehmen/);
  assert.match(page.body, /Lokale SEO-Heatmap/);
  assert.match(page.body, /Super Fahrschule!/);
  await api('GET', `/bericht/${tok}?vorschau=1`);
  assert.equal((await api('GET', '/api/audits/' + a.id)).body.views, 1, 'Vorschau zählt nicht als Aufruf');
});

test('Interessent ins CRM übernehmen (einmalig)', async () => {
  const [p] = (await api('GET', '/api/prospects?q=Brink')).body;
  const r = (await api('POST', `/api/prospects/${p.id}/crm`)).body;
  assert.equal(r.existed, false);
  assert.equal((await api('POST', `/api/prospects/${p.id}/crm`)).body.existed, true);
  const opps = (await api('GET', '/api/opportunities')).body;
  assert.ok(opps.some((o) => o.name === 'Dachdecker Brink – Neue Website' && o.tags === 'ohne-website'));
});

test('Anschreiben ohne KI-Schlüssel nutzt die Vorlage', async () => {
  const [p] = (await api('GET', '/api/prospects?q=Brink')).body;
  const d = (await api('POST', `/api/prospects/${p.id}/outreach`)).body;
  assert.equal(d.generator, 'Vorlage');
  assert.match(d.body, /keine eigene Website/);
});

test('Prospect-Agent findet nur neue Unternehmen', async () => {
  db.prepare('DELETE FROM prospects').run();
  const g = (await api('POST', '/api/agents', { name: 'Dach', query: 'Dachdecker', location: 'Haren', radius_km: 10, auto_audit: 0, auto_crm: 1, max_per_run: 5 })).body;
  const r1 = await runAgent(db, g);
  assert.deepEqual([r1.found, r1.new, r1.crm], [1, 1, 1]);
  const r2 = await runAgent(db, g);
  assert.equal(r2.new, 0);
  const mon = new Date('2026-11-02T08:00:00'); // Montag
  assert.equal(agentDue({ active: 1, frequency: 'weekly', weekday: 1, time: '07:00', last_run: null }, mon), true);
  assert.equal(agentDue({ active: 1, frequency: 'weekly', weekday: 2, time: '07:00', last_run: null }, mon), false);
  assert.equal(agentDue({ active: 1, frequency: 'daily', weekday: 1, time: '07:00', last_run: '2026-11-02 07:01' }, mon), false);
});

test('Widget: Pflichtfelder, Honeypot und Begrenzung', async () => {
  const ok = { business_name: 'Test', url: 'https://gibt-es-nicht.invalid', email: 'a@b.de', consent: true };
  assert.equal((await api('POST', '/api/public/widget', { ...ok, consent: false })).status, 400);
  assert.equal((await api('POST', '/api/public/widget', { ...ok, website_hp: 'bot' })).status, 400);
  const st = [];
  for (let i = 0; i < 4; i++) st.push((await api('POST', '/api/public/widget', ok)).status);
  assert.deepEqual(st, [422, 422, 422, 429]);
  const w = await api('GET', '/widget');
  assert.match(w.body, /Kostenloser Website-Check/);
});

test('Analytics zählt Berichte, Kontakte und Aufrufe', async () => {
  const a = (await api('GET', '/api/analytics?months=6')).body;
  assert.ok(a.totals.reports >= 2);
  assert.equal(a.totals.views, 1);
  assert.equal(a.months.length, 6);
  assert.ok(a.widget.length >= 3);
});

test('Lead-Bewertung berücksichtigt die Schnellprüfung der Website', async () => {
  const { leadPotential } = await import('../lib/places.js');
  const base = { website: 'https://x.de', rating: 4.8, review_count: 50, photos: 10, has_hours: true, phone: '1' };
  const good = leadPotential(base, { reachable: true, https: true, viewport: true, builder: false, ms: 500, analytics: true, chat: ['Tawk.to'], cms: ['WordPress'] });
  assert.deepEqual([good.score, good.level], [0, 'niedrig']);
  const bad = leadPotential(base, { reachable: true, https: false, viewport: false, builder: true, ms: 4000, analytics: false, chat: [], cms: ['Jimdo'] });
  assert.equal(bad.level, 'mittel');
  assert.ok(bad.why.includes('Homepage-Baukasten (Jimdo)'));
  assert.equal(leadPotential({ ...base, website: '' }).checked, true);
  assert.equal(leadPotential(base).checked, false, 'ohne Prüfung noch vorläufig');
  assert.equal(leadPotential({ website: '', rating: null, review_count: 0, photos: 0 }).level, 'hoch');
});

test('Schnellprüfung liefert Ergebnis und nutzt den Zwischenspeicher', async () => {
  const items = [{ place_id: 'q1', name: 'X', website: 'https://gibt-es-nicht.invalid', rating: 4.9, review_count: 40, photos: 10, has_hours: true, phone: '1' }];
  const [r] = (await api('POST', '/api/prospects/quick-check', { items })).body;
  assert.equal(r.site.reachable, false);
  assert.ok(r.potential.why.includes('Website nicht erreichbar'));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM site_checks').get().n, 1);
  const t0 = Date.now(); await api('POST', '/api/prospects/quick-check', { items });
  assert.ok(Date.now() - t0 < 200, 'zweiter Aufruf aus dem Zwischenspeicher');
});
