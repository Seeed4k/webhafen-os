// Öffentliche Seiten: Terminbuchung und Terminabsage
import { esc } from './util.js';
import { LOGO } from './brand.js';
import { formatDe } from './calendar.js';

const js = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, '');
const css = (accent) => `:root{--a:${accent};--bg:#f4f6fb;--card:#fff;--t:#0f172a;--s:#64748b;--l:#e2e8f0;--soft:#eef2f8}
@media(prefers-color-scheme:dark){:root{--bg:#0b1120;--card:#111a2e;--t:#e2e8f0;--s:#94a3b8;--l:#1f2a40;--soft:#16213a;--a:#6F9BE0}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--t);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.w{max-width:880px;margin:0 auto;padding:24px 16px 48px}.card{background:var(--card);border:1px solid var(--l);border-radius:14px;padding:22px}
.top{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:18px;flex-wrap:wrap}.top a{color:var(--t);text-decoration:none}
.logo-lockup{display:inline-flex;gap:9px;align-items:center}.logo-mark{width:40px;height:30px;overflow:visible}.logo-word{height:19px;width:auto}
h1{font-size:24px;margin:0 0 6px}.sub{color:var(--s)}.meta{display:flex;gap:6px 18px;flex-wrap:wrap;color:var(--s);margin:10px 0 0}
.grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px;margin-top:20px}@media(max-width:700px){.grid{grid-template-columns:1fr}}
h2{font-size:15px;margin:0 0 10px}.days{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:8px;max-height:430px;overflow:auto;padding:2px}
.day,.slot{border:1px solid var(--l);background:var(--card);color:var(--t);border-radius:10px;padding:9px 6px;cursor:pointer;font:inherit;text-align:center}
.day b{display:block;font-size:17px}.day small{display:block;color:var(--s);font-size:12px}.day:disabled{opacity:.35;cursor:default}
.day.on,.slot.on{border-color:var(--a);background:var(--a);color:#fff}.day.on small{color:#fff}
.slots{display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:8px}.slot:hover,.day:not(:disabled):hover{border-color:var(--a)}
label{display:block;font-weight:600;font-size:13px;margin-bottom:10px}input,textarea{width:100%;font:inherit;color:var(--t);background:var(--card);padding:9px 11px;border:1px solid var(--l);border-radius:8px;margin-top:4px}
textarea{min-height:80px}.c{display:flex;gap:8px;font-weight:400;color:var(--s)}.c input{width:auto;margin-top:3px}
.btn{display:inline-block;width:100%;background:var(--a);color:#fff;border:0;border-radius:9px;padding:12px;font:inherit;font-weight:700;cursor:pointer;text-align:center;text-decoration:none}
.btn:disabled{opacity:.6}.btn.ghost{background:none;color:var(--a);border:1px solid var(--a)}.err{color:#dc2626;margin-top:10px}.hp{position:absolute;left:-9999px}
.ok{text-align:center;padding:20px 0}.ok .big{font-size:46px}.empty{color:var(--s);padding:18px 0}.foot{text-align:center;color:var(--s);font-size:12px;margin-top:18px}`;

const head = (title, s) => `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="robots" content="noindex"><link rel="icon" href="/brand/favicon.svg" type="image/svg+xml"><style>${css(esc(s.brand_color || '#0B4AA0'))}</style></head><body><div class="w">
<div class="top"><a href="${esc(s.agency_website ? 'https://' + s.agency_website.replace(/^https?:\/\//, '') : '#')}" aria-label="${esc(s.agency_name || 'Webhafen')}">${LOGO}</a><span class="sub">${esc([s.agency_phone, s.agency_email].filter(Boolean).join(' · '))}</span></div>`;

export function renderBookingPage(cal, s, { ref = '' } = {}) {
  return `${head(`${cal.name} buchen`, s)}
<div class="card"><h1>${esc(cal.name)}</h1>${cal.description ? `<div class="sub">${esc(cal.description)}</div>` : ''}
<div class="meta"><span>⏱ ${cal.duration} Minuten</span>${cal.location ? `<span>📍 ${esc(cal.location)}</span>` : ''}<span>🗓 Zeiten in deutscher Zeit</span></div>
<div id="app"><div class="grid"><div><h2>1. Tag wählen</h2><div class="days" id="days"><div class="empty">Lädt …</div></div></div>
<div><h2>2. Uhrzeit wählen</h2><div id="slots" class="empty">Bitte zuerst einen Tag wählen.</div></div></div>
<form id="f" hidden style="margin-top:22px"><h2>3. Ihre Angaben</h2><p class="sub" id="pick"></p>
<label>Name *<input name="name" required autocomplete="name"></label><label>E-Mail *<input name="email" type="email" required autocomplete="email"></label>
<label>Telefon<input name="phone" type="tel" autocomplete="tel"></label><label>Firma<input name="company" autocomplete="organization"></label>
<label>Worum geht es? (optional)<textarea name="message"></textarea></label><input class="hp" name="website_hp" tabindex="-1" autocomplete="off" aria-hidden="true">
<label class="c"><input type="checkbox" name="consent" required> <span>Ich bin einverstanden, dass meine Angaben zur Vorbereitung und Durchführung des Termins gespeichert werden.${s.privacy_url ? ` <a href="${esc(s.privacy_url)}" target="_blank" rel="noopener">Datenschutz</a>` : ''}</span></label>
<button class="btn" id="b">Termin verbindlich buchen</button><div class="err" id="e"></div></form></div></div>
<p class="foot">${esc(s.agency_name || '')}</p></div>
<script>
var slug=${js(cal.slug)},ref=${js(String(ref).slice(0, 64))},sel={date:null,time:null};
var WD=['So','Mo','Di','Mi','Do','Fr','Sa'],MO=['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
function $(s){return document.querySelector(s)}
function load(){fetch('/api/public/calendars/'+slug).then(function(r){return r.json()}).then(function(d){
  var h=d.days.filter(function(x){return true}).map(function(x){var p=x.date.split('-');return '<button type="button" class="day" data-d="'+x.date+'" '+(x.free?'':'disabled')+'><small>'+WD[x.weekday]+'</small><b>'+(+p[2])+'</b><small>'+MO[+p[1]-1]+'</small></button>'}).join('');
  $('#days').innerHTML=h||'<div class="empty">Zurzeit keine freien Termine.</div>';
  document.querySelectorAll('.day').forEach(function(b){b.onclick=function(){pickDay(b.dataset.d,b)}});
  var first=document.querySelector('.day:not(:disabled)');if(first)pickDay(first.dataset.d,first);else $('#slots').textContent='Zurzeit keine freien Termine.';
})}
function pickDay(d,btn){sel.date=d;sel.time=null;$('#f').hidden=true;document.querySelectorAll('.day').forEach(function(x){x.classList.toggle('on',x===btn)});
  $('#slots').className='empty';$('#slots').textContent='Lädt …';
  fetch('/api/public/calendars/'+slug+'/slots?date='+d).then(function(r){return r.json()}).then(function(r){
    if(!r.slots.length){$('#slots').textContent='An diesem Tag ist leider nichts mehr frei.';return}
    $('#slots').className='slots';$('#slots').innerHTML=r.slots.map(function(t){return '<button type="button" class="slot" data-t="'+t+'">'+t+'</button>'}).join('');
    document.querySelectorAll('.slot').forEach(function(b){b.onclick=function(){sel.time=b.dataset.t;document.querySelectorAll('.slot').forEach(function(x){x.classList.toggle('on',x===b)});
      var p=d.split('-');$('#pick').textContent='Gewählt: '+WD[new Date(d+'T12:00').getDay()]+', '+(+p[2])+'. '+MO[+p[1]-1]+' um '+sel.time+' Uhr';$('#f').hidden=false;$('#f').scrollIntoView({behavior:'smooth',block:'start'})}})
  })}
$('#f').onsubmit=function(ev){ev.preventDefault();var f=ev.target,b=$('#b');$('#e').textContent='';b.disabled=true;b.textContent='Wird gebucht …';
  var d={slug:slug,ref:ref,date:sel.date,time:sel.time,consent:f.consent.checked};['name','email','phone','company','message','website_hp'].forEach(function(k){d[k]=f[k].value});
  fetch('/api/public/book',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(d)}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||'Fehler');return j})})
  .then(function(j){$('#app').innerHTML='<div class="ok"><div class="big">✅</div><h2 style="font-size:20px">Ihr Termin ist gebucht!</h2><p>'+j.when+'</p><p class="sub">'+(j.mailed?'Eine Bestätigung mit Kalendereintrag ist unterwegs an Ihre E-Mail-Adresse.':'Wir melden uns zur Bestätigung bei Ihnen.')+'</p><p><a class="btn ghost" style="width:auto;padding:9px 16px" href="'+j.cancel_url+'">Termin absagen</a></p></div>'})
  .catch(function(x){$('#e').textContent=x.message;b.disabled=false;b.textContent='Termin verbindlich buchen';if(/nicht mehr frei/.test(x.message)){var on=document.querySelector('.day.on');if(on)pickDay(sel.date,on)}})};
load();
</script></body></html>`;
}

export function renderCancelPage(a, s) {
  const past = new Date(a.start_at.replace(' ', 'T')) < new Date();
  return `${head('Termin absagen', s)}
<div class="card" id="app">${a.status === 'abgesagt'
    ? `<div class="ok"><div class="big">🗓</div><h1>Dieser Termin ist bereits abgesagt.</h1></div>`
    : `<h1>Termin absagen</h1><p><b>${esc(a.calendar_name || a.title)}</b><br>${esc(formatDe(a.start_at))}</p>
${past ? '<p class="sub">Dieser Termin liegt in der Vergangenheit.</p>' : `<p class="sub">Möchten Sie diesen Termin wirklich absagen? Sie können danach direkt einen neuen buchen.</p>
<button class="btn" id="b">Ja, Termin absagen</button><div class="err" id="e"></div>`}`}</div></div>
<script>var b=document.getElementById('b');if(b)b.onclick=function(){b.disabled=true;fetch('/api/public/cancel/${encodeURIComponent(a.token)}',{method:'POST'}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||'Fehler');return j})})
.then(function(j){document.getElementById('app').innerHTML='<div class="ok"><div class="big">✅</div><h1>Ihr Termin wurde abgesagt.</h1>'+(j.rebook?'<p><a class="btn" style="width:auto;padding:10px 18px" href="'+j.rebook+'">Neuen Termin buchen</a></p>':'')+'</div>'})
.catch(function(x){document.getElementById('e').textContent=x.message;b.disabled=false})}</script></body></html>`;
}
