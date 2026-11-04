// Webhafen OS im Browser: startet den echten Server-Code mit einer SQLite-Datenbank im Handy/Browser.
// Anfragen der App an /api/… werden direkt an den Server-Code übergeben – ohne Netzwerk.
const STORE = 'wos-demo-db-v1';
const $ = (s) => document.querySelector(s);
const status = (t) => { const el = $('#wosLoading'); if (el) el.querySelector('span').textContent = t; };

// ---------- Umgebung wie auf dem Server ----------
globalThis.process = { env: { DB_FILE: ':memory:', MAIL_TRANSPORT: 'json', DEMO: '1', TZ: 'Europe/Berlin' }, argv: [], on() {} }; // ohne versions.node, sonst hält sql.js den Browser für Node
globalThis.Buffer = {
  byteLength: (s) => new TextEncoder().encode(String(s)).length,
  concat: (chunks) => { const n = chunks.reduce((a, c) => a + c.length, 0); const u = new Uint8Array(n); let o = 0; for (const c of chunks) { u.set(c, o); o += c.length; } return { toString: () => new TextDecoder().decode(u) }; },
};

// ---------- Gespeicherter Stand (nur in diesem Browser) ----------
function loadSaved() {
  try { const b64 = localStorage.getItem(STORE); if (!b64) return null; const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; } catch { return null; }
}
let dirty = false;
function save() {
  if (!dirty) return; dirty = false;
  try { const u = globalThis.__wosDbWrap.exportBytes(); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); localStorage.setItem(STORE, btoa(s)); } catch (e) { console.warn('Speichern im Browser nicht möglich:', e.message); }
}

// ---------- Nachgebildete Websites für den Website-Check (der Browser darf fremde Seiten nicht abrufen) ----------
function hashOf(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
function demoSite(host) {
  const h = hashOf(host); const name = host.replace(/^www\./, '').split('.')[0].replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const has = (n) => h % n === 0;
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${name} – Startseite</title>
${has(5) ? '' : '<meta name="viewport" content="width=device-width, initial-scale=1">'}
${has(2) ? `<meta name="description" content="${name}: Ihr Partner in der Region. Beratung, Service und Qualität seit vielen Jahren – rufen Sie uns an oder schreiben Sie uns.">` : ''}
${has(3) ? '<link rel="stylesheet" href="/wp-content/themes/x/style.css">' : has(4) ? '<script src="https://assets.jimdo.com/x.js"></script>' : ''}
${has(4) ? '<script async src="https://www.googletagmanager.com/gtag/js?id=G-DEMO123"></script>' : ''}${has(7) ? '<script src="https://embed.tawk.to/x/default"></script>' : ''}
</head><body><h1>Willkommen bei ${name}</h1>${has(3) ? '<h1>Unsere Leistungen</h1>' : ''}
<img src="a.jpg" alt="Team"><img src="b.jpg"><img src="c.jpg"${has(2) ? ' alt="Werkstatt"' : ''}>
${has(2) ? '<a href="tel:+495932000000">05932 000000</a>' : '<p>Telefon 05932 000000</p>'} <a href="/impressum">Impressum</a>${has(3) ? '' : ' <a href="/datenschutz">Datenschutz</a>'}
${'<p>Inhalt</p>'.repeat(40)}</body></html>`;
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
function fakeExternal(u) {
  if (/googleapis\.com\/pagespeedonline/.test(u.href)) return json({ error: { message: 'In der Browser-Vorschau nicht verfügbar' } }, 503);
  if (/places\.googleapis\.com/.test(u.href)) return json({ error: { message: 'Google-Daten gibt es in der Browser-Vorschau nicht' } }, 503);
  if (u.protocol === 'http:') return new Response(null, { status: 301, headers: { location: u.href.replace(/^http:/, 'https:') } });
  if (/robots\.txt$/.test(u.pathname)) return new Response('User-agent: *\nAllow: /', { status: 200 });
  if (/sitemap/.test(u.pathname)) return new Response('', { status: hashOf(u.host) % 2 ? 200 : 404 });
  if (/^\/?$/.test(u.pathname) || /\.html?$/.test(u.pathname)) return new Response(demoSite(u.host), { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  return json({ ok: true });
}

// ---------- Brücke App ⇄ Server-Code ----------
const SERVER_RE = /\/(api\/.*|termin(\/.*)?|bericht\/.*|widget(\.js)?|kalender\.ics|go\/.*|l\/.*)$/;
function serverPath(href) {
  let u; try { u = new URL(href, location.href); } catch { return null; }
  if (u.origin !== location.origin && u.host !== 'os.web-hafen.de') return null;
  const m = u.pathname.match(SERVER_RE); return m ? '/' + m[1] + u.search : null;
}
let handle;
function callServer(path, init = {}) {
  return new Promise(async (resolve) => {
    let body = '';
    if (init.body != null) body = typeof init.body === 'string' ? init.body : await new Response(init.body).text();
    const method = (init.method || 'GET').toUpperCase();
    const headers = { 'user-agent': navigator.userAgent }; new Headers(init.headers || {}).forEach((v, k) => (headers[k] = v));
    const req = { url: path, method, headers, socket: { remoteAddress: '127.0.0.1' }, destroy() {},
      on(ev, cb) { if (ev === 'data' && body) queueMicrotask(() => cb(new TextEncoder().encode(body))); if (ev === 'end') queueMicrotask(() => queueMicrotask(cb)); } };
    let code = 200; const hdrs = {};
    const res = { headersSent: false, setHeader(k, v) { hdrs[k.toLowerCase()] = v; }, writeHead(s, h = {}) { code = s; for (const [k, v] of Object.entries(h)) hdrs[k.toLowerCase()] = String(v); this.headersSent = true; },
      end(b) { resolve({ status: code, headers: hdrs, body: b ?? '' }); } };
    if (method !== 'GET') { dirty = true; setTimeout(save, 1500); }
    handle(req, res);
  });
}
const realFetch = window.fetch.bind(window);
function appFetch(input, init) {
  const href = typeof input === 'string' ? input : input.url;
  const p = serverPath(href);
  if (p) return callServer(p, init).then((r) => new Response(r.status === 204 ? null : r.body, { status: r.status, headers: r.headers }));
  let u; try { u = new URL(href, location.href); } catch { return realFetch(input, init); }
  const cdn = /(^|\.)(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(u.hostname);
  if (u.origin === location.origin || cdn) return realFetch(input, init);
  return Promise.resolve(fakeExternal(u));
}

// ---------- Öffentliche Seiten (Buchung, Bericht, Widget) als Ebene über der App ----------
const BRIDGE = `<script>window.fetch=function(u,o){return parent.__wosFetch(u,o)};
document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a');if(!a)return;var h=a.getAttribute('href')||'';
if(parent.__wosIsServer(h)){e.preventDefault();parent.__wosOpen(h)}},true);<\/script><style>#showMap,#showMap+span{display:none!important}</style>`;
const inject = (html) => (/<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + BRIDGE) : BRIDGE + html);
const escH = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
async function renderInto(frame, href) {
  const r = await callServer(serverPath(href)); const type = r.headers['content-type'] || '';
  if (/html/.test(type)) { frame.srcdoc = inject(String(r.body)); return; }
  // Dateien (CSV, Kalender) zeigt die Browser-Version als Text – Downloads sind hier gesperrt
  frame.srcdoc = `<!doctype html><meta charset="utf-8"><body style="margin:0;font:13px/1.5 ui-monospace,Menlo,monospace;background:#fff;color:#0f172a"><p style="font-family:system-ui,sans-serif;background:#fef3c7;color:#78350f;margin:0;padding:10px 14px">Auf dem echten Server wird diese Datei heruntergeladen. In der Browser-Version siehst du hier ihren Inhalt.</p><pre style="padding:14px;white-space:pre-wrap;word-break:break-word">${escH(r.body)}</pre>`;
}
async function openPage(href) {
  const p = serverPath(href); if (!p) return;
  let ov = $('#wosPage');
  if (!ov) {
    ov = document.createElement('div'); ov.id = 'wosPage';
    ov.innerHTML = `<div class="wos-bar"><button id="wosBack" aria-label="Schließen">✕ Schließen</button><span id="wosUrl"></span></div><iframe id="wosFrame" title="Öffentliche Seite"></iframe>`;
    document.body.appendChild(ov);
    $('#wosBack').onclick = () => { ov.hidden = true; $('#wosFrame').srcdoc = ''; window.dispatchEvent(new HashChangeEvent('hashchange')); };
  }
  ov.hidden = false; $('#wosUrl').textContent = 'os.web-hafen.de' + p.replace(/\?vorschau=1/, '');
  await renderInto($('#wosFrame'), href);
}
window.__wosFetch = appFetch; window.__wosOpen = openPage; window.__wosIsServer = (h) => !!serverPath(h) && !/^#/.test(h);
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a'); if (!a) return;
  const h = a.getAttribute('href') || ''; if (/^#/.test(h) || !serverPath(h)) return;
  e.preventDefault(); openPage(h);
}, true);
// Eingebettete Vorschauen in der App (Bericht in der Akquise, Widget-Vorschau)
new MutationObserver(() => {
  document.querySelectorAll('iframe[src]').forEach((f) => { const src = f.getAttribute('src'); if (serverPath(src)) { f.removeAttribute('src'); renderInto(f, src); } });
  const bar = $('.demo-bar'); if (bar && !$('#wosReset')) {
    const a = document.createElement('a'); a.href = '#'; a.id = 'wosReset'; a.textContent = '↺ Demo zurücksetzen';
    a.onclick = (ev) => { ev.preventDefault(); try { localStorage.removeItem(STORE); } catch {} dirty = false; location.reload(); };
    bar.appendChild(a);
  }
}).observe(document.documentElement, { childList: true, subtree: true });
const saveNow = () => { dirty = true; save(); };
document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); }); window.addEventListener('pagehide', saveNow);
setInterval(saveNow, 60_000);

// ---------- Start ----------
try {
  status('Datenbank wird gestartet …');
  globalThis.__SQL = await window.initSqlJs();
  const saved = loadSaved(); if (saved) globalThis.__wosBytes = saved;
  globalThis.__wosFiles = { 'demo-audit.json': await (await realFetch('scripts/demo-audit.json')).text() };
  status('Webhafen OS wird geladen …');
  const server = await import('./server.js'); handle = server.handle;
  if (!server.db.prepare('SELECT COUNT(*) n FROM contacts').get().n) {
    const { seedDemo } = await import('./scripts/demo-seed.js');
    seedDemo(server.db, { baseUrl: 'https://os.web-hafen.de' }); dirty = true; save();
  }
  window.fetch = appFetch;
  server.start({}); // Planer: Automationen fortsetzen, Erinnerungen, Social-Beiträge
  await import('./app.js');
  $('#wosLoading')?.remove();
} catch (e) {
  console.error(e);
  status('Start fehlgeschlagen: ' + e.message);
}
