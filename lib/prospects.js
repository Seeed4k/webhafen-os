// Interessenten (Prospecting): Audits erzeugen, ins CRM übernehmen, Prospect-Agent
import { runAudit, quickSiteCheck } from './audit.js';
import { searchArea, leadPotential } from './places.js';
import { token, localStamp, parseJSON } from './util.js';
import { draftOutreach } from './outreach.js';
import { getSettings } from './db.js';

const one = (db, sql, ...a) => db.prepare(sql).get(...a);

// ---------- Schnellprüfung der Websites (mit 7-Tage-Zwischenspeicher) ----------
export function cachedSite(db, url) {
  if (!url) return null;
  const r = one(db, `SELECT data FROM site_checks WHERE url = ? AND checked_at >= datetime('now','localtime','-7 days')`, url);
  return r ? parseJSON(r.data, null) : null;
}
export async function checkSites(db, urls, { concurrency = 4 } = {}) {
  const out = {}; const todo = [];
  for (const u of new Set(urls.filter(Boolean))) { const c = cachedSite(db, u); if (c) out[u] = c; else todo.push(u); }
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, async () => {
    while (i < todo.length) {
      const u = todo[i++];
      out[u] = await quickSiteCheck(u);
      db.prepare(`INSERT INTO site_checks (url, data, checked_at) VALUES (?, ?, datetime('now','localtime'))
        ON CONFLICT(url) DO UPDATE SET data = excluded.data, checked_at = excluded.checked_at`).run(u, JSON.stringify(out[u]));
    }
  }));
  return out;
}

export function upsertProspect(db, p, { source = 'manuell', agent_id = null } = {}) {
  if (p.place_id) {
    const ex = one(db, 'SELECT id FROM prospects WHERE place_id = ?', p.place_id);
    if (ex) return { id: ex.id, created: false };
  }
  const site = cachedSite(db, p.website);
  const pot = leadPotential(p, site);
  const id = db.prepare(`INSERT INTO prospects (place_id, name, address, lat, lng, phone, website, category, rating, review_count, photos, maps_url, potential, potential_why, source, agent_id, site, has_hours)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(p.place_id || null, p.name, p.address || '', p.lat ?? null, p.lng ?? null, p.phone || '', p.website || '',
    p.category || '', p.rating ?? null, p.review_count || 0, p.photos || 0, p.maps_url || '', p.place_id ? pot.score : null, JSON.stringify(p.place_id ? pot.why : []), source, agent_id,
    site ? JSON.stringify(site) : null, p.has_hours ? 1 : 0).lastInsertRowid;
  return { id, created: true };
}

// Führt einen Website-Check aus und verknüpft ihn mit dem Interessenten
export async function createAudit(db, data, { source = 'manuell', prospect_id = null, env = process.env } = {}) {
  const result = await runAudit(data, env);
  const pid = prospect_id ?? upsertProspect(db, { name: data.business_name, address: data.address, phone: data.phone, website: data.url, category: data.industry }, { source }).id;
  const place = result.meta.place;
  const id = db.prepare(`INSERT INTO audits (token, business_name, url, industry, phone, address, score, result, prospect_id, place_id, source) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(token(10), data.business_name, result.url || '', data.industry || place?.category || '', data.phone || place?.phone || '', data.address || place?.address || '',
      result.score, JSON.stringify(result), pid, place?.place_id || data.place_id || '', source).lastInsertRowid;
  const pr = one(db, 'SELECT * FROM prospects WHERE id = ?', pid);
  db.prepare(`UPDATE prospects SET audit_id = ?, status = CASE WHEN status IN ('neu','geprüft') THEN 'geprüft' ELSE status END,
    place_id = COALESCE(place_id, ?), rating = COALESCE(rating, ?), review_count = MAX(review_count, ?) WHERE id = ?`)
    .run(id, !pr.place_id && place?.place_id && !one(db, 'SELECT id FROM prospects WHERE place_id = ?', place.place_id) ? place.place_id : null,
      place?.rating ?? null, place?.review_count || 0, pid);
  return one(db, 'SELECT * FROM audits WHERE id = ?', id);
}

export async function auditProspect(db, prospectId, env = process.env) {
  const p = one(db, 'SELECT * FROM prospects WHERE id = ?', prospectId);
  if (!p) throw Object.assign(new Error('Interessent nicht gefunden'), { status: 404 });
  return createAudit(db, { business_name: p.name, url: p.website, phone: p.phone, address: p.address, industry: p.category, place_id: p.place_id || '' }, { source: p.source, prospect_id: p.id, env });
}

export function prospectToCrm(db, prospectId) {
  const p = one(db, 'SELECT * FROM prospects WHERE id = ?', prospectId);
  if (!p) throw Object.assign(new Error('Interessent nicht gefunden'), { status: 404 });
  if (p.opportunity_id && one(db, 'SELECT id FROM opportunities WHERE id = ?', p.opportunity_id)) return { contact_id: p.contact_id, opportunity_id: p.opportunity_id, existed: true };
  const audit = p.audit_id ? one(db, 'SELECT score, url FROM audits WHERE id = ?', p.audit_id) : null;
  const contact_id = p.contact_id && one(db, 'SELECT id FROM contacts WHERE id = ?', p.contact_id) ? p.contact_id
    : db.prepare('INSERT INTO contacts (name, phone, company, tags, notes) VALUES (?,?,?,?,?)')
      .run(p.name, p.phone, p.name, ['interessent', p.source].filter(Boolean).join(','), [p.address, p.website, audit ? `Website-Check: ${audit.score} %` : ''].filter(Boolean).join('\n')).lastInsertRowid;
  const pipe = one(db, 'SELECT id FROM pipelines ORDER BY id LIMIT 1');
  const stage = one(db, 'SELECT id FROM stages WHERE pipeline_id = ? ORDER BY position LIMIT 1', pipe.id);
  const opportunity_id = db.prepare('INSERT INTO opportunities (name, contact_id, pipeline_id, stage_id, company, source, tags, updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(`${p.name} – ${p.website ? 'Website-Optimierung' : 'Neue Website'}`, contact_id, pipe.id, stage?.id ?? null, p.name, `Prospecting (${p.source})`, p.website ? '' : 'ohne-website', localStamp()).lastInsertRowid;
  db.prepare(`UPDATE prospects SET contact_id = ?, opportunity_id = ?, status = 'im CRM' WHERE id = ?`).run(contact_id, opportunity_id, p.id);
  if (p.audit_id) db.prepare('UPDATE audits SET contact_id = ? WHERE id = ?').run(contact_id, p.audit_id);
  return { contact_id, opportunity_id, existed: false };
}

export async function outreachForProspect(db, prospectId, env = process.env) {
  const p = one(db, 'SELECT * FROM prospects WHERE id = ?', prospectId);
  if (!p) throw Object.assign(new Error('Interessent nicht gefunden'), { status: 404 });
  const a = p.audit_id ? one(db, 'SELECT * FROM audits WHERE id = ?', p.audit_id) : null;
  const settings = getSettings(db);
  const reportUrl = a ? `${(settings.public_url || '').replace(/\/$/, '')}/bericht/${a.token}` : '';
  const draft = await draftOutreach({ prospect: p, audit: a ? { ...a, result: parseJSON(a.result, {}) } : null, settings, reportUrl }, env);
  db.prepare('UPDATE prospects SET outreach = ? WHERE id = ?').run(JSON.stringify({ ...draft, created_at: localStamp() }), p.id);
  return draft;
}

// ---------- Prospect-Agent ----------
export function agentDue(agent, now = new Date()) {
  if (!agent.active) return false;
  const stamp = localStamp(now); const today = stamp.slice(0, 10);
  if (stamp.slice(11) < agent.time) return false;
  if (agent.last_run && agent.last_run.slice(0, 10) === today) return false;
  if (agent.frequency === 'weekly' && now.getDay() !== Number(agent.weekday)) return false;
  return true;
}

export async function runAgent(db, agent, env = process.env) {
  const started = localStamp();
  db.prepare('UPDATE prospect_agents SET last_run = ? WHERE id = ?').run(started, agent.id);
  const out = { found: 0, new: 0, audited: 0, crm: 0, outreach: 0, errors: [] };
  try {
    const { results } = await searchArea({ query: agent.query, location: agent.location, radiusKm: agent.radius_km });
    out.found = results.length;
    const pre = results.filter((p) => !agent.only_no_website || !p.website)
      .filter((p) => !p.place_id || !one(db, 'SELECT id FROM prospects WHERE place_id = ?', p.place_id));
    const sites = await checkSites(db, pre.slice(0, 40).map((p) => p.website));
    const candidates = pre
      .map((p) => ({ ...p, pot: leadPotential(p, sites[p.website]).score }))
      .filter((p) => p.pot >= (agent.min_potential || 0))
      .sort((a, b) => b.pot - a.pot);
    for (const p of candidates) {
      if (out.new >= agent.max_per_run) break;
      const { id, created } = upsertProspect(db, p, { source: 'agent', agent_id: agent.id });
      if (!created) continue;
      out.new++;
      try {
        if (agent.auto_audit) { await auditProspect(db, id, env); out.audited++; }
        if (agent.auto_crm) { prospectToCrm(db, id); out.crm++; }
        if (agent.auto_outreach) { await outreachForProspect(db, id, env); out.outreach++; }
      } catch (e) { out.errors.push(`${p.name}: ${e.message}`); }
    }
  } catch (e) { out.errors.push(e.message); }
  db.prepare('UPDATE prospect_agents SET last_result = ? WHERE id = ?').run(JSON.stringify({ ...out, at: started }), agent.id);
  return out;
}

export async function runDueAgents(db, env = process.env, now = new Date()) {
  for (const a of db.prepare('SELECT * FROM prospect_agents WHERE active = 1').all()) {
    if (agentDue(a, now)) await runAgent(db, a, env);
  }
}
