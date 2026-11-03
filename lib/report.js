import { esc } from './util.js';
import { LOGO } from './brand.js';

const tone = (s) => (s == null ? 'muted' : s >= 80 ? 'good' : s >= 50 ? 'warn' : 'bad');
const verdict = (s) => (s >= 80 ? 'Sehr gut aufgestellt' : s >= 50 ? 'Raum für Verbesserungen' : 'Dringender Handlungsbedarf');

function ring(score, size = 132) {
  const r = 52; const c = 2 * Math.PI * r; const off = c * (1 - (score || 0) / 100);
  return `<svg viewBox="0 0 120 120" width="${size}" height="${size}" role="img" aria-label="${score} Prozent">
    <circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--track)" stroke-width="10"/>
    <circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--${tone(score)})" stroke-width="10" stroke-linecap="round"
      stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 60 60)"/>
    <text x="60" y="58" text-anchor="middle" font-size="26" font-weight="700" fill="currentColor">${score}%</text>
    <text x="60" y="78" text-anchor="middle" font-size="10" fill="var(--sub)">Gesamtwertung</text></svg>`;
}


const stars = (r) => { const n = Math.round((r || 0) * 2) / 2; return '★'.repeat(Math.floor(n)) + (n % 1 ? '⯪' : '') + '☆'.repeat(5 - Math.ceil(n)); };
const de = (n) => String(n ?? '–').replace('.', ',');
const rankColor = (r) => (r == null ? '#7f1d1d' : r <= 3 ? '#16a34a' : r <= 10 ? '#f59e0b' : '#dc2626');
const bar = (label, v) => `<div class="mbar"><span>${esc(label)}</span><i><em class="${tone(v)}" style="width:${v || 0}%"></em></i><b class="${tone(v)}">${v ?? '–'}</b></div>`;

function speedCard(name, ps) {
  if (!ps) return '';
  const lcpS = (ps.lcp.ms || 0) / 1000;
  const label = lcpS <= 2.5 ? ['Schnell', 'good'] : lcpS <= 4 ? ['Normal', 'warn'] : ['Langsam', 'bad'];
  return `<div class="ps"><div class="row"><b>${name}</b><span class="pill ${label[1]}">${de(lcpS.toFixed(1))} s · ${label[0]}</span></div>
    ${bar('Performance', ps.performance)}${bar('SEO', ps.seo)}${bar('Barrierefreiheit', ps.accessibility)}${bar('Best Practices', ps.best_practices)}
    <div class="vitals"><span>LCP <b>${esc(ps.lcp.value)}</b></span><span>FCP <b>${esc(ps.fcp.value)}</b></span><span>TBT <b>${esc(ps.tbt.value)}</b></span><span>CLS <b>${esc(ps.cls.value)}</b></span></div>
    <div class="counts"><span class="bad">✕ ${ps.failed} sollten behoben werden</span><span class="warn">! ${ps.warn} Behebung erwägen</span><span class="good">✓ ${ps.passed} bestanden</span></div>
    ${ps.issues?.length ? `<details><summary>Wichtigste Probleme</summary><ul>${ps.issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></details>` : ''}</div>`;
}

function heatmapBlock(h, i) {
  const cells = h.points.map((p) => `<div style="background:${rankColor(p.rank)}" title="${esc(p.top.join(', '))}">${p.rank ?? '20+'}</div>`).join('');
  return `<div class="heat" data-heat="${i}" ${i ? 'hidden' : ''}>
    <div class="row"><span>Durchschnittliche Position <b>${de(h.avg_rank)}</b></span><span>In den Top 3 an <b>${h.score} %</b> der Punkte</span><span class="sub">${h.size}×${h.size} Raster · ${de(h.radius_km)} km Radius</span></div>
    <div class="grid" style="grid-template-columns:repeat(${h.size},1fr);max-width:${h.size * 54}px">${cells}</div>
    <div class="map" id="map${i}" hidden></div></div>`;
}

function extras(key, a) {
  const m = a.result?.meta || {};
  if (key === 'performance' && m.pagespeed) {
    return `<h3 class="sec">Ladezeit & Google-Lighthouse</h3><div class="pscols">${speedCard('📱 Mobil', m.pagespeed.mobile)}${speedCard('🖥 Desktop', m.pagespeed.desktop)}</div>
      <p class="sub small">Gemessen mit Google PageSpeed Insights. Google nutzt diese Werte (Core Web Vitals) für das Ranking.</p>`;
  }
  if (key === 'reputation' && m.place) {
    const rv = m.place.reviews || [];
    return `<div class="rep"><div class="big">${de(m.place.rating ?? '–')}<small> / 5</small><div class="stars">${stars(m.place.rating)}</div><div class="sub">${m.place.review_count} Google-Bewertungen</div></div>
      <div class="revs">${rv.length ? rv.map((r) => `<blockquote><div class="stars">${stars(r.rating)}</div>„${esc(r.text.slice(0, 320))}${r.text.length > 320 ? ' …' : ''}“<cite>${esc(r.author)} · ${esc(r.when)}</cite></blockquote>`).join('') : '<p class="sub">Keine Bewertungstexte verfügbar.</p>'}</div></div>
      ${m.place.maps_url ? `<p><a href="${esc(m.place.maps_url)}" target="_blank" rel="noopener">Profil auf Google Maps ansehen ↗</a></p>` : ''}`;
  }
  if (key === 'local' && (m.ranking || a.heatmaps?.length)) {
    const rk = m.ranking;
    const own = m.place?.place_id;
    const table = rk ? `<h3 class="sec">Lokaler Ranking-Tracker</h3><p class="sub">Die Top 10 in Google Maps für „${esc(rk.keyword)}“ rund um den Standort.</p>
      <div class="tw"><table><tr><th>Rang</th><th>Unternehmen</th><th class="n">Fotos</th><th>Bewertung</th><th class="n">Bewertungen</th></tr>
      ${rk.results.map((x, i) => `<tr class="${x.place_id === own ? 'own' : ''}"><td><span class="rk">${String(i + 1).padStart(2, '0')}</span></td><td>${esc(x.name)}${x.place_id === own ? ' <span class="pill good">Ihr Unternehmen</span>' : ''}</td>
      <td class="n">${x.photos >= 5 ? 'Ja' : 'Nein'}</td><td><span class="stars">${stars(x.rating)}</span> ${de(x.rating ?? '–')}</td><td class="n">${x.review_count}</td></tr>`).join('')}</table></div>` : '';
    const hm = a.heatmaps || [];
    const heat = hm.length ? `<h3 class="sec">Lokale SEO-Heatmap</h3><p class="sub">Position in Google Maps, wenn von verschiedenen Punkten rund um das Unternehmen gesucht wird. Grün = Top 3, Orange = Platz 4–10, Rot = 11–20, Dunkelrot = nicht in den Top 20.</p>
      <div class="row">${hm.length > 1 ? `<select id="heatSel">${hm.map((h, i) => `<option value="${i}">${esc(h.keyword)} · ${h.size}×${h.size}</option>`).join('')}</select>` : `<b>„${esc(hm[0].keyword)}“</b>`}
      <button class="btn2" id="showMap" type="button">Auf Karte anzeigen</button><span class="sub small">(lädt Kartendaten von OpenStreetMap)</span></div>
      ${hm.map(heatmapBlock).join('')}<script type="application/json" id="heatData">${JSON.stringify(hm.map((h) => ({ c: h.center, p: h.points.map((p) => [p.lat, p.lng, p.rank]) }))).replace(/</g, '\\u003c')}</script>` : '';
    return table + heat;
  }
  return '';
}

export function renderReport(a, s) {
  const r = a.result || {}; const cats = r.categories || [];
  const agency = s.agency_name || 'Ihre Agentur';
  const cta = s.cta_url || (s.agency_email ? `mailto:${s.agency_email}?subject=${encodeURIComponent('Audit-Bericht ' + a.business_name)}` : '#');
  const bad = cats.filter((c) => c.score != null && c.score < 50); const good = cats.filter((c) => c.score != null && c.score >= 50);
  const bar = (c) => `<a class="bar" href="#${c.key}"><span>${esc(c.name)}</span><b class="${tone(c.score)}">${c.score}%</b><i><em class="${tone(c.score)}" style="width:${c.score}%"></em></i></a>`;
  const date = new Date(r.checked_at || a.created_at).toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' });
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Online-Check: ${esc(a.business_name)}</title><meta name="robots" content="noindex">
<style>
:root{--bg:#f4f6fb;--card:#fff;--text:#0f172a;--sub:#64748b;--line:#e2e8f0;--track:#e5e7eb;--good:#16a34a;--warn:#d97706;--bad:#dc2626;--muted:#94a3b8;--accent:${esc(s.brand_color || '#0B4AA0')}}
@media (prefers-color-scheme:dark){:root{--bg:#0b1120;--card:#111a2e;--text:#e2e8f0;--sub:#94a3b8;--line:#1e293b;--track:#1e293b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:1040px;margin:0 auto;padding:24px 16px 64px}.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px;margin-bottom:18px}
.agency{display:flex;flex-wrap:wrap;gap:16px;align-items:center;justify-content:space-between}.agency small{display:block;margin-top:6px}.ag-logo{color:var(--text);text-decoration:none}.logo-lockup{display:inline-flex;gap:9px;align-items:center}.logo-mark{width:42px;height:32px;overflow:visible}.logo-word{height:20px;width:auto}.agency h2{margin:0;font-size:18px}.agency small{color:var(--sub)}
.btn{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;padding:10px 18px;border-radius:9px;font-weight:600}
h1{font-size:26px;margin:0 0 4px}.sub{color:var(--sub)}.hero{display:grid;grid-template-columns:auto 1fr;gap:24px;align-items:center}
.verdict{font-size:20px;font-weight:700;margin:0 0 6px}.good{color:var(--good)}.warn{color:var(--warn)}.bad{color:var(--bad)}.muted{color:var(--muted)}
.bars{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;margin-top:10px}.bar{display:grid;grid-template-columns:1fr auto;gap:4px 10px;padding:12px 14px;border:1px solid var(--line);border-radius:10px;color:inherit;text-decoration:none}
.bar i{grid-column:1/-1;height:6px;background:var(--track);border-radius:9px;overflow:hidden}.bar em{display:block;height:100%;background:currentColor}
h3.grp{font-size:13px;text-transform:uppercase;letter-spacing:.05em;margin:18px 0 4px}
.cat h2{margin:0;font-size:19px;display:flex;gap:10px;align-items:center}.pill{font-size:12px;border:1px solid currentColor;border-radius:99px;padding:1px 9px}
.checks{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;margin-top:14px}.chk{border:1px solid var(--line);border-radius:10px;padding:14px;position:relative}
.chk b{display:block;padding-right:28px}.chk p{margin:6px 0 0;color:var(--sub);font-size:14px}.chk .tip{color:var(--text);font-size:13.5px;border-left:3px solid var(--accent);padding-left:9px;margin-top:8px}
.ico{position:absolute;top:12px;right:12px;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;color:#fff;font-size:13px;font-weight:700}
.ico.ok{background:var(--good)}.ico.no{background:var(--bad)}.ico.na{background:var(--muted)}
.facts{display:flex;flex-wrap:wrap;gap:6px 22px;color:var(--sub);font-size:14px;margin-top:10px}.foot{text-align:center;color:var(--sub);font-size:13px}
h3.sec{font-size:16px;margin:22px 0 4px}.small{font-size:13px}.row{display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center;margin:8px 0}
.pscols{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;margin-top:10px}.ps{border:1px solid var(--line);border-radius:10px;padding:14px}.ps .row{justify-content:space-between;margin-top:0}
.mbar{display:grid;grid-template-columns:130px 1fr 34px;gap:10px;align-items:center;font-size:13.5px;margin:7px 0}.mbar i{height:8px;background:var(--track);border-radius:9px;overflow:hidden}.mbar em{display:block;height:100%;background:currentColor}.mbar b{text-align:right}
.vitals,.counts{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:13px;margin-top:10px}.vitals{color:var(--sub)}details{margin-top:8px;font-size:13.5px}
.rep{display:grid;grid-template-columns:180px 1fr;gap:20px;margin-top:16px}.big{font-size:44px;font-weight:700;line-height:1}.big small{font-size:16px;color:var(--sub)}.big .sub{font-size:14px;font-weight:400;line-height:1.4;margin-top:6px}.big .stars{font-size:16px;margin-top:6px}.stars{color:#f59e0b;letter-spacing:1px;font-size:15px}
.revs{display:grid;gap:10px}blockquote{margin:0;border:1px solid var(--line);border-radius:10px;padding:12px 14px;font-style:italic;font-size:14px}cite{display:block;font-style:normal;color:var(--sub);font-size:12.5px;margin-top:6px}
.tw{overflow-x:auto}table{width:100%;border-collapse:collapse;margin-top:10px;font-size:14px}th,td{text-align:left;padding:8px;border-bottom:1px solid var(--line)}th{font-size:12px;color:var(--sub);text-transform:uppercase}.n{text-align:right}
tr.own{background:color-mix(in srgb,var(--accent) 10%,transparent)}.rk{display:inline-block;background:var(--track);border-radius:6px;padding:1px 7px;font-size:12px;font-weight:600}
.heat .grid{display:grid;gap:4px;margin-top:10px}.heat .grid div{aspect-ratio:1;border-radius:50%;display:grid;place-items:center;color:#fff;font-weight:700;font-size:15px}
.map{height:380px;border-radius:12px;margin-top:12px;border:1px solid var(--line)}.btn2{border:1px solid var(--line);background:var(--card);color:var(--text);border-radius:8px;padding:6px 12px;cursor:pointer;font:inherit}
select{font:inherit;padding:6px 10px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--text)}
@media (max-width:640px){.rep{grid-template-columns:1fr}}
@media (max-width:640px){.hero{grid-template-columns:1fr;justify-items:center;text-align:center}}
@media print{body{background:#fff}.card{break-inside:avoid;border-color:#ddd}.btn{display:none}}
</style></head><body><div class="wrap">
<div class="card agency"><div>${s.report_logo === '0' ? `<h2>${esc(agency)}</h2>` : `<a class="ag-logo" href="${esc(s.agency_website ? 'https://' + s.agency_website.replace(/^https?:\/\//, '') : '#')}" target="_blank" rel="noopener" aria-label="${esc(agency)}">${LOGO}</a>`}<small>${[s.report_logo === '0' ? '' : esc(agency), ...[s.agency_website, s.agency_email, s.agency_phone].filter(Boolean).map(esc)].filter(Boolean).join(' · ')}</small></div>
<div><span class="sub" style="margin-right:12px">Fragen zu Ihrem Ergebnis?</span><a class="btn" href="${esc(cta)}">Jetzt Kontakt aufnehmen</a></div></div>

<div class="card"><h1>${esc(a.business_name)}</h1><div class="sub">Online-Check vom ${date}${a.industry ? ' · ' + esc(a.industry) : ''}</div>
<div class="facts">${r.url || a.url ? `<span>🌐 <a href="${esc(r.url || a.url)}" style="color:inherit">${esc((r.url || a.url).replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a></span>` : '<span>🌐 keine eigene Website</span>'}${a.address ? `<span>📍 ${esc(a.address)}</span>` : ''}${a.phone ? `<span>📞 ${esc(a.phone)}</span>` : ''}${r.meta?.cms?.length ? `<span>🧩 ${esc(r.meta.cms.join(', '))}</span>` : ''}</div></div>

<div class="card"><p class="sub" style="margin-top:0">Rund 8 von 10 Kunden informieren sich online, bevor sie ein Unternehmen kontaktieren. Fehlende oder unvollständige Angaben kosten Vertrauen und Anfragen. Dieser Bericht zeigt, wo Ihr Unternehmen gut dasteht – und wo es Potenzial gibt.</p>
<div class="hero">${ring(a.score)}<div><p class="verdict ${tone(a.score)}">${verdict(a.score)}</p>
<div class="sub">Der Wert fasst ${cats.length} Bereiche mit ${cats.reduce((n, c) => n + c.checks.length, 0)} Einzelprüfungen zusammen.${bad.length ? ` Das größte Potenzial liegt bei: ${bad.map((c) => esc(c.name)).join(', ')}.` : ''}</div></div></div>
${bad.length ? `<h3 class="grp bad">Benötigt Aufmerksamkeit</h3><div class="bars">${bad.map(bar).join('')}</div>` : ''}
${good.length ? `<h3 class="grp good">Läuft gut</h3><div class="bars">${good.map(bar).join('')}</div>` : ''}</div>

${cats.map((c) => `<div class="card cat" id="${c.key}"><h2>${esc(c.name)} <span class="pill ${tone(c.score)}">${c.score ?? '–'}%</span></h2><p class="sub" style="margin:6px 0 0">${esc(c.description)}</p>
<div class="checks">${c.checks.map((k) => `<div class="chk"><span class="ico ${k.ok === null ? 'na' : k.ok ? 'ok' : 'no'}">${k.ok === null ? '–' : k.ok ? '✓' : '✕'}</span><b>${esc(k.label)}</b><p>${esc(k.detail)}</p>${!k.ok && k.ok !== null && k.tip ? `<p class="tip">${esc(k.tip)}</p>` : ''}</div>`).join('')}</div>${extras(c.key, a)}</div>`).join('')}

<div class="card agency"><div><h2>Wir helfen Ihnen, die Punkte zu beheben</h2><small>${esc(agency)} kümmert sich um Website, Tracking, Google-Profil und mehr.</small></div><a class="btn" href="${esc(cta)}">Kostenloses Erstgespräch</a></div>
<p class="foot">Automatisch erstellt am ${date}. Alle Prüfungen beziehen sich auf die öffentlich erreichbare Startseite.</p>
</div>${a.heatmaps?.length ? HEAT_SCRIPT : ''}</body></html>`;
}

const HEAT_SCRIPT = `<script>
(function(){var data=JSON.parse(document.getElementById('heatData').textContent);var cur=0,maps={},loaded=false;
var sel=document.getElementById('heatSel');function show(i){document.querySelectorAll('[data-heat]').forEach(function(el){el.hidden=Number(el.dataset.heat)!==i});cur=i;if(loaded)draw(i)}
if(sel)sel.onchange=function(){show(Number(sel.value))};
function col(r){return r==null?'#7f1d1d':r<=3?'#16a34a':r<=10?'#f59e0b':'#dc2626'}
function draw(i){var el=document.getElementById('map'+i);el.hidden=false;if(maps[i])return;var d=data[i];var m=L.map(el).setView([d.c.lat,d.c.lng],12);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'&copy; OpenStreetMap'}).addTo(m);var b=[];
d.p.forEach(function(p){b.push([p[0],p[1]]);L.marker([p[0],p[1]],{icon:L.divIcon({className:'',html:'<div style="width:34px;height:34px;border-radius:50%;background:'+col(p[2])+';color:#fff;display:grid;place-items:center;font:700 14px system-ui;border:2px solid #fff;box-shadow:0 1px 4px #0005">'+(p[2]||'20+')+'</div>',iconSize:[34,34],iconAnchor:[17,17]})}).addTo(m)});
m.fitBounds(b,{padding:[30,30]});maps[i]=m}
document.getElementById('showMap').onclick=function(){if(loaded)return draw(cur);var c=document.createElement('link');c.rel='stylesheet';c.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';document.head.appendChild(c);
var s=document.createElement('script');s.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';s.onload=function(){loaded=true;draw(cur)};document.head.appendChild(s);this.disabled=true}})();
<\/script>`;

export function renderWidget(s) {
  const accent = esc(s.brand_color || '#0B4AA0');
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kostenloser Website-Check</title><meta name="robots" content="noindex">
<style>:root{--a:${accent}}*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#0f172a;background:transparent}
.w{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:22px}h2{margin:0 0 4px;font-size:21px}p{margin:0 0 14px;color:#64748b}
label{display:block;font-weight:600;font-size:13px;margin-bottom:10px}input{width:100%;font:inherit;padding:9px 11px;border:1px solid #cbd5e1;border-radius:8px;margin-top:4px}
.g{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}.c{display:flex;gap:8px;font-weight:400;color:#475569;font-size:13px}.c input{width:auto;margin-top:3px}
button{width:100%;background:var(--a);color:#fff;border:0;border-radius:9px;padding:12px;font:inherit;font-weight:700;cursor:pointer}button:disabled{opacity:.6}
.hp{position:absolute;left:-9999px}.err{color:#dc2626;margin-top:10px}.res{text-align:center}.score{font-size:52px;font-weight:800;color:var(--a)}a.b{display:inline-block;background:var(--a);color:#fff;text-decoration:none;padding:11px 20px;border-radius:9px;font-weight:700;margin-top:8px}
@media(max-width:520px){.g{grid-template-columns:1fr}}</style></head><body><div class="w" id="w">
<h2>Kostenloser Website-Check</h2><p>In unter einer Minute sehen Sie, wie gut Ihr Unternehmen online aufgestellt ist – inklusive konkreter Tipps.</p>
<form id="f"><div class="g"><label>Firmenname *<input name="business_name" required></label><label>Website *<input name="url" required placeholder="ihre-firma.de"></label>
<label>Ihr Name<input name="name"></label><label>E-Mail *<input name="email" type="email" required></label></div><label>Telefon (optional)<input name="phone" type="tel"></label>
<input class="hp" name="website_hp" tabindex="-1" autocomplete="off" aria-hidden="true">
<label class="c"><input type="checkbox" name="consent" required> <span>Ich bin einverstanden, dass ${esc(s.agency_name || 'der Anbieter')} mich zum Ergebnis per E-Mail oder Telefon kontaktiert. Widerruf jederzeit möglich.${s.privacy_url ? ` <a href="${esc(s.privacy_url)}" target="_blank" rel="noopener">Datenschutz</a>` : ''}</span></label>
<button id="b">Website jetzt prüfen</button><div class="err" id="e"></div></form></div>
<script>var f=document.getElementById('f');function h(){parent.postMessage({wcHeight:document.body.scrollHeight+4},'*')}h();
f.onsubmit=async function(ev){ev.preventDefault();var b=document.getElementById('b'),e=document.getElementById('e');e.textContent='';b.disabled=true;b.textContent='Prüfe Ihre Website … (bis zu 1 Minute)';
var d={};new FormData(f).forEach(function(v,k){d[k]=v});d.consent=!!f.consent.checked;
try{var r=await fetch('api/public/widget',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(d)});var j=await r.json();if(!r.ok)throw new Error(j.error||'Fehler');
document.getElementById('w').innerHTML='<div class="res"><h2>Ihr Ergebnis</h2><div class="score">'+j.score+' %</div><p>Ihr ausführlicher Bericht ist fertig.</p><a class="b" target="_blank" rel="noopener" href="'+j.report_url.replace(/^\\//,'')+'">Bericht ansehen</a></div>';h()}
catch(x){e.textContent=x.message;b.disabled=false;b.textContent='Website jetzt prüfen';h()}}</script></body></html>`;
}
