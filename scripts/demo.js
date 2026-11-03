// Webhafen OS zum Ausprobieren: startet mit Demo-Daten, E-Mails werden nur gesammelt (nicht verschickt).
//   npm run demo          → startet (Demo-Daten bleiben erhalten)
//   npm run demo -- --neu → setzt die Demo-Daten zurück
import { rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dbFile = join(ROOT, 'data', 'demo.db');
if (process.argv.includes('--neu')) for (const ext of ['', '-wal', '-shm']) rmSync(dbFile + ext, { force: true });

// Muss vor dem Laden des Servers gesetzt sein
process.env.DEMO = '1';
process.env.MAIL_TRANSPORT = 'json';
process.env.DB_FILE ||= dbFile;
process.env.TZ ||= 'Europe/Berlin';
process.env.ADMIN_PASSWORD ??= 'demo';
const port = Number(process.env.PORT || 3000);

const { db, start } = await import('../server.js');
const { seedDemo } = await import('./demo-seed.js');
if (!db.prepare('SELECT COUNT(*) n FROM contacts').get().n) { seedDemo(db, { baseUrl: `http://localhost:${port}` }); console.log('Demo-Daten angelegt.'); }

start({ port });
const lan = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
console.log(`
  ───────────────────────────────────────────────────────────
   Webhafen OS – Demo
   App:            http://localhost:${port}      Passwort: ${process.env.ADMIN_PASSWORD || '(keins)'}
   Buchungsseite:  http://localhost:${port}/termin/kostenloses-erstgespraech
   Bericht:        http://localhost:${port}/bericht/demo-musterweg
   Widget:         http://localhost:${port}/widget
  ${lan ? ` Vom Handy (gleiches WLAN): http://${lan}:${port}/termin/kostenloses-erstgespraech\n  ` : ''} E-Mails werden NICHT verschickt – sie landen im Demo-Postausgang (Banner oben).
   Beenden mit Strg+C · Zurücksetzen: npm run demo -- --neu
  ───────────────────────────────────────────────────────────`);
