import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDb } from '../lib/db.js';
import { seedDemo } from '../scripts/demo-seed.js';

test('Demo-Daten lassen sich anlegen und sind vollständig', () => {
  const db = openDb(':memory:');
  seedDemo(db, { baseUrl: 'http://localhost:3000' });
  const n = (t) => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
  assert.equal(n('contacts'), 6);
  assert.ok(n('opportunities') >= 6);
  assert.ok(n('tasks') >= 6);
  assert.equal(n('calendars'), 2);
  assert.equal(n('automations'), 5);
  assert.equal(db.prepare(`SELECT token FROM audits`).get().token, 'demo-musterweg');
});

test('Demo-Bericht enthält keine echten Firmen- oder Personennamen', () => {
  const blob = readFileSync(new URL('../scripts/demo-audit.json', import.meta.url), 'utf8');
  for (const w of ['Neehoff', 'neehoff', 'Kröger', 'Rüther', 'Dankern', 'Gövert', 'Schramke']) assert.ok(!blob.includes(w), w);
});
