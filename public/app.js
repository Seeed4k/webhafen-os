// ===== Kern =====
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const e = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const eur = (n) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n || 0);
const num = (n) => new Intl.NumberFormat('de-DE').format(n || 0);
const dt = (s) => (s ? new Date(s.replace(' ', 'T')).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: s.length > 10 ? 'short' : undefined }) : '–');
const dOnly = (s) => (s ? new Date(s.slice(0, 10) + 'T12:00').toLocaleDateString('de-DE') : '–');
const J = (s, f = []) => { try { return typeof s === 'string' ? JSON.parse(s) : s ?? f; } catch { return f; } };
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const STATUS = { open: 'Offen', won: 'Gewonnen', lost: 'Verloren', abandoned: 'Aufgegeben' };
const POST_STATUS = { draft: 'Entwurf', scheduled: 'Geplant', published: 'Veröffentlicht', failed: 'Fehler', manual: 'Manuell posten', recurring: 'Wiederkehrend', evergreen: 'Evergreen' };
const SALE_STATUS = { pending: 'Ausstehend', approved: 'Freigegeben', paid: 'Ausgezahlt', refunded: 'Storniert' };
const PCOLOR = { facebook: '#1877f2', instagram: '#e1306c', linkedin: '#0a66c2', tiktok: '#111', youtube: '#ff0000', pinterest: '#e60023', threads: '#111', bluesky: '#1185fe', gbp: '#34a853', x: '#111', community: '#7c3aed' };
const PICON = { facebook: 'f', instagram: '◎', linkedin: 'in', tiktok: '♪', youtube: '▶', pinterest: 'P', threads: '@', bluesky: '🦋', gbp: 'G', x: '𝕏', community: '📣' };
let SETTINGS = {};

async function api(method, path, body) {
  const r = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401 && path !== '/api/login') { showLogin(); throw new Error('Bitte anmelden'); }
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error(data.error || `Fehler ${r.status}`);
  return data;
}
const GET = (p) => api('GET', p); const POST = (p, b = {}) => api('POST', p, b); const PUT = (p, b) => api('PUT', p, b); const DEL = (p) => api('DELETE', p);

function toast(msg, err = false) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), err ? 6000 : 2800);
}
const safe = (fn) => async (...a) => { try { await fn(...a); } catch (er) { toast(er.message, true); } };
const formData = (form) => {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') { if (el.dataset.multi) { (o[el.name] ||= []); if (el.checked) o[el.name].push(isNaN(el.value) ? el.value : Number(el.value)); } else o[el.name] = el.checked; }
    else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
    else o[el.name] = el.value;
  }
  return o;
};
function modal(title, html, onSubmit, { wide } = {}) {
  $('#modalTitle').textContent = title; $('#modalBody').innerHTML = html; $('#modal').hidden = false;
  $('.modal-box').style.width = wide ? 'min(1000px,100%)' : '';
  const f = $('#modalBody form');
  if (f && onSubmit) f.onsubmit = safe(async (ev) => { ev.preventDefault(); const r = await onSubmit(formData(f), f); if (r !== false) closeModal(); });
  return $('#modalBody');
}
const closeModal = () => { $('#modal').hidden = true; $('#modalBody').innerHTML = ''; };
$('#modal').addEventListener('click', (ev) => { if (ev.target.id === 'modal' || ev.target.closest('[data-close]')) closeModal(); });
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeModal(); });
const copy = (txt) => navigator.clipboard.writeText(txt).then(() => toast('In die Zwischenablage kopiert'), () => prompt('Kopieren:', txt));
const baseUrl = () => (SETTINGS.public_url || location.origin).replace(/\/$/, '');
const field = (label, name, val = '', type = 'text', extra = '') => `<label${type === 'textarea' ? ' class="full"' : ''}>${label}${type === 'textarea' ? `<textarea name="${name}" ${extra}>${e(val)}</textarea>` : `<input type="${type}" name="${name}" value="${e(val)}" ${extra}>`}</label>`;
const select = (label, name, opts, val, extra = '') => `<label>${label}<select name="${name}" ${extra}>${opts.map(([v, t]) => `<option value="${e(v)}" ${String(v) === String(val ?? '') ? 'selected' : ''}>${e(t)}</option>`).join('')}</select></label>`;
const empty = (icon, title, text, btn = '') => `<div class="card empty"><div class="big">${icon}</div><h3>${title}</h3><p>${text}</p>${btn}</div>`;
const badge = (k, map) => `<span class="badge ${e(k)}">${e(map[k] || k)}</span>`;

// ===== Router =====
const VIEWS = {};
const TABS = {
  leads: [['', 'Leads'], ['liste', 'Liste'], ['prognose', 'Prognose'], ['pipelines', 'Pipelines']],
  social: [['', 'Planer'], ['kalender', 'Kalender'], ['konten', 'Konten'], ['evergreen', 'Evergreen'], ['rss', 'RSS-Feeds'], ['csv', 'CSV-Import']],
  affiliate: [['', 'Dashboard'], ['kampagnen', 'Kampagnen'], ['partner', 'Affiliates'], ['provisionen', 'Provisionen']],
};
const TITLES = { dashboard: 'Übersicht', kontakte: 'Kontakte', leads: 'Leads', social: 'Social Planner', affiliate: 'Affiliate-Manager', links: 'Trigger-Links', audits: 'Akquise', einstellungen: 'Einstellungen' };
async function render() {
  const [sec = 'dashboard', sub = '', ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  $$('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.s === sec));
  $('#title').textContent = TITLES[sec] || '';
  $('#tabs').innerHTML = (TABS[sec] || []).map(([k, t]) => `<a href="#/${sec}${k ? '/' + k : ''}" class="${k === sub ? 'on' : ''}">${t}</a>`).join('');
  $('.side').classList.remove('open'); if (!$('#modal').hidden) closeModal();
  const v = $('#view'); v.innerHTML = '<p class="sub">Lädt …</p>';
  try { await (VIEWS[sec] || VIEWS.dashboard)(v, sub, rest); } catch (er) { v.innerHTML = `<div class="card bad">${e(er.message)}</div>`; }
}
window.addEventListener('hashchange', render);
$('#menu').onclick = () => $('.side').classList.toggle('open');

function showLogin() { $('#app').hidden = true; $('#login').hidden = false; }
$('#loginForm').onsubmit = async (ev) => {
  ev.preventDefault();
  try { await POST('/api/login', formData(ev.target)); location.reload(); } catch (er) { $('#loginErr').textContent = er.message; }
};
$('#logout').onclick = async () => { await POST('/api/logout'); location.reload(); };

(async function boot() {
  const s = await GET('/api/session');
  if (!s.loggedIn) return showLogin();
  $('#logout').hidden = !s.passwordSet;
  SETTINGS = await GET('/api/settings');
  if (SETTINGS.brand_color) document.documentElement.style.setProperty('--accent', SETTINGS.brand_color);
  $('#app').hidden = false; render();
})();

// ===== Übersicht =====
VIEWS.dashboard = async (v) => {
  const d = await GET('/api/dashboard');
  v.innerHTML = `
  ${!SETTINGS.agency_name ? `<div class="card mb" style="border-color:var(--accent)">👋 Willkommen! Trage zuerst unter <a href="#/einstellungen">Einstellungen</a> deine Agentur-Daten ein – sie erscheinen in den Website-Check-Berichten.</div>` : ''}
  <div class="grid g4">
    <div class="card kpi"><div class="l">Pipeline-Potenzial</div><div class="v">${eur(d.forecast.max_potential)}</div><div class="s">${d.forecast.open_count} offene Leads</div></div>
    <div class="card kpi"><div class="l">Erwartete Einnahmen</div><div class="v">${eur(d.forecast.expected)}</div><div class="s">gewichtet nach Wahrscheinlichkeit</div></div>
    <div class="card kpi"><div class="l">Gewonnen</div><div class="v good">${eur(d.forecast.won)}</div><div class="s">${d.contacts} Kontakte gesamt</div></div>
    <div class="card kpi"><div class="l">Geplante Beiträge</div><div class="v">${d.posts.scheduled || 0}</div><div class="s">${d.posts.published || 0} veröffentlicht · ${(d.posts.failed || 0) + (d.posts.manual || 0)} mit Handlungsbedarf</div></div>
  </div>
  <div class="grid g3 mt">
    <div class="card"><div class="row between mb"><h3>Neueste Leads</h3><a href="#/leads">Alle</a></div>
      ${d.recentOpps.length ? `<table>${d.recentOpps.map((o) => `<tr><td>${e(o.name)}<div class="small sub">${e(o.stage || '')}</div></td><td>${badge(o.status, STATUS)}</td><td class="num">${eur(o.value)}</td></tr>`).join('')}</table>` : '<p class="sub">Noch keine Leads.</p>'}</div>
    <div class="card"><div class="row between mb"><h3>Nächste Beiträge</h3><a href="#/social">Planer</a></div>
      ${d.upcoming.length ? d.upcoming.map((p) => `<div class="mb"><div class="small sub">${dt(p.scheduled_at)}</div>${e(p.content.slice(0, 90))}</div>`).join('') : '<p class="sub">Nichts geplant.</p>'}</div>
    <div class="card"><div class="row between mb"><h3>Letzte Website-Checks</h3><a href="#/audits">Alle</a></div>
      ${d.audits.length ? `<table>${d.audits.map((a) => `<tr><td><a href="#/audits/${a.id}">${e(a.business_name)}</a></td><td class="num ${a.score >= 80 ? 'good' : a.score >= 50 ? 'warn' : 'bad'}">${a.score}%</td></tr>`).join('')}</table>` : '<p class="sub">Noch keine Checks.</p>'}
      <div class="mt small sub">Affiliate-Umsatz: <b>${eur(d.affiliate.revenue)}</b> · offene Provisionen: <b>${eur(d.affiliate.owed)}</b></div></div>
  </div>`;
};

// ===== Kontakte =====
VIEWS.kontakte = async (v) => {
  const list = await GET('/api/contacts');
  const draw = (q = '') => {
    const rows = list.filter((c) => !q || JSON.stringify(c).toLowerCase().includes(q.toLowerCase()));
    $('#ct').innerHTML = rows.length ? `<table><tr><th>Name</th><th>Firma</th><th>E-Mail</th><th>Telefon</th><th>Tags</th><th></th></tr>${rows.map((c) => `<tr>
      <td><b>${e(c.name)}</b></td><td>${e(c.company)}</td><td>${c.email ? `<a href="mailto:${e(c.email)}">${e(c.email)}</a>` : ''}</td><td>${c.phone ? `<a href="tel:${e(c.phone)}">${e(c.phone)}</a>` : ''}</td>
      <td>${(c.tags || '').split(',').filter(Boolean).map((t) => `<span class="tag">${e(t.trim())}</span>`).join('')}</td>
      <td class="num"><button class="btn sm" data-edit="${c.id}">Bearbeiten</button></td></tr>`).join('')}</table>` : '<p class="sub">Keine Kontakte gefunden.</p>';
    $$('[data-edit]').forEach((b) => (b.onclick = () => contactModal(list.find((c) => c.id == b.dataset.edit))));
  };
  v.innerHTML = `<div class="row mb"><input id="q" placeholder="Kontakte durchsuchen …" style="max-width:320px"><span class="grow"></span>
    <button class="btn" id="imp">CSV importieren</button><button class="btn primary" id="add">+ Kontakt</button></div><div class="card tablewrap" id="ct"></div>`;
  draw(); $('#q').oninput = (ev) => draw(ev.target.value);
  $('#add').onclick = () => contactModal({});
  $('#imp').onclick = () => modal('Kontakte importieren', `<form><p class="sub">CSV mit Spalten <code>name</code> (oder vorname/nachname), <code>email</code>, <code>telefon</code>, <code>firma</code>, <code>tags</code>. Komma oder Semikolon als Trenner.</p>
    <label>CSV-Datei<input type="file" accept=".csv,text/csv" id="file"></label><div class="actions"><button class="btn primary">Importieren</button></div></form>`, async () => {
    const f = $('#file').files[0]; if (!f) throw new Error('Bitte Datei wählen');
    const r = await POST('/api/contacts/import', { csv: await f.text() }); toast(`${r.imported} Kontakte importiert`); render();
  });
};
function contactModal(c) {
  modal(c.id ? 'Kontakt bearbeiten' : 'Neuer Kontakt', `<form class="form">${field('Name *', 'name', c.name, 'text', 'required')}${field('Firma', 'company', c.company)}
    ${field('E-Mail', 'email', c.email, 'email')}${field('Telefon', 'phone', c.phone, 'tel')}${field('Tags (mit Komma getrennt)', 'tags', c.tags)}<span></span>${field('Notizen', 'notes', c.notes, 'textarea')}
    <div class="actions">${c.id ? '<button type="button" class="btn danger" id="del">Löschen</button><span class="grow"></span>' : ''}<button type="button" class="btn" data-close>Abbrechen</button><button class="btn primary">Speichern</button></div></form>`,
  async (d) => { await (c.id ? PUT('/api/contacts/' + c.id, d) : POST('/api/contacts', d)); toast('Gespeichert'); render(); });
  if (c.id) $('#del').onclick = safe(async () => { if (confirm('Kontakt löschen?')) { await DEL('/api/contacts/' + c.id); closeModal(); render(); } });
}

// ===== Leads =====
let PIPES = []; let CUR_PIPE = null;
async function loadPipes() {
  PIPES = await GET('/api/pipelines');
  const saved = Number(localStorageGet('pipe'));
  CUR_PIPE = PIPES.find((p) => p.id === saved) || PIPES[0] || null;
}
function localStorageGet(k) { try { return localStorage.getItem('wos_' + k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem('wos_' + k, v); } catch {} }
const pipeSelect = () => `<select id="pipeSel" style="width:auto;min-width:220px">${PIPES.map((p) => `<option value="${p.id}" ${p.id === CUR_PIPE?.id ? 'selected' : ''}>${e(p.name)}</option>`).join('')}</select>`;
const bindPipeSelect = () => { const s = $('#pipeSel'); if (s) s.onchange = () => { localStorageSet('pipe', s.value); render(); }; };

VIEWS.leads = async (v, sub) => {
  await loadPipes();
  if (sub === 'pipelines') return leadsPipelines(v);
  if (sub === 'prognose') return leadsForecast(v);
  if (!CUR_PIPE) { v.innerHTML = empty('🧭', 'Keine Pipeline', 'Lege zuerst eine Pipeline an.', '<a class="btn primary" href="#/leads/pipelines">Pipelines verwalten</a>'); return; }
  const q = sessionStorage.getItem('oppq') || '';
  const opps = await GET(`/api/opportunities?pipeline_id=${CUR_PIPE.id}${sub === 'liste' ? '' : '&status=open'}${q ? '&q=' + encodeURIComponent(q) : ''}`);
  v.innerHTML = `<div class="row mb">${pipeSelect()}<span class="badge open">${opps.length} Leads</span><input id="oq" placeholder="Leads suchen …" value="${e(q)}" style="max-width:260px">
    <span class="grow"></span><button class="btn" id="imp">⤓ Import</button><button class="btn primary" id="add">+ Lead hinzufügen</button></div><div id="board"></div>`;
  bindPipeSelect();
  $('#oq').onchange = (ev) => { sessionStorage.setItem('oppq', ev.target.value); render(); };
  $('#add').onclick = () => oppModal({ pipeline_id: CUR_PIPE.id });
  $('#imp').onclick = () => modal('Leads importieren', `<form><p class="sub">CSV-Spalten: <code>name</code>, <code>kontakt</code>, <code>email</code>, <code>telefon</code>, <code>firma</code>, <code>wert</code>, <code>phase</code>, <code>quelle</code>, <code>abschluss</code> (YYYY-MM-DD), <code>tags</code>.</p>
    <label>CSV-Datei<input type="file" id="file" accept=".csv"></label><div class="actions"><button class="btn primary">Importieren</button></div></form>`, async () => {
    const f = $('#file').files[0]; if (!f) throw new Error('Bitte Datei wählen');
    const r = await POST('/api/opportunities/import', { pipeline_id: CUR_PIPE.id, csv: await f.text() }); toast(`${r.imported} Leads importiert`); render();
  });
  const board = $('#board');
  if (!opps.length && !q && sub !== 'liste') {
    board.innerHTML = kanbanHtml([]) + empty('🐱', 'Noch keine Leads', 'Füge einen Lead hinzu, um Deals in dieser Pipeline zu verfolgen, oder importiere vorhandene Daten.', '<button class="btn primary" onclick="document.getElementById(\'add\').click()">+ Lead hinzufügen</button>');
    return;
  }
  if (sub === 'liste') return leadsList(board, opps);
  board.innerHTML = kanbanHtml(opps); bindKanban(opps);
};
function kanbanHtml(opps) {
  return `<div class="kanban">${CUR_PIPE.stages.map((s) => { const g = opps.filter((o) => o.stage_id === s.id);
    return `<div class="col" data-stage="${s.id}"><div class="col-head" style="--c:${e(s.color)}"><b>${e(s.name)}</b><span>${g.length} Leads · ${eur(g.reduce((a, o) => a + (o.value || 0), 0))} · ${s.probability}%</span></div>
    <div class="col-body">${g.map((o) => `<div class="opp" draggable="true" data-id="${o.id}"><b>${e(o.name)}</b><div class="small sub">${e(o.contact_name || o.company || '')}</div>
      ${(o.tags || '').split(',').filter(Boolean).map((t) => `<span class="tag">${e(t.trim())}</span>`).join('')}
      <div class="meta"><span>${eur(o.value)}</span><span class="${o.close_date && o.close_date < new Date().toISOString().slice(0, 10) ? 'bad' : ''}">${o.close_date ? '📅 ' + dOnly(o.close_date) : ''}</span></div></div>`).join('')}</div></div>`; }).join('')}</div>`;
}
function bindKanban(opps) {
  $$('.opp').forEach((c) => {
    c.ondragstart = (ev) => ev.dataTransfer.setData('text/plain', c.dataset.id);
    c.onclick = () => oppModal(opps.find((o) => o.id == c.dataset.id));
  });
  $$('.col').forEach((col) => {
    col.ondragover = (ev) => { ev.preventDefault(); col.classList.add('drop'); };
    col.ondragleave = () => col.classList.remove('drop');
    col.ondrop = safe(async (ev) => { ev.preventDefault(); col.classList.remove('drop');
      await PUT('/api/opportunities/' + ev.dataTransfer.getData('text/plain'), { stage_id: Number(col.dataset.stage) }); render(); });
  });
}
function leadsList(board, opps) {
  const stageName = (id) => CUR_PIPE.stages.find((s) => s.id === id)?.name || '–';
  board.innerHTML = `<div class="card tablewrap"><div class="row mb" id="bulk" hidden><b id="selN"></b>
    <select id="bAct" style="width:auto"><option value="">Massenaktion …</option><option value="status:won">Status → Gewonnen</option><option value="status:lost">Status → Verloren</option><option value="status:abandoned">Status → Aufgegeben</option><option value="status:open">Status → Offen</option>
    ${CUR_PIPE.stages.map((s) => `<option value="stage:${s.id}">Phase → ${e(s.name)}</option>`).join('')}<option value="tag">Tag hinzufügen …</option><option value="delete">Löschen</option></select><button class="btn sm primary" id="bGo">Ausführen</button></div>
    <table><tr><th><input type="checkbox" id="all"></th><th>Name</th><th>Kontakt</th><th>Phase</th><th>Status</th><th class="num">Wert</th><th>Abschluss</th><th>Quelle</th></tr>
    ${opps.map((o) => `<tr><td><input type="checkbox" class="sel" value="${o.id}"></td><td><a href="#" data-open="${o.id}">${e(o.name)}</a></td><td>${e(o.contact_name || '')}</td><td>${e(stageName(o.stage_id))}</td>
    <td>${badge(o.status, STATUS)}</td><td class="num">${eur(o.value)}</td><td>${dOnly(o.close_date)}</td><td>${e(o.source)}</td></tr>`).join('')}</table></div>`;
  const upd = () => { const n = $$('.sel:checked').length; $('#bulk').hidden = !n; $('#selN').textContent = `${n} ausgewählt`; };
  $$('.sel').forEach((c) => (c.onchange = upd)); $('#all').onchange = (ev) => { $$('.sel').forEach((c) => (c.checked = ev.target.checked)); upd(); };
  $$('[data-open]').forEach((a) => (a.onclick = (ev) => { ev.preventDefault(); oppModal(opps.find((o) => o.id == a.dataset.open)); }));
  $('#bGo').onclick = safe(async () => {
    const [action, value] = $('#bAct').value.split(':'); if (!action) return;
    const ids = $$('.sel:checked').map((c) => c.value);
    let val = value; if (action === 'tag') { val = prompt('Tag:'); if (!val) return; }
    if (action === 'delete' && !confirm(`${ids.length} Leads löschen?`)) return;
    await POST('/api/opportunities/bulk', { ids, action, value: val }); toast('Erledigt'); render();
  });
}
async function oppModal(o) {
  const contacts = await GET('/api/contacts');
  const pipe = PIPES.find((p) => p.id == o.pipeline_id) || CUR_PIPE;
  const stageOpts = (p) => p.stages.map((s) => [s.id, `${s.name} (${s.probability}%)`]);
  const body = modal(o.id ? 'Lead bearbeiten' : 'Neuen Lead hinzufügen', `<form class="form">
    <h3>Kontaktdetails</h3>
    ${select('Primärer Ansprechpartner', 'contact_id', [['', '— Neuer Kontakt —'], ...contacts.map((c) => [c.id, c.name + (c.company ? ` (${c.company})` : '')])], o.contact_id)}
    <span></span>
    <div id="newC" class="full form" style="padding:0">${field('Name des Ansprechpartners', 'contact_name', '')}${field('E-Mail', 'contact_email', '', 'email')}${field('Telefon', 'contact_phone', '', 'tel')}</div>
    <h3>Details zum Lead</h3>
    <div class="full">${field('Name des Leads *', 'name', o.name, 'text', 'required placeholder="z. B. Website-Relaunch Fahrschule Muster"')}</div>
    ${select('Pipeline', 'pipeline_id', PIPES.map((p) => [p.id, p.name]), pipe.id, 'id="pSel"')}
    ${select('Phase', 'stage_id', stageOpts(pipe), o.stage_id, 'id="sSel"')}
    ${select('Status', 'status', Object.entries(STATUS), o.status || 'open')}
    ${field('Wert (€)', 'value', o.value ?? '', 'number', 'step="0.01" min="0" placeholder="0,00"')}
    ${pipe.use_opp_probability ? field('Wahrscheinlichkeit (%)', 'probability', o.probability ?? '', 'number', 'min="0" max="100"') : ''}
    ${field('Verantwortlich', 'owner', o.owner, 'text', 'placeholder="Nicht zugewiesen"')}
    ${field('Follower', 'followers', o.followers)}
    ${field('Firmenname', 'company', o.company)}
    ${field('Quelle', 'source', o.source, 'text', 'placeholder="z. B. Empfehlung, Website, Audit"')}
    ${field('Erwartetes Abschlussdatum', 'close_date', o.close_date || '', 'date')}
    ${field('Tags (mit Komma getrennt)', 'tags', o.tags)}
    ${field('Notizen', 'notes', o.notes, 'textarea')}
    ${o.slip_count ? `<p class="full small warn">⚠ Abschlussdatum wurde ${o.slip_count}× verschoben (insgesamt ${o.slip_days} Tage).</p>` : ''}
    <div class="actions">${o.id ? '<button type="button" class="btn danger" id="del">Löschen</button><span class="grow"></span>' : ''}<button type="button" class="btn" data-close>Abbrechen</button><button class="btn primary">${o.id ? 'Speichern' : 'Erstellen'}</button></div></form>`,
  async (d) => {
    if (!d.contact_id) delete d.contact_id; else { delete d.contact_name; }
    d.pipeline_id = Number(d.pipeline_id); d.stage_id = Number(d.stage_id); d.value = d.value === '' ? 0 : Number(d.value);
    await (o.id ? PUT('/api/opportunities/' + o.id, d) : POST('/api/opportunities', d)); toast('Gespeichert'); render();
  });
  const cs = $('[name=contact_id]', body); const toggle = () => ($('#newC').hidden = !!cs.value); cs.onchange = toggle; toggle();
  $('#pSel').onchange = (ev) => { const p = PIPES.find((x) => x.id == ev.target.value); $('#sSel').innerHTML = stageOpts(p).map(([v, t]) => `<option value="${v}">${e(t)}</option>`).join(''); };
  if (o.id) $('#del').onclick = safe(async () => { if (confirm('Lead löschen?')) { await DEL('/api/opportunities/' + o.id); closeModal(); render(); } });
}

async function leadsForecast(v) {
  const pid = localStorageGet('fpipe') || '';
  const f = await GET('/api/forecast' + (pid ? '?pipeline_id=' + pid : ''));
  const group = localStorageGet('fgroup') || 'status';
  const rows = group === 'stage' && pid ? f.byStage : f.byStatus.map((r) => ({ ...r, key: STATUS[r.key] }));
  const max = Math.max(1, ...rows.map((r) => r.max_potential));
  const tab = localStorageGet('ftab') || 'summary';
  v.innerHTML = `<div class="row mb"><select id="fp" style="width:auto"><option value="">Alle Pipelines</option>${PIPES.map((p) => `<option value="${p.id}" ${p.id == pid ? 'selected' : ''}>${e(p.name)}</option>`).join('')}</select>
    <div class="tabs"><a href="#" data-ft="summary" class="${tab === 'summary' ? 'on' : ''}">📊 Zusammenfassung</a><a href="#" data-ft="timeline" class="${tab === 'timeline' ? 'on' : ''}">📅 Prognose-Zeitachse</a></div></div>
  <div class="grid g4">
    <div class="card kpi"><div class="l">Maximale potenzielle Einnahmen</div><div class="v">${eur(f.totals.max_potential)}</div><div class="s">wenn alle offenen Leads gewonnen werden</div></div>
    <div class="card kpi"><div class="l">Erwartete Einnahmen</div><div class="v" style="color:var(--accent)">${eur(f.totals.expected)}</div><div class="s">Wert × Wahrscheinlichkeit der Phase</div></div>
    <div class="card kpi"><div class="l">Gewonnene Einnahmen</div><div class="v good">${eur(f.totals.won)}</div><div class="s">Summe der gewonnenen Leads</div></div>
    <div class="card kpi"><div class="l">Offene Leads</div><div class="v">${f.totals.open_count}</div><div class="s">aktuell offen</div></div>
  </div>
  ${tab === 'timeline' ? `<div class="card mt"><h3>Erwartete Einnahmen nach Abschlussmonat</h3>${f.timeline.length ? (() => { const m = Math.max(1, ...f.timeline.map((t) => t.max_potential || t.won || 0));
    return `<div class="legend mt"><span><i style="background:var(--accent)"></i>Erwartet</span><span><i style="background:var(--good)"></i>Gewonnen</span></div><div class="vbars">${f.timeline.map((t) => `<div style="height:${((t.expected || 0) / m) * 100}%" data-t="${t.month}: ${eur(t.expected)} erwartet"></div><div style="height:${((t.won || 0) / m) * 100}%;background:var(--good)" data-t="${t.month}: ${eur(t.won)} gewonnen"></div>`).join('')}</div>
    <div class="xlabels">${f.timeline.map((t) => `<span style="flex:2">${new Date(t.month + '-15').toLocaleDateString('de-DE', { month: 'short', year: '2-digit' })}</span>`).join('')}</div>`; })() : '<p class="sub mt">Noch keine Leads mit Abschlussdatum.</p>'}</div>` : `
  <div class="grid g2 mt">
    <div class="card"><div class="row between"><h3>Gefährdete Leads</h3><span class="badge open">${f.risk.high.count + f.risk.medium.count + f.risk.low.count} Leads · ${eur(f.risk.high.value + f.risk.medium.value + f.risk.low.value)}</span></div>
      <p class="sub small">Leads, deren erwartetes Abschlussdatum nach hinten verschoben wurde.</p>
      ${[['high', 'Hohes Risiko', '2× oder öfter bzw. 14+ Tage verschoben', 'var(--bad)'], ['medium', 'Mittleres Risiko', '7+ Tage verschoben', 'var(--warn)'], ['low', 'Geringes Risiko', 'einmal kurz verschoben', '#eab308']]
        .map(([k, t, d, c]) => `<div class="risk" style="--c:${c}"><div><b>${t}</b><div class="small sub">${d}</div>${f.risk[k].items.slice(0, 4).map((i) => `<span class="tag">${e(i.name)}</span>`).join('')}</div><b>${f.risk[k].count} (${eur(f.risk[k].value)})</b></div>`).join('')}</div>
    <div class="card"><h3>Prognosedaten verbessern</h3><p class="sub small">Die Datenqualität bestimmt die Genauigkeit der Prognose.</p>
      ${[['missing_close_date', '📅 Fehlendes Abschlussdatum', 'Wird in der Zeitachse nicht berücksichtigt.'], ['missing_value', '💶 Fehlender Wert', 'Trägt 0 € zu den Summen bei.'], ['overdue', '⏰ Überfällige Leads', 'Abschlussdatum liegt in der Vergangenheit – Prognose evtl. zu hoch.']]
        .map(([k, t, d]) => `<div class="risk" style="--c:var(--line)"><div><b>${t}</b><div class="small sub">${d}</div></div><b>${f.quality[k]}</b></div>`).join('')}</div>
  </div>
  <div class="card mt"><div class="row between mb"><h3>Leads nach ${group === 'stage' && pid ? 'Phase' : 'Status'}</h3>
    <label class="row">Gruppieren nach <select id="fg" style="width:auto"><option value="status">Status</option><option value="stage" ${group === 'stage' ? 'selected' : ''} ${pid ? '' : 'disabled'}>Phase${pid ? '' : ' (Pipeline wählen)'}</option></select></label></div>
    <div class="legend mb"><span><i style="background:var(--good)"></i>Gewonnen</span><span><i style="background:var(--accent)"></i>Erwartet</span><span><i style="background:#cbd5e1"></i>Max. Potenzial</span></div>
    <div class="hbar">${rows.map((r) => `<span>${e(r.key)}</span><div class="track"><i style="width:${(r.max_potential / max) * 100}%;background:#cbd5e1"></i><i style="width:${((r.expected || 0) / max) * 100}%;background:var(--accent)"></i><i style="width:${(r.won / max) * 100}%;background:var(--good)"></i></div>`).join('')}</div>
    <div class="tablewrap mt"><table><tr><th>${group === 'stage' && pid ? 'Phase' : 'Status'}</th><th class="num">Leads</th><th class="num">Max. Potenzial</th><th class="num">Erwartet</th><th class="num">Gewonnen</th></tr>
    ${rows.map((r) => `<tr><td>${e(r.key)}</td><td class="num">${r.count}</td><td class="num">${eur(r.max_potential)}</td><td class="num" style="color:var(--accent)">${r.expected == null ? '–' : eur(r.expected)}</td><td class="num good">${eur(r.won)}</td></tr>`).join('')}
    <tr><th>Gesamt</th><th class="num">${rows.reduce((a, r) => a + r.count, 0)}</th><th class="num">${eur(rows.reduce((a, r) => a + r.max_potential, 0))}</th><th class="num">${eur(rows.reduce((a, r) => a + (r.expected || 0), 0))}</th><th class="num">${eur(rows.reduce((a, r) => a + r.won, 0))}</th></tr></table></div></div>`}`;
  $('#fp').onchange = (ev) => { localStorageSet('fpipe', ev.target.value); render(); };
  $('#fg') && ($('#fg').onchange = (ev) => { localStorageSet('fgroup', ev.target.value); render(); });
  $$('[data-ft]').forEach((a) => (a.onclick = (ev) => { ev.preventDefault(); localStorageSet('ftab', a.dataset.ft); render(); }));
}

function leadsPipelines(v) {
  v.innerHTML = `<div class="row mb"><span class="grow"></span><button class="btn primary" id="add">+ Pipeline erstellen</button></div>
    <div class="card tablewrap"><table><tr><th>Name</th><th>Phasen</th><th></th></tr>${PIPES.map((p) => `<tr><td><b>${e(p.name)}</b></td>
    <td>${p.stages.map((s) => `<span class="tag">${e(s.name)} · ${s.probability}%</span>`).join('')}</td><td class="num"><button class="btn sm" data-edit="${p.id}">Bearbeiten</button></td></tr>`).join('')}</table></div>`;
  $('#add').onclick = () => pipelineModal({ name: '', stages: [{ name: 'Neuer Lead', probability: 20 }, { name: 'Kontaktiert', probability: 40 }, { name: 'Angebot gesendet', probability: 60 }, { name: 'Abgeschlossen', probability: 80 }] });
  $$('[data-edit]').forEach((b) => (b.onclick = () => pipelineModal(PIPES.find((p) => p.id == b.dataset.edit))));
}
function pipelineModal(p) {
  let stages = p.stages.map((s) => ({ ...s }));
  const body = modal(p.id ? 'Pipeline bearbeiten' : 'Pipeline erstellen', `<form>
    ${field('Pipeline-Name *', 'name', p.name, 'text', 'required placeholder="z. B. Webdesign-Anfragen"')}<p class="small sub">Ein eindeutiger, beschreibender Name, damit du die Pipeline später wiederfindest.</p>
    <div class="card mt"><label class="check"><input type="checkbox" name="use_opp_probability" ${p.use_opp_probability ? 'checked' : ''}> Wahrscheinlichkeit pro Lead festlegen</label>
    <p class="small sub" style="margin:4px 0 0">Aktiv: jeder Lead hat eine eigene Wahrscheinlichkeit. Inaktiv: es gilt die Wahrscheinlichkeit der Phase.</p></div>
    <div class="row between mt"><h3>Pipeline-Phasen (<span id="sc"></span>)</h3><button type="button" class="btn sm" id="addS">+ Phase hinzufügen</button></div>
    <table class="mt"><tr><th>Name der Phase</th><th>Farbe</th><th>Wahrscheinlichkeit</th><th></th></tr><tbody id="st"></tbody></table>
    <div class="actions">${p.id ? '<button type="button" class="btn danger" id="del">Pipeline löschen</button><span class="grow"></span>' : ''}<button type="button" class="btn" data-close>Abbrechen</button><button class="btn primary">${p.id ? 'Speichern' : 'Erstellen'}</button></div></form>`,
  async (d) => {
    readStages(); if (!stages.length) throw new Error('Mindestens eine Phase');
    const payload = { name: d.name, use_opp_probability: d.use_opp_probability, stages };
    await (p.id ? PUT('/api/pipelines/' + p.id, payload) : POST('/api/pipelines', payload)); toast('Pipeline gespeichert'); render();
  });
  const readStages = () => { stages = $$('#st tr').map((tr, i) => ({ ...stages[i], name: $('[data-n]', tr).value, color: $('[data-c]', tr).value, probability: Number($('[data-p]', tr).value) })); };
  const draw = () => {
    $('#sc').textContent = stages.length;
    $('#st').innerHTML = stages.map((s, i) => `<tr><td><input data-n value="${e(s.name)}" required></td><td><input type="color" data-c value="${e(s.color || '#3b82f6')}" style="width:44px;padding:2px"></td>
      <td><input type="number" data-p min="0" max="100" value="${s.probability}" style="width:80px"> %</td>
      <td class="num"><button type="button" class="btn sm" data-up="${i}" ${i ? '' : 'disabled'}>↑</button> <button type="button" class="btn sm danger" data-rm="${i}">🗑</button></td></tr>`).join('');
    $$('[data-rm]', body).forEach((b) => (b.onclick = () => { readStages(); stages.splice(b.dataset.rm, 1); draw(); }));
    $$('[data-up]', body).forEach((b) => (b.onclick = () => { readStages(); const i = Number(b.dataset.up); [stages[i - 1], stages[i]] = [stages[i], stages[i - 1]]; draw(); }));
  };
  draw();
  $('#addS').onclick = () => { readStages(); stages.push({ name: '', probability: 50 }); draw(); };
  if (p.id) $('#del').onclick = safe(async () => { if (confirm('Pipeline samt allen Leads löschen?')) { await DEL('/api/pipelines/' + p.id); closeModal(); render(); } });
}

// ===== Social Planner =====
let ACCOUNTS = []; let CATS = [];
const accIcon = (p, size = 46) => `<span class="pi" style="background:${PCOLOR[p] || '#64748b'};width:${size}px;height:${size}px;display:inline-grid;place-items:center;border-radius:${size / 4}px;color:#fff;font-weight:700">${PICON[p] || '•'}</span>`;
const accChecks = (sel = []) => ACCOUNTS.length ? `<div class="choices">${ACCOUNTS.map((a) => `<label><input type="checkbox" data-multi="1" name="account_ids" value="${a.id}" ${sel.includes(a.id) ? 'checked' : ''}>${accIcon(a.platform, 22)} ${e(a.name)}</label>`).join('')}</div>` : '<p class="sub">Noch keine Konten – <a href="#/social/konten">Konto verbinden</a>.</p>';
const dayChecks = (name, sel = []) => `<div class="days">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<label><input type="checkbox" data-multi="1" name="${name}" value="${d}" ${sel.includes(d) ? 'checked' : ''}>${WD[d]}</label>`).join('')}</div>`;

VIEWS.social = async (v, sub) => {
  [ACCOUNTS, CATS] = await Promise.all([GET('/api/social/accounts'), GET('/api/social/categories')]);
  if (sub === 'konten' || (!ACCOUNTS.length && !sub)) return socialAccounts(v);
  if (sub === 'kalender') return socialCalendar(v);
  if (sub === 'evergreen') return socialEvergreen(v);
  if (sub === 'rss') return socialRss(v);
  if (sub === 'csv') return socialCsv(v);
  const filter = sessionStorage.getItem('pf') || '';
  const posts = await GET('/api/social/posts' + (filter ? '?status=' + filter : ''));
  v.innerHTML = `<div class="row mb"><select id="pf" style="width:auto"><option value="">Alle Beiträge</option>${Object.entries(POST_STATUS).map(([k, t]) => `<option value="${k}" ${k === filter ? 'selected' : ''}>${t}</option>`).join('')}</select>
    <span class="grow"></span><button class="btn primary" id="new">+ Beitrag erstellen</button></div>
    ${posts.length ? posts.map(postCard).join('') : empty('📝', 'Noch keine Beiträge', 'Erstelle einen Beitrag und veröffentliche ihn auf mehreren Plattformen gleichzeitig.')}`;
  $('#pf').onchange = (ev) => { sessionStorage.setItem('pf', ev.target.value); render(); };
  $('#new').onclick = () => postModal({});
  bindPostCards(posts);
};
function postCard(p) {
  const ids = J(p.account_ids); const r = J(p.recurrence, null);
  const when = p.status === 'recurring' && r ? `🔁 ${r.days.map((d) => WD[d]).join(', ')} um ${r.time}` : p.status === 'evergreen' ? `♻️ ${e(CATS.find((c) => c.id === p.category_id)?.name || 'Kategorie')}` : p.scheduled_at ? '🕒 ' + dt(p.scheduled_at) : '';
  return `<div class="post"><div>${p.media_url ? `<img src="${e(p.media_url)}" alt="" style="max-height:90px;border-radius:8px;float:right;margin-left:10px">` : ''}<p>${e(p.content)}</p>
    <div class="row small">${badge(p.status, POST_STATUS)}<span class="sub">${when}</span>${ACCOUNTS.filter((a) => ids.includes(a.id)).map((a) => accIcon(a.platform, 20)).join('')}<span class="sub">${e(p.source)}${p.publish_count ? ` · ${p.publish_count}× veröffentlicht` : ''}</span></div>
    ${p.last_error ? `<div class="small bad mt">${e(p.last_error)}</div>` : ''}</div>
    <div class="row" style="align-items:flex-start"><button class="btn sm" data-pub="${p.id}">Jetzt posten</button><button class="btn sm" data-log="${p.id}">Protokoll</button><button class="btn sm" data-ed="${p.id}">Bearbeiten</button></div></div>`;
}
function bindPostCards(posts) {
  $$('[data-ed]').forEach((b) => (b.onclick = () => postModal(posts.find((p) => p.id == b.dataset.ed))));
  $$('[data-pub]').forEach((b) => (b.onclick = safe(async () => { b.disabled = true; const r = await POST(`/api/social/posts/${b.dataset.pub}/publish`); toast(r.errors.length ? r.errors.join(', ') : 'Veröffentlicht', !!r.errors.length); render(); })));
  $$('[data-log]').forEach((b) => (b.onclick = safe(async () => {
    const log = await GET(`/api/social/posts/${b.dataset.log}/log`);
    modal('Veröffentlichungs-Protokoll', log.length ? `<table>${log.map((l) => `<tr><td>${dt(l.created_at)}</td><td>${e(l.account_name || '–')}</td><td class="${l.ok ? 'good' : 'bad'}">${e(l.message)}</td></tr>`).join('')}</table>` : '<p class="sub">Noch nicht veröffentlicht.</p>');
  })));
}
function postModal(p) {
  const r = J(p.recurrence, null) || { days: [], time: '09:00' };
  const mode = p.status === 'recurring' ? 'recurring' : p.status === 'evergreen' ? 'evergreen' : p.status === 'scheduled' || p.scheduled_at ? 'scheduled' : p.id ? 'draft' : 'scheduled';
  const body = modal(p.id ? 'Beitrag bearbeiten' : 'Beitrag erstellen', `<form class="form">
    <div class="full"><b>Veröffentlichen auf</b>${accChecks(J(p.account_ids))}</div>
    <label class="full">Text<textarea name="content" required rows="6" id="ctext">${e(p.content)}</textarea><span class="small sub" id="cc"></span></label>
    ${field('Bild-/Video-URL', 'media_url', p.media_url, 'url', 'placeholder="https://…"')}${field('Link', 'link', p.link, 'url', 'placeholder="https://…"')}
    <div class="full"><b>Wann?</b><div class="choices mt">${[['draft', '📝 Entwurf'], ['scheduled', '🕒 Einmalig planen'], ['recurring', '🔁 Wiederkehrend'], ['evergreen', '♻️ Evergreen-Warteschlange']]
      .map(([k, t]) => `<label><input type="radio" name="mode" value="${k}" ${k === mode ? 'checked' : ''}>${t}</label>`).join('')}</div></div>
    <div class="full" data-m="scheduled">${field('Datum & Uhrzeit', 'scheduled_at', (p.scheduled_at || '').replace(' ', 'T'), 'datetime-local')}</div>
    <div class="full" data-m="recurring"><b>Wochentage</b>${dayChecks('rdays', r.days)}<label class="mt" style="max-width:200px">Uhrzeit<input type="time" name="rtime" value="${e(r.time)}"></label></div>
    <div class="full" data-m="evergreen">${CATS.length ? select('Kategorie', 'category_id', CATS.map((c) => [c.id, c.name]), p.category_id) + '<p class="small sub">Die Kategorie bestimmt Zeitplan und Konten. Beiträge werden reihum immer wieder gepostet.</p>' : '<p class="sub">Lege zuerst unter <a href="#/social/evergreen">Evergreen</a> eine Kategorie an.</p>'}</div>
    <div class="actions">${p.id ? '<button type="button" class="btn danger" id="del">Löschen</button><span class="grow"></span>' : ''}<button type="button" class="btn" data-close>Abbrechen</button><button class="btn primary">Speichern</button></div></form>`,
  async (d) => {
    const out = { content: d.content, media_url: d.media_url, link: d.link, account_ids: d.account_ids || [], status: d.mode, scheduled_at: null, recurrence: null, category_id: null };
    if (d.mode === 'scheduled') { if (!d.scheduled_at) throw new Error('Bitte Datum wählen'); out.scheduled_at = d.scheduled_at; }
    if (d.mode === 'recurring') { if (!d.rdays?.length) throw new Error('Bitte Wochentage wählen'); out.recurrence = { days: d.rdays, time: d.rtime || '09:00' }; }
    if (d.mode === 'evergreen') { if (!d.category_id) throw new Error('Bitte Kategorie wählen'); out.category_id = Number(d.category_id); }
    if (d.mode !== 'evergreen' && d.mode !== 'draft' && !out.account_ids.length) throw new Error('Bitte mindestens ein Konto wählen');
    await (p.id ? PUT('/api/social/posts/' + p.id, out) : POST('/api/social/posts', out)); toast('Beitrag gespeichert'); render();
  });
  const sw = () => { const m = $('[name=mode]:checked', body)?.value; $$('[data-m]', body).forEach((el) => (el.hidden = el.dataset.m !== m)); };
  $$('[name=mode]', body).forEach((r) => (r.onchange = sw)); sw();
  const cc = () => { const n = $('#ctext').value.length; $('#cc').textContent = `${n} Zeichen${n > 300 ? ' · Bluesky/Threads: max. 300/500' : ''}${n > 2200 ? ' · Instagram: max. 2.200' : ''}`; };
  $('#ctext').oninput = cc; cc();
  if (p.id) $('#del').onclick = safe(async () => { if (confirm('Beitrag löschen?')) { await DEL('/api/social/posts/' + p.id); closeModal(); render(); } });
}
function socialAccounts(v) {
  const big = ['facebook', 'instagram', 'linkedin', 'tiktok', 'youtube']; const more = ['pinterest', 'threads', 'bluesky', 'gbp', 'x', 'community'];
  const tile = (k) => `<div class="plat">${accIcon(k)}<div><b>${e(SETTINGS.platforms[k])}</b></div><div class="small sub">${ACCOUNTS.filter((a) => a.platform === k).length || ''}</div><button class="btn sm mt" data-plat="${k}">+ Verbinden</button></div>`;
  v.innerHTML = `<div class="card mb" style="text-align:center"><h2>Poste in wenigen Minuten auf allen Plattformen</h2><p class="sub">Einmal schreiben, automatisch auf Facebook, Instagram, LinkedIn, TikTok und weiteren Netzwerken veröffentlichen.</p></div>
  ${ACCOUNTS.length ? `<div class="card mb tablewrap"><h3 class="mb">Verbundene Konten</h3><table>${ACCOUNTS.map((a) => `<tr><td>${accIcon(a.platform, 26)}</td><td><b>${e(a.name)}</b><div class="small sub">${e(SETTINGS.platforms[a.platform])}</div></td>
    <td class="small">${a.platform === 'bluesky' && a.handle && a.has_secret ? '✅ Direkt per Bluesky-API' : a.webhook_url ? '✅ Über Webhook' : '<span class="warn">⚠ Manuell (kein Webhook)</span>'}</td><td class="num"><button class="btn sm" data-acc="${a.id}">Bearbeiten</button></td></tr>`).join('')}</table></div>` : ''}
  <h3 class="sub small mb">GROSSE NETZWERKE</h3><div class="platforms">${big.map(tile).join('')}</div>
  <h3 class="sub small mb mt">AUCH VERFÜGBAR</h3><div class="platforms">${more.map(tile).join('')}</div>
  <div class="card mt"><h3>So funktioniert die Veröffentlichung</h3><p class="sub">Facebook, Instagram, LinkedIn, TikTok & Co. erlauben automatisches Posten nur über freigeschaltete Entwickler-Apps. Damit du sofort loslegen kannst, übergibt Webhafen OS jeden fälligen Beitrag an einen <b>Webhook</b> – z. B. ein Szenario in <b>Make</b>, <b>Zapier</b> oder <b>n8n</b>, das dort mit deinem Konto verbunden ist und postet. <b>Bluesky</b> wird direkt angebunden (Handle + App-Passwort). Ohne Webhook erinnert dich Webhafen OS, den Beitrag manuell zu posten.</p>
  <div class="code">POST &lt;deine Webhook-URL&gt;
{ "platform": "instagram", "account": "Webhafen", "post_id": 12, "content": "…", "media_url": "https://…", "link": "https://…", "sent_at": "…" }</div></div>`;
  $$('[data-plat]').forEach((b) => (b.onclick = () => accountModal({ platform: b.dataset.plat })));
  $$('[data-acc]').forEach((b) => (b.onclick = () => accountModal(ACCOUNTS.find((a) => a.id == b.dataset.acc))));
}
function accountModal(a) {
  const bsky = a.platform === 'bluesky';
  modal(`${SETTINGS.platforms[a.platform]}-Konto ${a.id ? 'bearbeiten' : 'verbinden'}`, `<form class="form">
    ${field('Anzeigename *', 'name', a.name, 'text', 'required placeholder="z. B. Webhafen Instagram"')}<input type="hidden" name="platform" value="${e(a.platform)}"><span></span>
    ${bsky ? `${field('Bluesky-Handle', 'handle', a.handle, 'text', 'placeholder="name.bsky.social"')}${field('App-Passwort', 'secret', '', 'password', `placeholder="${a.has_secret ? '•••••• (gespeichert)' : 'xxxx-xxxx-xxxx-xxxx'}"`)}
      <p class="full small sub">App-Passwort erstellen: Bluesky → Einstellungen → Datenschutz und Sicherheit → App-Passwörter.</p>` : ''}
    <div class="full">${field(bsky ? 'Webhook-URL (optional, statt API)' : 'Webhook-URL (Make / Zapier / n8n)', 'webhook_url', a.webhook_url, 'url', 'placeholder="https://hook.eu1.make.com/…"')}
    <p class="small sub">Leer lassen = Beiträge werden zur fälligen Zeit als „Manuell posten“ markiert.</p></div>
    <div class="actions">${a.id ? '<button type="button" class="btn" id="test">Testbeitrag senden</button><button type="button" class="btn danger" id="del">Trennen</button><span class="grow"></span>' : ''}<button type="button" class="btn" data-close>Abbrechen</button><button class="btn primary">Speichern</button></div></form>`,
  async (d) => { await (a.id ? PUT('/api/social/accounts/' + a.id, d) : POST('/api/social/accounts', d)); toast('Konto gespeichert'); render(); });
  if (a.id) {
    $('#del').onclick = safe(async () => { if (confirm('Konto trennen?')) { await DEL('/api/social/accounts/' + a.id); closeModal(); render(); } });
    $('#test').onclick = safe(async () => {
      const p = await POST('/api/social/posts', { content: 'Testbeitrag aus Webhafen OS ✅', account_ids: [a.id], status: 'draft' });
      const r = await POST(`/api/social/posts/${p.id}/publish`); toast(r.errors.length ? r.errors.join(', ') : 'Test erfolgreich: ' + r.status, !!r.errors.length);
    });
  }
}
async function socialCalendar(v) {
  const posts = await GET('/api/social/posts');
  const off = Number(sessionStorage.getItem('calOff') || 0);
  const base = new Date(); base.setDate(1); base.setMonth(base.getMonth() + off);
  const start = new Date(base); start.setDate(1 - ((base.getDay() + 6) % 7));
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = iso(new Date());
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i); const k = iso(d);
    const evs = posts.filter((p) => (p.scheduled_at || '').startsWith(k) || (p.status === 'published' && !p.scheduled_at && (p.published_at || '').startsWith(k)));
    const rec = posts.filter((p) => p.status === 'recurring' && J(p.recurrence, { days: [] }).days.includes(d.getDay()));
    const evg = CATS.filter((c) => c.active && J(c.days).includes(d.getDay()));
    cells.push(`<div class="${d.getMonth() !== base.getMonth() ? 'other' : ''} ${k === today ? 'today' : ''}"><span class="d">${d.getDate()}</span>
      ${evs.map((p) => `<span class="ev" data-ed="${p.id}" title="${e(p.content)}">${(p.scheduled_at || '').slice(11) || '✓'} ${e(p.content.slice(0, 40))}</span>`).join('')}
      ${rec.map((p) => `<span class="ev" data-ed="${p.id}" style="background:#ede9fe">🔁 ${J(p.recurrence).time} ${e(p.content.slice(0, 30))}</span>`).join('')}
      ${evg.map((c) => `<span class="ev" style="background:#dcfce7">♻️ ${c.time} ${e(c.name)}</span>`).join('')}</div>`);
  }
  v.innerHTML = `<div class="row mb"><button class="btn" id="prev">‹</button><h2 style="min-width:200px;text-align:center">${base.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</h2><button class="btn" id="next">›</button><button class="btn" id="tod">Heute</button><span class="grow"></span><button class="btn primary" id="new">+ Beitrag</button></div>
    <div class="cal">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d) => `<div class="dh">${d}</div>`).join('')}${cells.join('')}</div>`;
  const go = (n) => { sessionStorage.setItem('calOff', n); render(); };
  $('#prev').onclick = () => go(off - 1); $('#next').onclick = () => go(off + 1); $('#tod').onclick = () => go(0);
  $('#new').onclick = () => postModal({});
  $$('[data-ed]').forEach((b) => (b.onclick = () => postModal(posts.find((p) => p.id == b.dataset.ed))));
}
async function socialEvergreen(v) {
  v.innerHTML = `<div class="row mb"><p class="sub grow" style="margin:0">Evergreen-Kategorien veröffentlichen ihre Beiträge reihum nach festem Zeitplan – immer der Beitrag, der am längsten nicht gepostet wurde. So bleibt dein Feed aktiv, ohne dass du ständig neue Inhalte brauchst.</p><button class="btn primary" id="add">+ Kategorie</button></div>
  ${CATS.length ? `<div class="grid g3">${CATS.map((c) => `<div class="card"><div class="row between"><h3>♻️ ${e(c.name)}</h3>${c.active ? '<span class="badge published">aktiv</span>' : '<span class="badge">pausiert</span>'}</div>
    <p class="sub">${J(c.days).map((d) => WD[d]).join(', ') || 'keine Tage'} um ${e(c.time)} · ${c.post_count} Beiträge</p><div class="row">${ACCOUNTS.filter((a) => J(c.account_ids).includes(a.id)).map((a) => accIcon(a.platform, 22)).join('')}</div>
    <div class="row mt"><button class="btn sm" data-cat="${c.id}">Bearbeiten</button><a class="btn sm" href="#/social" onclick="sessionStorage.setItem('pf','evergreen')">Beiträge</a></div></div>`).join('')}</div>` : empty('♻️', 'Noch keine Kategorien', 'Lege z. B. „Tipps“, „Referenzen“ oder „Team“ an.')}`;
  const catModal = (c) => modal(c.id ? 'Kategorie bearbeiten' : 'Neue Kategorie', `<form class="form">${field('Name *', 'name', c.name, 'text', 'required')}<label>Uhrzeit<input type="time" name="time" value="${e(c.time || '09:00')}"></label>
    <div class="full"><b>Wochentage</b>${dayChecks('days', J(c.days))}</div><div class="full"><b>Konten</b>${accChecks(J(c.account_ids))}</div>
    <label class="check full"><input type="checkbox" name="active" ${c.active !== 0 ? 'checked' : ''}> aktiv</label>
    <div class="actions">${c.id ? '<button type="button" class="btn danger" id="del">Löschen</button><span class="grow"></span>' : ''}<button class="btn primary">Speichern</button></div></form>`,
  async (d) => { d.active = d.active ? 1 : 0; d.days ||= []; d.account_ids ||= []; await (c.id ? PUT('/api/social/categories/' + c.id, d) : POST('/api/social/categories', d)); render(); });
  $('#add').onclick = () => catModal({});
  $$('[data-cat]').forEach((b) => (b.onclick = () => { catModal(CATS.find((c) => c.id == b.dataset.cat)); const c = CATS.find((x) => x.id == b.dataset.cat);
    $('#del').onclick = safe(async () => { if (confirm('Kategorie löschen?')) { await DEL('/api/social/categories/' + c.id); closeModal(); render(); } }); }));
}
async function socialRss(v) {
  const feeds = await GET('/api/social/feeds');
  v.innerHTML = `<div class="row mb"><p class="sub grow" style="margin:0">Neue Artikel aus RSS-Feeds (z. B. deinem Blog) werden automatisch zu Beiträgen – als Entwurf zur Freigabe oder direkt veröffentlicht. Abruf alle 30 Minuten.</p><button class="btn primary" id="add">+ Feed</button></div>
  ${feeds.length ? `<div class="card tablewrap"><table><tr><th>Feed</th><th>Modus</th><th>Zuletzt geprüft</th><th></th></tr>${feeds.map((f) => `<tr><td><b>${e(f.name || f.url)}</b><div class="small sub">${e(f.url)}</div>${f.last_error ? `<div class="small bad">${e(f.last_error)}</div>` : ''}</td>
    <td>${f.mode === 'auto' ? 'Automatisch posten' : 'Als Entwurf'}</td><td>${dt(f.last_checked)}</td><td class="num"><button class="btn sm" data-chk="${f.id}">Jetzt prüfen</button> <button class="btn sm" data-fe="${f.id}">Bearbeiten</button></td></tr>`).join('')}</table></div>` : empty('📰', 'Noch keine Feeds', 'Füge die RSS-Adresse deines Blogs hinzu, z. B. https://web-hafen.de/feed/')}`;
  const feedModal = (f) => { modal(f.id ? 'Feed bearbeiten' : 'RSS-Feed hinzufügen', `<form class="form">${field('Name', 'name', f.name)}${field('Feed-URL *', 'url', f.url, 'url', 'required')}
    ${select('Modus', 'mode', [['draft', 'Als Entwurf anlegen (Freigabe nötig)'], ['auto', 'Automatisch veröffentlichen']], f.mode)}<span></span>
    <label class="full">Vorlage<textarea name="template" rows="3">${e(f.template || '{title}\n\n{link}')}</textarea><span class="small sub">Platzhalter: {title}, {link}, {summary}</span></label>
    <div class="full"><b>Konten</b>${accChecks(J(f.account_ids))}</div><p class="full small sub">Beim ersten Abruf werden vorhandene Artikel nur gemerkt – gepostet werden ab dann neue.</p>
    <div class="actions">${f.id ? '<button type="button" class="btn danger" id="del">Löschen</button><span class="grow"></span>' : ''}<button class="btn primary">Speichern</button></div></form>`,
  async (d) => { d.account_ids ||= []; await (f.id ? PUT('/api/social/feeds/' + f.id, d) : POST('/api/social/feeds', d)); render(); });
    if (f.id) $('#del').onclick = safe(async () => { await DEL('/api/social/feeds/' + f.id); closeModal(); render(); }); };
  $('#add').onclick = () => feedModal({});
  $$('[data-fe]').forEach((b) => (b.onclick = () => feedModal(feeds.find((f) => f.id == b.dataset.fe))));
  $$('[data-chk]').forEach((b) => (b.onclick = safe(async () => { b.disabled = true; const r = await POST(`/api/social/feeds/${b.dataset.chk}/check`);
    toast(r.error ? r.error : r.firstRun ? `${r.items} Artikel gemerkt – neue werden ab jetzt übernommen` : `${r.created} neue Beiträge`, !!r.error); render(); })));
}
function socialCsv(v) {
  v.innerHTML = `<div class="grid g2"><div class="card"><h3>Massenplanung per CSV</h3><p class="sub">Plane dutzende Beiträge auf einmal. Spalten:</p>
    <div class="code">text;datum;bild;link;konten
"Neuer Blogartikel: 5 Tipps für Ihre Website";10.11.2026 09:00;https://…/bild.jpg;https://web-hafen.de/blog;instagram|facebook
"Wir suchen Verstärkung!";2026-11-12 14:30;;;linkedin</div>
    <p class="small sub">Datum als <code>TT.MM.JJJJ HH:MM</code> oder <code>JJJJ-MM-TT HH:MM</code>. Ohne Datum → Entwurf. <code>konten</code>: Kontoname oder Plattform, mehrere mit <code>|</code>. Fehlt die Spalte, gelten die rechts gewählten Konten.</p>
    <button class="btn sm" id="tpl">Vorlage herunterladen</button></div>
    <div class="card"><form id="csvf"><label>CSV-Datei<input type="file" id="file" accept=".csv"></label><div class="mt"><b>Standard-Konten</b>${accChecks()}</div><button class="btn primary mt">Importieren</button></form><div id="res" class="mt"></div></div></div>`;
  $('#tpl').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿text;datum;bild;link;konten\r\n"Beispielbeitrag";' + new Date(Date.now() + 864e5).toLocaleDateString('de-DE') + ' 09:00;;;\r\n'], { type: 'text/csv' })); a.download = 'beitraege-vorlage.csv'; a.click(); };
  $('#csvf').onsubmit = safe(async (ev) => { ev.preventDefault(); const f = $('#file').files[0]; if (!f) throw new Error('Bitte Datei wählen');
    const r = await POST('/api/social/import', { csv: await f.text(), account_ids: formData(ev.target).account_ids || [] });
    $('#res').innerHTML = `<p class="good">✅ ${r.imported} Beiträge importiert.</p>${r.errors.map((x) => `<p class="small bad">${e(x)}</p>`).join('')}<a href="#/social/kalender">Im Kalender ansehen →</a>`; });
}

// ===== Affiliate-Manager =====
VIEWS.affiliate = async (v, sub) => {
  const camps = await GET('/api/aff/campaigns');
  if (sub === 'kampagnen') return affCampaigns(v, camps);
  if (sub === 'partner') return affPartners(v, camps);
  if (sub === 'provisionen') return affSales(v, camps);
  const to = sessionStorage.getItem('afTo') || new Date().toISOString().slice(0, 10);
  const from = sessionStorage.getItem('afFrom') || new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const cid = sessionStorage.getItem('afC') || '';
  const d = await GET(`/api/aff/dashboard?from=${from}&to=${to}${cid ? '&campaign_id=' + cid : ''}`);
  const days = []; for (let t = new Date(from + 'T12:00'); t <= new Date(to + 'T12:00'); t.setDate(t.getDate() + 1)) days.push(t.toISOString().slice(0, 10));
  const max = Math.max(1, ...d.daily.map((x) => x.revenue));
  v.innerHTML = `<div class="row mb"><div><h2>Dashboard</h2><p class="sub" style="margin:2px 0 0">Überblick über Kampagnen-Einnahmen und Affiliate-Provisionen.</p></div><span class="grow"></span><button class="btn primary" id="add">+ Kampagne</button></div>
  <div class="row mb"><input type="date" id="from" value="${from}" style="width:auto">→<input type="date" id="to" value="${to}" style="width:auto"><span class="grow"></span>
    <select id="camp" style="width:auto;min-width:220px"><option value="">Alle Kampagnen</option>${camps.map((c) => `<option value="${c.id}" ${c.id == cid ? 'selected' : ''}>${e(c.name)}</option>`).join('')}</select></div>
  <div class="grid g3"><div class="card kpi"><div class="l">💶 Generierte Einnahmen</div><div class="v">${eur(d.revenue)}</div><div class="s">${d.sales} Verkäufe</div></div>
    <div class="card kpi"><div class="l">📈 Konversion</div><div class="v">${String(d.conversion).replace('.', ',')} %</div><div class="s">${num(d.clicks)} Klicks auf Affiliate-Links</div></div>
    <div class="card kpi"><div class="l">👥 Kunden insgesamt</div><div class="v">${d.customers}</div><div class="s">${d.affiliates} Affiliates · ${d.refunded} storniert</div></div></div>
  <div class="grid g2 mt"><div class="card"><h3>Umsatz pro Tag</h3>${d.daily.length ? `<div class="vbars">${days.map((k) => { const x = d.daily.find((y) => y.day === k); return `<div style="height:${((x?.revenue || 0) / max) * 100}%" data-t="${dOnly(k)}: ${eur(x?.revenue)}"></div>`; }).join('')}</div>
    <div class="xlabels"><span>${dOnly(from)}</span><span style="text-align:right">${dOnly(to)}</span></div>` : '<div class="empty">🔍<br>Keine Daten im Zeitraum</div>'}</div>
    <div class="card"><h3 class="mb">Top-Affiliates</h3>${d.top.length ? `<table>${d.top.map((t, i) => `<tr><td>${i + 1}.</td><td>${e(t.name)}</td><td class="num">${t.sales}</td><td class="num"><b>${eur(t.revenue)}</b></td></tr>`).join('')}</table>` : '<p class="sub">Keine Aufzeichnungen gefunden.</p>'}</div></div>
  <div class="grid g2 mt"><div class="card kpi"><div class="l">Geschuldet</div><div class="v warn">${eur(d.owed)}</div><div class="l mt">Ausgezahlt</div><div class="v good">${eur(d.paid)}</div></div>
    <div class="card kpi"><div class="l">Ausstehende Provisionen (zu prüfen)</div><div class="v">${d.pending_count}</div><div class="l mt">Freigegeben, noch nicht ausgezahlt</div><div class="v">${d.approved_count}</div><a href="#/affiliate/provisionen">Provisionen bearbeiten →</a></div></div>`;
  const set = () => { sessionStorage.setItem('afFrom', $('#from').value); sessionStorage.setItem('afTo', $('#to').value); sessionStorage.setItem('afC', $('#camp').value); render(); };
  $('#from').onchange = set; $('#to').onchange = set; $('#camp').onchange = set;
  $('#add').onclick = () => campaignModal({});
};
function campaignModal(c) {
  let step = 0;
  const body = modal(c.id ? 'Kampagne bearbeiten' : 'Kampagne erstellen', `<div class="steps"><span>1 · Kampagnen-Info</span><span>2 · Provision festlegen</span><span>3 · Affiliates zuweisen</span></div><form class="form">
    <div class="full form" data-step="0" style="padding:0">${field('Kampagnenname *', 'name', c.name || 'Kampagne ' + new Date().toLocaleDateString('de-DE'), 'text', 'required')}<span></span>
      <div class="full"><b>Wohin sollen die Affiliate-Links führen?</b><p class="small sub" style="margin:2px 0 8px">Ziel, auf das der Traffic deiner Affiliates geleitet wird.</p><div class="choices">
      ${[['funnel', '🔻 Funnel'], ['website', '🌐 Website'], ['shop', '🛍 Shop'], ['extern', '↗ Externe Seite'], ['formular', '📋 Formular'], ['umfrage', '📝 Umfrage'], ['kalender', '📅 Kalender']].map(([k, t]) => `<label><input type="radio" name="target_type" value="${k}" ${(c.target_type || 'extern') === k ? 'checked' : ''}>${t}</label>`).join('')}</div></div>
      <div class="full">${field('Ziel-URL *', 'target_url', c.target_url, 'url', 'required placeholder="https://web-hafen.de/angebot"')}<p class="small sub">An die URL wird <code>?ref=CODE</code> angehängt, damit deine Seite den Affiliate erkennt.</p></div></div>
    <div class="full form" data-step="1" style="padding:0">${select('Provisionsart', 'commission_type', [['percent', 'Prozent vom Umsatz'], ['fixed', 'Fester Betrag pro Verkauf']], c.commission_type)}
      ${field('Provision (% oder €)', 'commission_value', c.commission_value ?? 10, 'number', 'step="0.01" min="0"')}${field('Cookie-Laufzeit (Tage)', 'cookie_days', c.cookie_days ?? 30, 'number', 'min="1"')}
      <label class="check"><input type="checkbox" name="active" ${c.active !== 0 ? 'checked' : ''}> Kampagne aktiv</label></div>
    <div class="full" data-step="2"><p class="sub">Nach dem Speichern kannst du unter <b>Affiliates</b> Partner anlegen und dieser Kampagne zuweisen. Jeder Partner erhält einen eigenen Tracking-Link.</p></div>
    <div class="actions"><button type="button" class="btn" id="prev">Zurück</button><span class="grow"></span><button type="button" class="btn primary" id="next">Weiter</button><button class="btn primary" id="save">Speichern</button></div></form>`,
  async (d) => { d.active = d.active ? 1 : 0; await (c.id ? PUT('/api/aff/campaigns/' + c.id, d) : POST('/api/aff/campaigns', d)); toast('Kampagne gespeichert'); location.hash = '#/affiliate/partner'; render(); });
  const show = () => { $$('[data-step]', body).forEach((el) => (el.hidden = Number(el.dataset.step) !== step)); $$('.steps span', body).forEach((s, i) => s.classList.toggle('on', i === step));
    $('#prev').disabled = !step; $('#next').hidden = step === 2; $('#save').hidden = step !== 2; };
  $('#next').onclick = () => { const inputs = $$(`[data-step="${step}"] input`, body); if (inputs.every((i) => i.reportValidity())) { step++; show(); } };
  $('#prev').onclick = () => { step--; show(); }; show();
}
function affCampaigns(v, camps) {
  v.innerHTML = `<div class="row mb"><span class="grow"></span><button class="btn primary" id="add">+ Kampagne</button></div>
  ${camps.length ? `<div class="card tablewrap"><table><tr><th>Kampagne</th><th>Ziel</th><th>Provision</th><th class="num">Affiliates</th><th class="num">Umsatz</th><th></th></tr>${camps.map((c) => `<tr><td><b>${e(c.name)}</b> ${c.active ? '' : '<span class="badge">pausiert</span>'}</td>
    <td class="small"><a href="${e(c.target_url)}" target="_blank" rel="noopener">${e(c.target_url)}</a></td><td>${c.commission_type === 'fixed' ? eur(c.commission_value) : c.commission_value + ' %'}</td>
    <td class="num">${c.affiliate_count}</td><td class="num">${eur(c.revenue)}</td><td class="num"><button class="btn sm" data-ed="${c.id}">Bearbeiten</button> <button class="btn sm danger" data-del="${c.id}">🗑</button></td></tr>`).join('')}</table></div>` : empty('🤝', 'Noch keine Kampagnen', 'Lege eine Kampagne an, um Partner für Empfehlungen zu belohnen.')}`;
  $('#add').onclick = () => campaignModal({});
  $$('[data-ed]').forEach((b) => (b.onclick = () => campaignModal(camps.find((c) => c.id == b.dataset.ed))));
  $$('[data-del]').forEach((b) => (b.onclick = safe(async () => { if (confirm('Kampagne mit allen Affiliates löschen?')) { await DEL('/api/aff/campaigns/' + b.dataset.del); render(); } })));
}
async function affPartners(v, camps) {
  const list = await GET('/api/aff/affiliates');
  v.innerHTML = `<div class="row mb"><span class="grow"></span><button class="btn primary" id="add" ${camps.length ? '' : 'disabled'}>+ Affiliate</button></div>
  ${list.length ? `<div class="card tablewrap"><table><tr><th>Affiliate</th><th>Kampagne</th><th>Tracking-Link</th><th class="num">Klicks</th><th class="num">Verkäufe</th><th class="num">Umsatz</th><th class="num">Offen</th><th></th></tr>${list.map((a) => `<tr>
    <td><b>${e(a.name)}</b><div class="small sub">${e(a.email)}</div></td><td>${e(a.campaign_name)}</td><td><button class="btn sm" data-copy="${e(baseUrl() + '/go/' + a.code)}">📋 /go/${e(a.code)}</button></td>
    <td class="num">${a.clicks}</td><td class="num">${a.sales}</td><td class="num">${eur(a.revenue)}</td><td class="num warn">${eur(a.owed)}</td>
    <td class="num"><button class="btn sm" data-sale="${a.id}">+ Verkauf</button> <button class="btn sm" data-ed="${a.id}">Bearbeiten</button></td></tr>`).join('')}</table></div>` : empty('🧑‍🤝‍🧑', 'Noch keine Affiliates', camps.length ? 'Lege Partner an – jeder bekommt einen eigenen Link.' : 'Lege zuerst eine Kampagne an.')}`;
  const am = (a) => { modal(a.id ? 'Affiliate bearbeiten' : 'Neuer Affiliate', `<form class="form">${field('Name *', 'name', a.name, 'text', 'required')}${field('E-Mail', 'email', a.email, 'email')}
    ${select('Kampagne', 'campaign_id', camps.map((c) => [c.id, c.name]), a.campaign_id)}${field('Code (für den Link)', 'code', a.code, 'text', 'placeholder="automatisch"')}
    <label class="check"><input type="checkbox" name="active" ${a.active !== 0 ? 'checked' : ''}> aktiv</label>
    <div class="actions">${a.id ? '<button type="button" class="btn danger" id="del">Löschen</button><span class="grow"></span>' : ''}<button class="btn primary">Speichern</button></div></form>`,
  async (d) => { d.active = d.active ? 1 : 0; if (!d.code) delete d.code; await (a.id ? PUT('/api/aff/affiliates/' + a.id, { ...d, id: a.id }) : POST('/api/aff/affiliates', d)); render(); });
    if (a.id) $('#del').onclick = safe(async () => { if (confirm('Löschen?')) { await DEL('/api/aff/affiliates/' + a.id); closeModal(); render(); } }); };
  $('#add').onclick = () => am({});
  $$('[data-ed]').forEach((b) => (b.onclick = () => am(list.find((a) => a.id == b.dataset.ed))));
  $$('[data-copy]').forEach((b) => (b.onclick = () => copy(b.dataset.copy)));
  $$('[data-sale]').forEach((b) => (b.onclick = () => saleModal(b.dataset.sale)));
}
function saleModal(affiliate_id) {
  modal('Verkauf erfassen', `<form class="form">${field('Umsatz (€) *', 'amount', '', 'number', 'required step="0.01" min="0"')}${field('Kunde', 'customer_name')}${field('E-Mail des Kunden', 'customer_email', '', 'email')}${field('Notiz', 'note')}
    <div class="actions"><button class="btn primary">Erfassen</button></div></form>`, async (d) => { const s = await POST('/api/aff/sales', { ...d, affiliate_id }); toast(`Provision: ${eur(s.commission)}`); render(); });
}
async function affSales(v) {
  const st = sessionStorage.getItem('sst') || '';
  const list = await GET('/api/aff/sales' + (st ? '?status=' + st : ''));
  v.innerHTML = `<div class="row mb"><input id="sq" placeholder="Kunden nach Name oder E-Mail suchen" style="max-width:300px"><select id="sst" style="width:auto"><option value="">Status: Alle</option>${Object.entries(SALE_STATUS).map(([k, t]) => `<option value="${k}" ${k === st ? 'selected' : ''}>${t}</option>`).join('')}</select>
    <span class="grow"></span><a class="btn" href="/api/aff/sales.csv">⤓ Umsatz als CSV</a></div>
    <div class="card tablewrap" id="tbl"></div>`;
  const draw = (q = '') => { const rows = list.filter((s) => !q || `${s.customer_name} ${s.customer_email}`.toLowerCase().includes(q.toLowerCase()));
    $('#tbl').innerHTML = rows.length ? `<table><tr><th>Status</th><th class="num">Provision</th><th class="num">Umsatz</th><th>Erstellt</th><th>Kunde</th><th>Affiliate</th><th>Kampagne</th><th></th></tr>${rows.map((s) => `<tr><td>${badge(s.status, SALE_STATUS)}</td>
    <td class="num"><b>${eur(s.commission)}</b></td><td class="num">${eur(s.amount)}</td><td>${dt(s.created_at)}</td><td>${e(s.customer_name)}<div class="small sub">${e(s.customer_email)}</div></td><td>${e(s.affiliate_name)}</td><td>${e(s.campaign_name)}</td>
    <td class="num"><select data-st="${s.id}" style="width:auto">${Object.entries(SALE_STATUS).map(([k, t]) => `<option value="${k}" ${k === s.status ? 'selected' : ''}>${t}</option>`).join('')}</select></td></tr>`).join('')}</table>` : '<div class="empty">Keine Aufzeichnungen gefunden.</div>';
    $$('[data-st]').forEach((s) => (s.onchange = safe(async () => { await PUT('/api/aff/sales/' + s.dataset.st, { status: s.value }); toast('Status geändert'); }))); };
  draw(); $('#sq').oninput = (ev) => draw(ev.target.value);
  $('#sst').onchange = (ev) => { sessionStorage.setItem('sst', ev.target.value); render(); };
}

// ===== Trigger-Links =====
VIEWS.links = async (v) => {
  const list = await GET('/api/links');
  v.innerHTML = `<div class="row mb"><p class="sub grow" style="margin:0">Kurzlinks mit Klickzählung – ideal für E-Mails, Flyer, QR-Codes und Social-Media-Bios.</p><button class="btn primary" id="add">+ Link</button></div>
  ${list.length ? `<div class="card tablewrap"><table><tr><th>Name</th><th>Kurzlink</th><th>Ziel</th><th class="num">Klicks (7 Tage)</th><th class="num">Klicks gesamt</th><th></th></tr>${list.map((l) => `<tr><td><b>${e(l.name)}</b>${l.tag ? `<span class="tag">${e(l.tag)}</span>` : ''}</td>
    <td><button class="btn sm" data-copy="${e(baseUrl() + '/l/' + l.slug)}">📋 /l/${e(l.slug)}</button></td><td class="small"><a href="${e(l.target_url)}" target="_blank" rel="noopener">${e(l.target_url.slice(0, 60))}</a></td>
    <td class="num">${l.clicks_7d}</td><td class="num"><b>${l.clicks}</b></td><td class="num"><button class="btn sm" data-qr="${e(baseUrl() + '/l/' + l.slug)}">QR</button> <button class="btn sm" data-ed="${l.id}">Bearbeiten</button></td></tr>`).join('')}</table></div>` : empty('🔗', 'Noch keine Trigger-Links', 'Erstelle einen Kurzlink und sieh, wie oft er geklickt wird.')}`;
  const lm = (l) => { modal(l.id ? 'Link bearbeiten' : 'Neuer Trigger-Link', `<form class="form">${field('Name *', 'name', l.name, 'text', 'required')}${field('Kurzlink (Slug)', 'slug', l.slug, 'text', 'placeholder="automatisch aus dem Namen"')}
    <div class="full">${field('Ziel-URL *', 'target_url', l.target_url, 'url', 'required')}</div>${field('Tag', 'tag', l.tag)}
    <div class="actions">${l.id ? '<button type="button" class="btn danger" id="del">Löschen</button><span class="grow"></span>' : ''}<button class="btn primary">Speichern</button></div></form>`,
  async (d) => { if (!d.slug) delete d.slug; await (l.id ? PUT('/api/links/' + l.id, { ...d, id: l.id }) : POST('/api/links', d)); render(); });
    if (l.id) $('#del').onclick = safe(async () => { await DEL('/api/links/' + l.id); closeModal(); render(); }); };
  $('#add').onclick = () => lm({});
  $$('[data-ed]').forEach((b) => (b.onclick = () => lm(list.find((l) => l.id == b.dataset.ed))));
  $$('[data-copy]').forEach((b) => (b.onclick = () => copy(b.dataset.copy)));
  $$('[data-qr]').forEach((b) => (b.onclick = () => modal('QR-Code', `<div style="text-align:center"><p class="sub">${e(b.dataset.qr)}</p><p class="small sub">Den QR-Code erzeugst du mit einem Generator deiner Wahl aus dieser Adresse – jeder Scan wird hier als Klick gezählt.</p><button class="btn primary" id="cp">Adresse kopieren</button></div>`) && ($('#cp').onclick = () => copy(b.dataset.qr))));
};

// ===== Website-Check & Interessenten (Prospecting) =====
const SRC = { manuell: 'Manuell', 'lead-finder': 'Lead-Finder', agent: 'Prospect-Agent', widget: 'Widget' };
const PSTATUS = { neu: 'Neu', 'geprüft': 'Geprüft', 'im CRM': 'Im CRM', kontaktiert: 'Kontaktiert', ignoriert: 'Ignoriert' };
const tone = (s) => (s == null ? '' : s >= 80 ? 'good' : s >= 50 ? 'warn' : 'bad');
const LEVEL = { hoch: { t: 'Hoch', c: '#16a34a', b: 'won' }, mittel: { t: 'Mittel', c: '#d97706', b: 'manual' }, niedrig: { t: 'Niedrig', c: '#dc2626', b: 'lost' } };
const levelOf = (s) => (s >= 60 ? 'hoch' : s >= 35 ? 'mittel' : 'niedrig');
const potPill = (pot, loading) => (loading ? '<span class="spin" title="Website wird geprüft …"></span>'
  : `<span class="pot ${LEVEL[pot.level].b}" title="${e(pot.why.join(', ') || 'gut aufgestellt')}"><b>${pot.score}%</b> ${LEVEL[pot.level].t}</span>`);
const potBadge = (p, why) => (p == null ? '<span class="sub">–</span>' : potPill({ score: p, level: levelOf(p), why: J(why, []) }, false));
// Online-Präsenz: Google-Profil + Website (mit erkanntem System)
function presence(p, pending = true) {
  const s = typeof p.site === 'string' ? J(p.site, null) : p.site;
  const g = p.place_id ? `<span class="pres ok" title="Google-Unternehmensprofil vorhanden">G<i>✓</i></span>` : `<span class="pres" title="Google-Profil unbekannt">G</span>`;
  if (!p.website) return g + '<span class="pres no" title="Keine Website">🌐<i>✕</i></span>';
  if (!s) return g + (pending ? '<span class="spin sm" title="Website wird geprüft …"></span>' : '<span class="pres" title="Website noch nicht schnell geprüft">🌐</span>');
  if (!s.reachable) return g + `<span class="pres no" title="Website nicht erreichbar: ${e(s.error || s.status)}">🌐<i>✕</i></span>`;
  const issues = [!s.https && 'kein https', !s.viewport && 'nicht mobiloptimiert', s.builder && 'Baukasten', !s.analytics && 'kein Tracking'].filter(Boolean);
  const sys = s.cms?.[0] || ''; const label = sys === 'WordPress' ? 'W' : sys ? sys.slice(0, 2) : '🌐';
  return g + `<span class="pres ${issues.length > 1 ? 'warn' : 'ok'}" title="${e([sys || 'System unbekannt', ...issues].join(' · '))}">${e(label)}<i>${issues.length > 1 ? '!' : '✓'}</i></span>`;
}
const FINDER_COLS = [{ key: 'potential', label: 'Lead-Bewertung', sort: 'potential', num: true }, { key: 'presence', label: 'Online-Präsenz' }, { key: 'google', label: 'Google-Bewertung', sort: 'rating' },
  { key: 'website', label: 'Website im Profil', sort: 'website' }, { key: 'distance', label: 'Entfernung', sort: 'distance', num: true }, { key: 'status', label: 'Status' }, { key: 'action', label: 'Aktion' }];
const starTxt = (r, n) => (r == null ? '<span class="sub">keine</span>' : `<span style="color:#f59e0b">★</span> ${String(r).replace('.', ',')} <span class="sub small">(${n})</span>`);
TABS.audits = [['', 'Interessenten'], ['finder', 'Lead-Finder'], ['agent', 'Prospect-Agent'], ['widget', 'Widget'], ['analytics', 'Analytics']];

let leafletP = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  return (leafletP ||= new Promise((res, rej) => {
    const c = document.createElement('link'); c.rel = 'stylesheet'; c.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(c);
    const s = document.createElement('script'); s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'; s.onload = () => res(window.L); s.onerror = rej; document.head.appendChild(s);
  }));
}
const pin = (color, label = '') => window.L.divIcon({ className: '', iconSize: [28, 28], iconAnchor: [14, 14],
  html: `<div style="width:28px;height:28px;border-radius:50%;background:${color};color:#fff;display:grid;place-items:center;font:700 12px system-ui;border:2px solid #fff;box-shadow:0 1px 4px #0006">${label}</div>` });

VIEWS.audits = async (v, sub) => {
  if (/^\d+$/.test(sub)) return auditDetail(v, sub);
  if (sub === 'finder') return leadFinder(v);
  if (sub === 'agent') return agentsView(v);
  if (sub === 'widget') return widgetView(v);
  if (sub === 'analytics') return analyticsView(v);
  const f = J(sessionStorage.getItem('pfil'), {}) || {};
  const qs = new URLSearchParams(Object.entries(f).filter(([, x]) => x)).toString();
  const list = await GET('/api/prospects' + (qs ? '?' + qs : ''));
  v.innerHTML = `<div class="row mb"><input id="pq" placeholder="Interessenten suchen …" value="${e(f.q || '')}" style="max-width:260px">
    <select id="pst" style="width:auto"><option value="">Status: alle</option>${Object.entries(PSTATUS).map(([k, t]) => `<option value="${e(k)}" ${k === f.status ? 'selected' : ''}>${t}</option>`).join('')}</select>
    <select id="psrc" style="width:auto"><option value="">Quelle: alle</option>${Object.entries(SRC).map(([k, t]) => `<option value="${k}" ${k === f.source ? 'selected' : ''}>${t}</option>`).join('')}</select>
    <span class="grow"></span><button class="btn" id="man">Manuell prüfen</button><a class="btn primary" href="#/audits/finder">+ Interessenten finden</a></div>
  ${list.length ? `<div class="card tablewrap"><table><tr><th>Unternehmen</th><th class="num">Lead-Bewertung</th><th>Online-Präsenz</th><th class="num">Website-Check</th><th>Google</th><th>Quelle</th><th>Status</th><th class="num">Aufrufe</th><th></th></tr>
  ${list.map((p) => `<tr><td><b>${e(p.name)}</b><div class="small sub">${e(p.category ? p.category + ' · ' : '')}${e(p.address)}</div></td>
    <td class="num">${potBadge(p.potential, p.potential_why)}</td><td>${presence(p, false)}</td><td class="num">${p.audit_id ? `<a href="#/audits/${p.audit_id}" class="${tone(p.audit_score)}"><b>${p.audit_score}%</b></a>` : '<span class="sub">–</span>'}</td>
    <td>${starTxt(p.rating, p.review_count)}</td>
    <td class="small">${e(SRC[p.source] || p.source)}</td><td><select data-ps="${p.id}" style="width:auto;padding:3px 6px">${Object.entries(PSTATUS).map(([k, t]) => `<option value="${e(k)}" ${k === p.status ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
    <td class="num">${p.views || 0}</td>
    <td class="num" style="white-space:nowrap">${p.audit_id ? '' : `<button class="btn sm" data-chk="${p.id}">Prüfen</button> `}<button class="btn sm" data-crm="${p.id}" ${p.opportunity_id ? 'disabled title="Bereits im CRM"' : ''}>→ CRM</button> <button class="btn sm" data-mail="${p.id}">✉</button> <button class="btn sm danger" data-pdel="${p.id}">🗑</button></td></tr>`).join('')}</table></div>`
    : empty('🧭', 'Noch keine Interessenten', 'Finde lokale Unternehmen über den Lead-Finder, lass den Prospect-Agenten suchen oder prüfe eine Website manuell.', '<a class="btn primary" href="#/audits/finder">Lead-Finder öffnen</a>')}`;
  const setF = (k, val) => { f[k] = val; sessionStorage.setItem('pfil', JSON.stringify(f)); render(); };
  $('#pq').onchange = (ev) => setF('q', ev.target.value); $('#pst').onchange = (ev) => setF('status', ev.target.value); $('#psrc').onchange = (ev) => setF('source', ev.target.value);
  $('#man').onclick = manualAuditModal;
  $$('[data-ps]').forEach((s) => (s.onchange = safe(async () => { await PUT('/api/prospects/' + s.dataset.ps, { status: s.value }); toast('Status gespeichert'); })));
  $$('[data-chk]').forEach((b) => (b.onclick = safe(async () => { b.disabled = true; b.textContent = '⏳'; const a = await POST(`/api/prospects/${b.dataset.chk}/audit`); location.hash = '#/audits/' + a.id; })));
  $$('[data-crm]').forEach((b) => (b.onclick = safe(async () => { await POST(`/api/prospects/${b.dataset.crm}/crm`); toast('Kontakt und Lead angelegt'); render(); })));
  $$('[data-mail]').forEach((b) => (b.onclick = () => outreachModal(list.find((p) => p.id == b.dataset.mail))));
  $$('[data-pdel]').forEach((b) => (b.onclick = safe(async () => { if (confirm('Interessent löschen? (Website-Check bleibt erhalten)')) { await DEL('/api/prospects/' + b.dataset.pdel); render(); } })));
};

function manualAuditModal() {
  modal('Website manuell prüfen', `<form class="form">${field('Firmenname *', 'business_name', '', 'text', 'required placeholder="Fahrschule Muster"')}${field('Website', 'url', '', 'text', 'placeholder="muster.de (leer = ohne Website)"')}
    ${field('Branche / Suchbegriff', 'industry', '', 'text', 'placeholder="Fahrschule"')}${field('Telefon', 'phone', '', 'tel')}<div class="full">${field('Adresse', 'address', '', 'text', 'placeholder="Lange Str. 1, 49733 Haren (Ems)"')}</div>
    <p class="full small sub">${SETTINGS.places_key ? '✅ Google-Profil, Bewertungen und lokales Ranking werden mitgeprüft.' : 'ℹ️ Mit <code>GOOGLE_PLACES_API_KEY</code> werden zusätzlich Google-Profil, Bewertungen und Ranking geprüft.'}</p>
    <div class="actions"><button class="btn primary" id="go">🔍 Check starten</button></div></form>`, async (d) => {
    $('#go').disabled = true; $('#go').textContent = '⏳ Prüfe … (bis zu 1 Minute)';
    try { const a = await POST('/api/audits', d); location.hash = '#/audits/' + a.id; } catch (er) { $('#go').disabled = false; $('#go').textContent = '🔍 Check starten'; throw er; }
  });
}

async function outreachModal(p) {
  const body = modal(`Erstansprache: ${p.name}`, '<p class="sub">Entwurf wird erstellt …</p>');
  const draw = (d) => {
    body.innerHTML = `<form class="form"><div class="full">${field('Betreff', 'subject', d.subject)}</div><label class="full">Text<textarea name="body" rows="14">${e(d.body)}</textarea></label>
      <p class="full small sub">Erstellt mit: ${e(d.generator)}${d.note ? ' · ' + e(d.note) : ''}${SETTINGS.ai_key ? '' : ' · Mit <code>ANTHROPIC_API_KEY</code> schreibt Claude individuelle Entwürfe.'}</p>
      <p class="full small warn">⚖️ Hinweis: Werbe-E-Mails an Unternehmen ohne vorherige Einwilligung sind in Deutschland nach § 7 UWG in der Regel unzulässig. Nutze den Text z. B. als Brief, für ein Gespräch vor Ort oder für Kontakte, die eingewilligt haben (z. B. über das Widget).</p>
      <div class="actions"><button type="button" class="btn" id="re">↻ Neu erstellen</button><span class="grow"></span><button type="button" class="btn" id="cp">Kopieren</button><button type="button" class="btn primary" id="ml">Im Mailprogramm öffnen</button></div></form>`;
    const cur = () => formData($('form', body));
    $('#cp').onclick = () => { const c = cur(); copy(`${c.subject}\n\n${c.body}`); };
    $('#ml').onclick = () => { const c = cur(); location.href = `mailto:?subject=${encodeURIComponent(c.subject)}&body=${encodeURIComponent(c.body)}`; };
    $('#re').onclick = safe(async () => { $('#re').disabled = true; draw(await POST(`/api/prospects/${p.id}/outreach`)); });
  };
  try { draw(p.outreach ? J(p.outreach) : await POST(`/api/prospects/${p.id}/outreach`)); } catch (er) { body.innerHTML = `<p class="bad">${e(er.message)}</p>`; }
}

async function leadFinder(v) {
  const last = J(sessionStorage.getItem('lf'), null);
  v.innerHTML = `<div class="card mb"><div class="row between mb"><h3>Lokale Leads finden, prüfen und ins CRM übernehmen</h3><a href="#" id="man">Unternehmen manuell hinzufügen</a></div>
    <form id="lff" class="row" style="align-items:flex-end"><label class="grow">Suchbegriff / Firmenname<input name="query" required placeholder="z. B. Zahnarzt, Rechtsanwalt, Dachdecker" value="${e(last?.q?.query || '')}"></label>
    <label class="grow">Standort<input name="location" required placeholder="z. B. Haren (Ems)" value="${e(last?.q?.location || SETTINGS.default_location || '')}"></label>
    <label>Radius<select name="radius_km" style="width:auto">${[1, 2, 5, 10, 20, 30, 50].map((k) => `<option value="${k}" ${k == (last?.q?.radius_km || 5) ? 'selected' : ''}>${k} km</option>`).join('')}</select></label>
    <button class="btn primary" id="sb" ${SETTINGS.places_key ? '' : 'disabled'}>Suchen</button></form>
    ${SETTINGS.places_key ? '' : '<p class="small warn mt">Für den Lead-Finder wird ein Google-Places-API-Schlüssel benötigt (<code>GOOGLE_PLACES_API_KEY</code>, siehe README).</p>'}</div>
    <div id="lfr">${last ? '' : empty('📍', 'Entdecke qualifizierte Leads in deiner Umgebung', 'Echte Unternehmen aus Google Maps – keine Scraper oder Tabellen. Speichern, prüfen und direkt als Lead anlegen.', '<a href="#" class="btn" onclick="event.preventDefault();document.getElementById(\'man\').click()">Unternehmen manuell hinzufügen</a>')}</div>`;
  $('#man').onclick = (ev) => { ev.preventDefault(); manualAuditModal(); };
  let data = last; let map = null; let markers = null;
  const save = () => sessionStorage.setItem('lf', JSON.stringify(data));
  const filt = J(localStorageGet('lffilt'), null) || { levels: ['hoch', 'mittel', 'niedrig'], noweb: false, lowrating: false, fewreviews: false, onlynew: false };
  const cols = J(localStorageGet('lfcols'), null) || Object.fromEntries(FINDER_COLS.map((c) => [c.key, true]));
  let sort = J(localStorageGet('lfsort'), null) || { key: 'potential', dir: -1 };
  const keep = () => { localStorageSet('lffilt', JSON.stringify(filt)); localStorageSet('lfcols', JSON.stringify(cols)); localStorageSet('lfsort', JSON.stringify(sort)); };
  const visible = () => data.results.filter((p) => filt.levels.includes(p.potential.level) && (!filt.noweb || !p.website) && (!filt.lowrating || (p.rating ?? 0) < 4.5)
    && (!filt.fewreviews || (p.review_count || 0) < 20) && (!filt.onlynew || !p.prospect));
  const sortVal = { name: (p) => p.name.toLowerCase(), potential: (p) => p.potential.score, rating: (p) => p.rating ?? -1, reviews: (p) => p.review_count || 0, distance: (p) => p.distance_km, website: (p) => (p.website ? 1 : 0) };
  const sorted = (arr) => [...arr].sort((a, b) => { const x = sortVal[sort.key](a); const y = sortVal[sort.key](b); return (x > y ? 1 : x < y ? -1 : 0) * sort.dir; });
  const th = (c) => c.sort ? `<th class="${c.num ? 'num ' : ''}sortable" data-sort="${c.sort}">${c.label}${sort.key === c.sort ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}</th>` : `<th class="${c.num ? 'num' : ''}">${c.label}</th>`;
  const cell = (c, p, i) => ({
    potential: `<td class="num" data-cell="pot">${potPill(p.potential, p.website && !p.site)}</td>`,
    presence: `<td data-cell="pres">${presence(p)}</td>`,
    google: `<td>${p.rating == null ? '<span class="sub">Keine Rezensionen</span>' : `<span class="stars">${'★'.repeat(Math.round(p.rating))}</span> ${String(p.rating).replace('.', ',')}<div class="small sub">${p.review_count} Bewertungen</div>`}</td>`,
    website: `<td>${p.website ? `<a href="${e(p.website)}" target="_blank" rel="noopener">Ja ↗</a>` : '<b class="bad">Nein</b>'}</td>`,
    distance: `<td class="num">${String(p.distance_km).replace('.', ',')} km</td>`,
    status: `<td>${p.prospect ? `<span class="badge won">${e(PSTATUS[p.prospect.status] || p.prospect.status)}</span>` : '<span class="badge">Nicht hinzugefügt</span>'}</td>`,
    action: `<td class="num">${p.prospect ? `<a class="btn sm" href="#/audits" onclick="sessionStorage.setItem('pfil',JSON.stringify({q:${e(JSON.stringify(p.name))}}))">Öffnen</a>` : `<button class="btn sm" data-add="${i}">+ Hinzufügen</button>`}</td>`,
  })[c.key];

  const drawMap = (vis) => loadLeaflet().then((L) => {
    if (!$('#lmap')) return;
    if (!map) {
      map = L.map('lmap').setView([data.center.lat, data.center.lng], 12);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap' }).addTo(map);
      L.circle([data.center.lat, data.center.lng], { radius: (data.q.radius_km || 5) * 1000, color: '#0B4AA0', weight: 1, fillOpacity: 0.04 }).addTo(map);
    }
    markers?.remove(); markers = L.layerGroup().addTo(map);
    const pts = vis.filter((p) => p.lat != null).map((p) => {
      L.marker([p.lat, p.lng], { icon: pin(p.prospect ? '#64748b' : LEVEL[p.potential.level].c, p.potential.score) }).addTo(markers)
        .bindPopup(`<b>${e(p.name)}</b><br>${e(p.address)}<br>Lead-Bewertung: <b>${p.potential.score} % ${LEVEL[p.potential.level].t}</b><br>${e(p.potential.why.join(', '))}`);
      return [p.lat, p.lng];
    });
    if (pts.length && !drawMap.fitted) { map.fitBounds(pts, { padding: [30, 30], maxZoom: 14 }); drawMap.fitted = true; }
  }).catch(() => { if ($('#lmap')) $('#lmap').outerHTML = '<p class="sub" style="padding:12px">Karte konnte nicht geladen werden.</p>'; });

  const show = () => {
    const vis = sorted(visible()); const active = FINDER_COLS.filter((c) => cols[c.key]);
    const hidden = data.results.length - vis.length;
    if (!$('#lmap')) $('#lfr').innerHTML = `<div class="card mb" style="padding:0;overflow:hidden"><div id="lmap" style="height:380px"></div></div><div class="card tablewrap" id="lft"></div>`;
    $('#lft').innerHTML = `<div class="row mb"><b class="grow">Wähle potenzielle Kunden aus, um sie zu prüfen und hinzuzufügen</b>
      <div class="dd"><button class="btn" id="fbtn">⚙ Filter${hidden ? ` (${hidden} ausgeblendet)` : ''}</button><div class="dd-menu" id="fmenu" hidden>
        <b class="small">Lead-Bewertung</b>${Object.entries(LEVEL).map(([k, l]) => `<label class="check"><input type="checkbox" data-lv="${k}" ${filt.levels.includes(k) ? 'checked' : ''}> ${l.t}</label>`).join('')}
        <b class="small mt">Weitere</b>${[['noweb', 'Nur ohne Website'], ['lowrating', 'Bewertung unter 4,5'], ['fewreviews', 'Weniger als 20 Bewertungen'], ['onlynew', 'Nur noch nicht hinzugefügte']]
          .map(([k, t]) => `<label class="check"><input type="checkbox" data-fl="${k}" ${filt[k] ? 'checked' : ''}> ${t}</label>`).join('')}</div></div>
      <div class="dd"><button class="btn" id="cbtn">Spalten verwalten ▾</button><div class="dd-menu" id="cmenu" hidden>${FINDER_COLS.map((c) => `<label class="check"><input type="checkbox" data-col="${c.key}" ${cols[c.key] ? 'checked' : ''}> ${c.label}</label>`).join('')}</div></div>
      <button class="btn" id="addSel" disabled>👥 Mehrere hinzufügen</button><button class="btn primary" id="addChk" disabled>Hinzufügen & prüfen</button></div>
      <table><tr><th><input type="checkbox" id="all"></th>${th({ label: 'Unternehmen', sort: 'name' })}${active.map(th).join('')}</tr>
      ${vis.map((p) => { const i = data.results.indexOf(p); return `<tr data-row="${i}"><td>${p.prospect ? '' : `<input type="checkbox" class="sel" value="${i}">`}</td>
        <td><b>${e(p.name)}</b><div class="small sub">${e(p.category ? p.category + ' · ' : '')}${e(p.address)}</div></td>${active.map((c) => cell(c, p, i)).join('')}</tr>`; }).join('')}</table>
      ${vis.length ? '' : '<p class="sub">Keine Treffer für diese Filter.</p>'}<p class="small sub mt">${data.results.length} Unternehmen gefunden · Lead-Bewertung: je höher, desto mehr Bedarf an Website, Google-Profil oder Bewertungen.</p>`;
    const toggle = (btn, menu) => { $(btn).onclick = (ev) => { ev.stopPropagation(); $$('.dd-menu').forEach((m) => m.id !== menu.slice(1) && (m.hidden = true)); $(menu).hidden = !$(menu).hidden; }; $(menu).onclick = (ev) => ev.stopPropagation(); };
    toggle('#fbtn', '#fmenu'); toggle('#cbtn', '#cmenu');
    const reopen = (menu) => { show(); $(menu).hidden = false; };
    $$('[data-lv]').forEach((c) => (c.onchange = () => { filt.levels = $$('[data-lv]:checked').map((x) => x.dataset.lv); keep(); reopen('#fmenu'); drawMap(sorted(visible())); }));
    $$('[data-fl]').forEach((c) => (c.onchange = () => { filt[c.dataset.fl] = c.checked; keep(); reopen('#fmenu'); drawMap(sorted(visible())); }));
    $$('[data-col]').forEach((c) => (c.onchange = () => { cols[c.dataset.col] = c.checked; keep(); reopen('#cmenu'); }));
    $$('[data-sort]').forEach((h) => (h.onclick = () => { const k = h.dataset.sort; sort = { key: k, dir: sort.key === k ? -sort.dir : (k === 'name' || k === 'distance' ? 1 : -1) }; keep(); show(); }));
    const sel = () => $$('.sel:checked').map((c) => Number(c.value));
    const upd = () => { const n = sel().length; $('#addSel').disabled = $('#addChk').disabled = !n; $('#addSel').textContent = n ? `👥 ${n} hinzufügen` : '👥 Mehrere hinzufügen'; };
    $$('.sel').forEach((c) => (c.onchange = upd)); $('#all').onchange = (ev) => { $$('.sel').forEach((c) => (c.checked = ev.target.checked)); upd(); };
    $$('[data-add]').forEach((b) => (b.onclick = safe(async () => { b.disabled = true; await add([Number(b.dataset.add)], false); })));
    $('#addSel').onclick = safe(async () => { $('#addSel').disabled = true; await add(sel(), false); });
    $('#addChk').onclick = safe(async () => { const ids = sel(); $('#addChk').disabled = true; $('#addChk').textContent = `⏳ Prüfe ${ids.length} …`; await add(ids, true); });
    drawMap(vis);
  };
  document.addEventListener('click', () => $$('.dd-menu').forEach((m) => (m.hidden = true)));

  const add = async (idx, audit) => {
    const items = idx.map((i) => { const { potential, prospect, site, distance_km, ...rest } = data.results[i]; return rest; });
    const r = await POST('/api/prospects', { items, audit });
    toast(`${r.added} Interessent(en) hinzugefügt${audit ? ' und geprüft' : ''}${r.items.some((x) => x.error) ? ' – einige Checks fehlgeschlagen' : ''}`);
    r.items.forEach((x, k) => { data.results[idx[k]].prospect = { id: x.id, status: audit && !x.error ? 'geprüft' : 'neu' }; });
    save(); show();
  };

  // Websites nach und nach im Hintergrund prüfen (Spinner → Bewertung)
  const quickCheck = async () => {
    const todo = data.results.filter((p) => p.website && !p.site);
    for (let k = 0; k < todo.length; k += 5) {
      const batch = todo.slice(k, k + 5);
      try {
        const res = await POST('/api/prospects/quick-check', { items: batch.map(({ potential, prospect, site, distance_km, ...rest }) => rest) });
        for (const r of res) { const p = data.results.find((x) => x.place_id === r.place_id); if (p) { p.site = r.site; p.potential = r.potential; } }
      } catch { for (const p of batch) p.site = { reachable: false, error: 'Prüfung fehlgeschlagen' }; }
      save();
      if (!$('#lft')) return; // Ansicht gewechselt
      for (const p of batch) {
        const row = $(`[data-row="${data.results.indexOf(p)}"]`);
        if (row) { const pc = $('[data-cell="pot"]', row); if (pc) pc.innerHTML = potPill(p.potential, false); const pr = $('[data-cell="pres"]', row); if (pr) pr.innerHTML = presence(p); }
      }
    }
    if (sort.key === 'potential' && todo.length) show();
  };

  if (last) { show(); quickCheck(); }
  $('#lff').onsubmit = safe(async (ev) => {
    ev.preventDefault(); const q = formData(ev.target); q.radius_km = Number(q.radius_km);
    $('#sb').disabled = true; $('#sb').textContent = 'Suche …';
    try { data = await POST('/api/prospects/search', q); data.q = q; save(); map = null; drawMap.fitted = false; $('#lfr').innerHTML = ''; show(); quickCheck(); }
    finally { $('#sb').disabled = false; $('#sb').textContent = 'Suchen'; }
  });
}

async function agentsView(v) {
  const list = await GET('/api/agents');
  v.innerHTML = `<div class="card mb"><div class="row between"><div><h3>Prospect-Agent – findet rund um die Uhr neue Interessenten</h3>
    <p class="sub small" style="margin:4px 0 0">Durchsucht regelmäßig Google Maps nach deiner Zielbranche, prüft neue Unternehmen automatisch, legt sie im CRM an und schreibt auf Wunsch einen Anschreiben-Entwurf.</p></div>
    <button class="btn primary" id="add" ${SETTINGS.places_key ? '' : 'disabled title="GOOGLE_PLACES_API_KEY fehlt"'}>+ Agent erstellen</button></div></div>
  ${list.length ? `<div class="grid g2">${list.map((g) => { const r = J(g.last_result, null);
    return `<div class="card"><div class="row between"><h3>🤖 ${e(g.name)}</h3>${g.active ? '<span class="badge published">aktiv</span>' : '<span class="badge">pausiert</span>'}</div>
    <p class="sub">„${e(g.query)}“ in ${e(g.location)} (${String(g.radius_km).replace('.', ',')} km) · ${g.frequency === 'daily' ? 'täglich' : 'jeden ' + ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'][g.weekday]} um ${e(g.time)}</p>
    <div class="row small">${g.only_no_website ? '<span class="tag">nur ohne Website</span>' : ''}${g.min_potential ? `<span class="tag">Potenzial ≥ ${g.min_potential}</span>` : ''}<span class="tag">max. ${g.max_per_run} pro Lauf</span>
      ${g.auto_audit ? '<span class="tag">prüft automatisch</span>' : ''}${g.auto_crm ? '<span class="tag">legt Leads an</span>' : ''}${g.auto_outreach ? '<span class="tag">schreibt Entwürfe</span>' : ''}</div>
    <p class="small mt">${r ? `Letzter Lauf ${dt(r.at)}: ${r.found} gefunden, <b>${r.new} neu</b>, ${r.audited} geprüft, ${r.crm} ins CRM${r.errors.length ? ` · <span class="bad">${r.errors.length} Fehler</span>` : ''}` : 'Noch nicht gelaufen.'} · insgesamt ${g.prospect_count} Interessenten</p>
    ${r?.errors?.length ? `<details class="small"><summary>Fehler</summary>${r.errors.map((x) => `<div class="bad">${e(x)}</div>`).join('')}</details>` : ''}
    <div class="row mt"><button class="btn sm primary" data-run="${g.id}">▶ Jetzt ausführen</button><button class="btn sm" data-ed="${g.id}">Bearbeiten</button><a class="btn sm" href="#/audits" onclick="sessionStorage.setItem('pfil',JSON.stringify({source:'agent'}))">Ergebnisse</a></div></div>`; }).join('')}</div>`
    : empty('🤖', 'Noch kein Agent', 'Beispiel: jeden Montag Dachdecker im Umkreis von 20 km ohne eigene Website suchen, prüfen und als Lead anlegen.')}`;
  const am = (g) => { modal(g.id ? 'Agent bearbeiten' : 'Prospect-Agent erstellen', `<form class="form">
    ${field('Name *', 'name', g.name || '', 'text', 'required placeholder="Handwerker Emsland"')}${field('Suchbegriff *', 'query', g.query || '', 'text', 'required placeholder="Dachdecker"')}
    ${field('Standort *', 'location', g.location || SETTINGS.default_location || '', 'text', 'required placeholder="Haren (Ems)"')}${select('Radius', 'radius_km', [1, 2, 5, 10, 20, 30, 50].map((k) => [k, k + ' km']), g.radius_km || 10)}
    ${select('Häufigkeit', 'frequency', [['weekly', 'Wöchentlich'], ['daily', 'Täglich']], g.frequency || 'weekly')}${select('Wochentag', 'weekday', [1, 2, 3, 4, 5, 6, 0].map((d) => [d, ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'][d]]), g.weekday ?? 1)}
    <label>Uhrzeit<input type="time" name="time" value="${e(g.time || '07:00')}"></label>${field('Max. neue Interessenten pro Lauf', 'max_per_run', g.max_per_run ?? 10, 'number', 'min="1" max="60"')}
    ${field('Mindest-Potenzial (0–100)', 'min_potential', g.min_potential ?? 0, 'number', 'min="0" max="100"')}<span></span>
    <div class="full choices">${[['only_no_website', 'Nur Unternehmen ohne Website'], ['auto_audit', 'Automatisch Website-Check erstellen'], ['auto_crm', 'Automatisch als Lead ins CRM'], ['auto_outreach', 'Anschreiben-Entwurf erstellen'], ['active', 'Agent aktiv']]
      .map(([k, t]) => `<label><input type="checkbox" name="${k}" ${g[k] ?? (k === 'active' || k === 'auto_audit') ? 'checked' : ''}> ${t}</label>`).join('')}</div>
    <p class="full small sub">Jeder Lauf kostet Google-Places-Abfragen (ca. 4 pro Suche + 3 pro geprüftem Unternehmen).</p>
    <div class="actions">${g.id ? '<button type="button" class="btn danger" id="del">Löschen</button><span class="grow"></span>' : ''}<button class="btn primary">Speichern</button></div></form>`,
  async (d) => { for (const k of ['only_no_website', 'auto_audit', 'auto_crm', 'auto_outreach', 'active']) d[k] = d[k] ? 1 : 0;
    await (g.id ? PUT('/api/agents/' + g.id, d) : POST('/api/agents', d)); toast('Agent gespeichert'); render(); });
    if (g.id) $('#del').onclick = safe(async () => { if (confirm('Agent löschen?')) { await DEL('/api/agents/' + g.id); closeModal(); render(); } }); };
  $('#add').onclick = () => am({});
  $$('[data-ed]').forEach((b) => (b.onclick = () => am(list.find((g) => g.id == b.dataset.ed))));
  $$('[data-run]').forEach((b) => (b.onclick = safe(async () => { b.disabled = true; b.textContent = '⏳ läuft …'; const r = await POST(`/api/agents/${b.dataset.run}/run`);
    toast(`${r.found} gefunden, ${r.new} neu, ${r.audited} geprüft${r.errors.length ? ', ' + r.errors.length + ' Fehler' : ''}`, !!r.errors.length && !r.new); render(); })));
}

async function widgetView(v) {
  const a = await GET('/api/analytics?months=12');
  const snippet = `<div id="webhafen-check"></div>\n<script src="${baseUrl()}/widget.js" async></script>`;
  v.innerHTML = `<div class="grid g2"><div class="card"><h3>Website-Check-Widget für deine Website</h3>
    <p class="sub">Besucher deiner Website prüfen ihre eigene Seite kostenlos – du bekommst einen Kontakt <b>mit Einwilligung</b>, einen fertigen Bericht und einen Lead in der Pipeline.</p>
    <div class="code">${e(snippet)}</div><div class="row mt"><button class="btn" id="cp">Code kopieren</button><a class="btn" href="/widget" target="_blank">Vorschau ↗</a></div>
    <p class="small sub mt">Schutz: Honeypot gegen Bots, max. 3 Checks pro Besucher und Stunde, 50 pro Tag. Unter Einstellungen kannst du einen Link zu deiner Datenschutzerklärung hinterlegen.</p></div>
    <div class="card" style="padding:0;overflow:hidden"><iframe src="/widget" style="width:100%;height:560px;border:0" title="Widget-Vorschau"></iframe></div></div>
    <div class="card mt tablewrap"><h3 class="mb">Neueste Widget-Einreichungen</h3>${a.widget.length ? `<table><tr><th>Datum</th><th>Name</th><th>Unternehmen & Website</th><th>E-Mail</th><th>Telefon</th><th class="num">Ergebnis</th></tr>
    ${a.widget.map((w) => `<tr><td>${dt(w.created_at)}</td><td>${e(w.name)}</td><td>${e(w.business_name)}<div class="small sub">${e(w.url)}</div></td><td><a href="mailto:${e(w.email)}">${e(w.email)}</a></td><td>${e(w.phone)}</td>
    <td class="num">${w.audit_id ? `<a href="#/audits/${w.audit_id}" class="${tone(w.score)}"><b>${w.score}%</b></a>` : `<span class="bad small">${e(w.error || '–')}</span>`}</td></tr>`).join('')}</table>` : '<p class="sub">Noch keine Einreichungen.</p>'}</div>`;
  $('#cp').onclick = () => copy(snippet);
}

const SRC_COL = { manuell: '#64748b', 'lead-finder': '#0B4AA0', agent: '#7c3aed', widget: '#16a34a' };
function donut(parts) {
  const total = parts.reduce((s, p) => s + p.n, 0); let acc = 0; const C = 2 * Math.PI * 40;
  return `<svg viewBox="0 0 100 100" width="170" height="170"><circle cx="50" cy="50" r="40" fill="none" stroke="var(--soft)" stroke-width="14"/>
    ${total ? parts.filter((p) => p.n).map((p) => { const len = (p.n / total) * C; const s = `<circle cx="50" cy="50" r="40" fill="none" stroke="${p.c}" stroke-width="14" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-acc}" transform="rotate(-90 50 50)"/>`; acc += len; return s; }).join('') : ''}
    <text x="50" y="55" text-anchor="middle" font-size="16" font-weight="700" fill="currentColor">${total}</text></svg>`;
}
async function analyticsView(v) {
  const months = Number(sessionStorage.getItem('anm') || 6);
  const a = await GET('/api/analytics?months=' + months);
  const mlabel = (k) => new Date(k + '-15').toLocaleDateString('de-DE', { month: 'short', year: '2-digit' });
  const maxR = Math.max(1, ...a.reports_by_month.map((r) => Object.keys(SRC).reduce((s, k) => s + r[k], 0)));
  const maxV = Math.max(1, ...a.views_by_month.map((r) => r.views));
  v.innerHTML = `<div class="row mb"><h2 class="grow">Analytics</h2><select id="anm" style="width:auto">${[3, 6, 12, 24].map((m) => `<option value="${m}" ${m === months ? 'selected' : ''}>Letzte ${m} Monate</option>`).join('')}</select></div>
  <div class="grid g4"><div class="card kpi"><div class="l">Erstellte Berichte</div><div class="v">${a.totals.reports}</div></div>
    <div class="card kpi"><div class="l">Kontakte erstellt</div><div class="v">${a.totals.contacts}</div><div class="s">aus Interessenten</div></div>
    <div class="card kpi"><div class="l">Neue Interessenten pro Woche</div><div class="v">${String(a.totals.per_week).replace('.', ',')}</div><div class="s">${a.totals.prospects} im Zeitraum</div></div>
    <div class="card kpi"><div class="l">Berichtsaufrufe</div><div class="v">${a.totals.views}</div><div class="s">durch Interessenten</div></div></div>
  <div class="grid g2 mt"><div class="card"><h3>Erstellte Berichte nach Quelle</h3><div class="legend mt">${Object.entries(SRC).map(([k, t]) => `<span><i style="background:${SRC_COL[k]}"></i>${t}</span>`).join('')}</div>
    <div class="vbars">${a.reports_by_month.map((r) => `<div data-t="${mlabel(r.month)}: ${Object.keys(SRC).reduce((s2, k) => s2 + r[k], 0)} Berichte" style="background:none;display:flex;flex-direction:column-reverse;height:100%">${Object.keys(SRC).map((k) => `<span style="display:block;height:${(r[k] / maxR) * 100}%;background:${SRC_COL[k]}" title="${mlabel(r.month)} · ${SRC[k]}: ${r[k]}"></span>`).join('')}</div>`).join('')}</div>
    <div class="xlabels">${a.months.map((k) => `<span>${mlabel(k)}</span>`).join('')}</div></div>
    <div class="card"><h3>Berichtsaufrufe</h3><div class="vbars mt">${a.views_by_month.map((r) => `<div style="height:${(r.views / maxV) * 100}%" data-t="${mlabel(r.month)}: ${r.views} Aufrufe"></div>`).join('')}</div>
    <div class="xlabels">${a.months.map((k) => `<span>${mlabel(k)}</span>`).join('')}</div></div></div>
  <div class="grid g2 mt"><div class="card"><h3>Kontakte nach Quelle</h3><div class="row mt" style="gap:24px">${donut(a.contacts_by_source.map((c) => ({ n: c.n, c: SRC_COL[c.source] })))}
    <div>${a.contacts_by_source.map((c) => `<div class="mb"><i style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${SRC_COL[c.source]};margin-right:6px"></i>${SRC[c.source]}: <b>${c.n}</b></div>`).join('')}</div></div></div>
    <div class="card tablewrap"><h3 class="mb">Meistgesehene Berichte</h3>${a.top_reports.length ? `<table><tr><th>Unternehmen</th><th class="num">Wertung</th><th class="num">Aufrufe</th><th>Zuletzt</th></tr>${a.top_reports.map((r) => `<tr><td><a href="#/audits/${r.id}">${e(r.business_name)}</a></td><td class="num ${tone(r.score)}">${r.score}%</td><td class="num"><b>${r.views}</b></td><td>${dt(r.last_view)}</td></tr>`).join('')}</table>` : '<p class="sub">Noch keine Aufrufe. Aufrufe zählen, sobald ein Interessent den geteilten Link öffnet.</p>'}</div></div>`;
  $('#anm').onchange = (ev) => { sessionStorage.setItem('anm', ev.target.value); render(); };
}

async function auditDetail(v, id) {
  const a = await GET('/api/audits/' + id); const r = a.result;
  const link = `${baseUrl()}/bericht/${a.token}`;
  const place = r.meta?.place;
  v.innerHTML = `<div class="row mb"><a href="#/audits">‹ Interessenten</a><span class="grow"></span><span class="sub small">👁 ${a.views} Aufrufe</span>
    ${a.prospect ? `<button class="btn" id="mail">✉ Anschreiben</button>` : ''}<button class="btn" id="lead">🎯 Als Lead anlegen</button><a class="btn" href="/bericht/${e(a.token)}?vorschau=1" target="_blank">↗ Öffnen / PDF</a>
    <button class="btn" id="re">↻ Neu prüfen</button><button class="btn danger" id="del">🗑</button><button class="btn primary" id="share">Bericht teilen</button></div>
  <div class="grid" style="grid-template-columns:minmax(240px,280px) 1fr;align-items:start"><div><div class="card"><h3>${e(a.business_name)}</h3><p class="small sub">${e(a.industry)} · ${dt(a.created_at)}</p>
    <table class="mt"><tr><td><b>Gesamtwertung</b></td><td class="num"><b>${a.score}%</b></td></tr>${r.categories.map((c) => `<tr><td>${e(c.name)}</td><td class="num ${tone(c.score)}">${c.score ?? '–'}%</td></tr>`).join('')}</table>
    <p class="small mt">${r.url ? `🌐 <a href="${e(r.url)}" target="_blank" rel="noopener">${e(r.url)}</a><br>` : '🌐 <b class="bad">keine Website</b><br>'}${a.address ? '📍 ' + e(a.address) + '<br>' : ''}${a.phone ? '📞 ' + e(a.phone) + '<br>' : ''}${r.meta.cms?.length ? '🧩 ' + e(r.meta.cms.join(', ')) : ''}</p>
    ${r.notes?.length ? `<p class="small sub">${r.notes.map(e).join('<br>')}</p>` : ''}</div>
    <div class="card mt"><h3>Lokale SEO-Heatmap</h3>${place?.lat ? `<form id="hf" class="mt" style="display:grid;gap:10px">${field('Suchbegriff', 'keyword', a.heatmaps[0]?.keyword || a.industry || place.category || '', 'text', 'required')}
      ${select('Raster', 'size', [[3, '3 × 3 (9 Punkte)'], [5, '5 × 5 (25 Punkte)'], [7, '7 × 7 (49 Punkte)']], 3)}${select('Abdeckung', 'radius_km', [[1, '1 km'], [2, '2 km'], [3, '3 km'], [5, '5 km'], [10, '10 km']], 3)}
      <button class="btn primary" id="hgo">🔍 Lokalen Scan ausführen</button><p class="small sub" style="margin:0">Jeder Rasterpunkt ist eine Google-Places-Abfrage.</p></form>
      ${a.heatmaps.length ? `<p class="small mt">Gespeichert: ${a.heatmaps.map((h) => `„${e(h.keyword)}“ Ø ${String(h.avg_rank).replace('.', ',')}`).join(', ')}</p>` : ''}`
      : '<p class="small sub">Verfügbar, sobald das Google-Unternehmensprofil gefunden wurde (<code>GOOGLE_PLACES_API_KEY</code>).</p>'}</div></div>
    <iframe class="report-frame" id="rf" src="/bericht/${e(a.token)}?vorschau=1" title="Bericht"></iframe></div>`;
  $('#share').onclick = () => copy(link);
  $('#del').onclick = safe(async () => { if (confirm('Check löschen?')) { await DEL('/api/audits/' + id); location.hash = '#/audits'; } });
  $('#lead').onclick = safe(async () => { const x = await POST(`/api/audits/${id}/to-lead`); toast(x.existed ? 'War bereits im CRM' : 'Kontakt & Lead angelegt'); });
  if (a.prospect) $('#mail').onclick = () => outreachModal(a.prospect);
  $('#re').onclick = safe(async () => { $('#re').disabled = true; $('#re').textContent = '⏳ Prüfe …';
    const n = a.prospect ? await POST(`/api/prospects/${a.prospect.id}/audit`) : await POST('/api/audits', { business_name: a.business_name, url: a.url, industry: a.industry, phone: a.phone, address: a.address });
    location.hash = '#/audits/' + n.id; });
  if ($('#hf')) $('#hf').onsubmit = safe(async (ev) => { ev.preventDefault(); const d = formData(ev.target); $('#hgo').disabled = true; $('#hgo').textContent = '⏳ Scanne …';
    try { const h = await POST(`/api/audits/${id}/heatmap`, d); toast(`Ø Position ${String(h.avg_rank).replace('.', ',')} · Top 3 an ${h.score} % der Punkte`); render(); }
    finally { if ($('#hgo')) { $('#hgo').disabled = false; $('#hgo').textContent = '🔍 Lokalen Scan ausführen'; } } });
}

// ===== Einstellungen =====
VIEWS.einstellungen = async (v) => {
  SETTINGS = await GET('/api/settings');
  v.innerHTML = `<div class="grid g2"><form class="card form" id="sf"><h3>Agentur (erscheint in den Berichten)</h3>
    ${field('Agenturname', 'agency_name', SETTINGS.agency_name, 'text', 'placeholder="Webhafen – Webdesign & Entwicklung"')}${field('Website', 'agency_website', SETTINGS.agency_website, 'text', 'placeholder="web-hafen.de"')}
    ${field('E-Mail', 'agency_email', SETTINGS.agency_email, 'email')}${field('Telefon', 'agency_phone', SETTINGS.agency_phone, 'tel')}
    <label>Markenfarbe<input type="color" name="brand_color" value="${e(SETTINGS.brand_color || '#0B4AA0')}" style="height:40px"></label>
    <label class="check full"><input type="checkbox" id="rlogo" ${SETTINGS.report_logo === '0' ? '' : 'checked'}> Webhafen-Logo in Berichten anzeigen</label>${field('Link für „Kontakt aufnehmen“', 'cta_url', SETTINGS.cta_url, 'url', 'placeholder="https://web-hafen.de/kontakt (sonst mailto)"')}
    ${field('Link zur Datenschutzerklärung (Widget)', 'privacy_url', SETTINGS.privacy_url, 'url', 'placeholder="https://web-hafen.de/datenschutz"')}${field('Standard-Standort für die Lead-Suche', 'default_location', SETTINGS.default_location, 'text', 'placeholder="Haren (Ems)"')}
    <h3>System</h3><div class="full">${field('Öffentliche Adresse dieser App', 'public_url', SETTINGS.public_url, 'url', `placeholder="${location.origin}"`)}<p class="small sub">Wird für Affiliate-, Kurz- und Berichtslinks verwendet.</p></div>
    <div class="actions"><button class="btn primary">Speichern</button></div></form>
    <div class="card"><h3>Affiliate-API</h3><p class="sub small">Meldet deine Website, dein Shop oder ein Formular-Tool einen Verkauf, wird die Provision automatisch berechnet.</p>
    <label>API-Schlüssel<div class="row"><input id="ak" value="${e(SETTINGS.aff_api_key || '')}" readonly class="grow" style="width:auto"><button class="btn" id="gen">${SETTINGS.aff_api_key ? 'Neu erzeugen' : 'Erzeugen'}</button></div></label>
    <div class="code mt">POST ${e(baseUrl())}/api/public/sale
Content-Type: application/json

{ "key": "${e(SETTINGS.aff_api_key || 'API-SCHLÜSSEL')}", "ref": "CODE-aus-?ref=", "amount": 499.00,
  "customer_name": "Max Muster", "customer_email": "max@example.de" }</div>
    <h3 class="mt">Optionale API-Schlüssel</h3><p class="small">${SETTINGS.places_key ? '✅' : '⬜'} <code>GOOGLE_PLACES_API_KEY</code> – Google-Profil & Bewertungen im Website-Check<br>${SETTINGS.pagespeed_key ? '✅' : '⬜'} <code>PAGESPEED_API_KEY</code> – eigenes Kontingent für PageSpeed-Messungen<br>${SETTINGS.ai_key ? '✅' : '⬜'} <code>ANTHROPIC_API_KEY</code> – Claude schreibt individuelle Anschreiben-Entwürfe</p>
    <p class="small sub">Werden als Umgebungsvariablen beim Start gesetzt (siehe README).</p></div></div>`;
  $('#sf').onsubmit = safe(async (ev) => { ev.preventDefault(); const sd = formData(ev.target); sd.report_logo = $('#rlogo').checked ? '1' : '0'; SETTINGS = { ...SETTINGS, ...(await PUT('/api/settings', sd)) }; document.documentElement.style.setProperty('--accent', SETTINGS.brand_color); toast('Gespeichert'); });
  $('#gen').onclick = safe(async () => { if (SETTINGS.aff_api_key && !confirm('Alter Schlüssel wird ungültig. Fortfahren?')) return;
    const k = [...crypto.getRandomValues(new Uint8Array(18))].map((b) => b.toString(16).padStart(2, '0')).join(''); await PUT('/api/settings', { aff_api_key: k }); render(); });
};
