// Baut die Browser-Version von Webhafen OS: Server-Code und SQLite laufen komplett im Browser,
// mit Demo-Daten. Gedacht als Vorschau-Link zum Durchklicken (z. B. am Handy), nicht für echte Daten.
//   npm run build:browser  →  dist/browser/  (index.html + Dateien, statisch auslieferbar)
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist', 'browser');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'scripts'), { recursive: true });

const copy = (from, to = from) => cpSync(join(ROOT, from), join(OUT, to), { recursive: true });
copy('server.js'); copy('lib'); copy('public/app.js', 'app.js'); copy('public/app.css', 'app.css'); copy('public/brand', 'brand');
copy('scripts/demo-seed.js'); copy('scripts/demo-audit.json');
copy('browser/boot.js', 'boot.js'); copy('browser/shims', 'shims');

// Seite: Kopf (Titel, Lade-Anzeige) + Oberfläche aus public/index.html + Start-Skripte (Import-Map, sql.js, boot.js)
const app = readFileSync(join(ROOT, 'public', 'index.html'), 'utf8');
const body = app.split('<body>')[1].split('<script type="module" src="app.js"></script>')[0];
const page = readFileSync(join(ROOT, 'browser', 'head.html'), 'utf8') + body + readFileSync(join(ROOT, 'browser', 'tail.html'), 'utf8');
writeFileSync(join(OUT, 'index.html'), page);

const count = (d) => readdirSync(d, { withFileTypes: true }).reduce((n, f) => n + (f.isDirectory() ? count(join(d, f.name)) : 1), 0);
console.log(`Browser-Version gebaut: ${OUT} (${count(OUT)} Dateien)`);
