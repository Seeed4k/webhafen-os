import { parseJSON, localStamp } from './util.js';

export const PLATFORMS = {
  facebook: 'Facebook', instagram: 'Instagram', linkedin: 'LinkedIn', tiktok: 'TikTok', youtube: 'YouTube',
  pinterest: 'Pinterest', threads: 'Threads', bluesky: 'Bluesky', gbp: 'Google Unternehmensprofil', x: 'X', community: 'Community',
};

// Bluesky: echte Veröffentlichung über die offene AT-Protocol-API (Handle + App-Passwort)
async function postBluesky(acc, post) {
  const base = 'https://bsky.social/xrpc';
  const s = await fetch(`${base}/com.atproto.server.createSession`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: acc.handle, password: acc.secret }),
  });
  if (!s.ok) throw new Error(`Bluesky-Login fehlgeschlagen (${s.status})`);
  const { accessJwt, did } = await s.json();
  let text = post.content;
  if (post.link && !text.includes(post.link)) text += `\n${post.link}`;
  text = [...text].slice(0, 300).join('');
  const record = { $type: 'app.bsky.feed.post', text, createdAt: new Date().toISOString() };
  // Links klickbar machen (Facets)
  const enc = new TextEncoder(); const facets = [];
  for (const m of text.matchAll(/https?:\/\/[^\s]+/g)) {
    const byteStart = enc.encode(text.slice(0, m.index)).length;
    facets.push({ index: { byteStart, byteEnd: byteStart + enc.encode(m[0]).length }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: m[0] }] });
  }
  if (facets.length) record.facets = facets;
  const r = await fetch(`${base}/com.atproto.repo.createRecord`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${accessJwt}` },
    body: JSON.stringify({ repo: did, collection: 'app.bsky.feed.post', record }),
  });
  if (!r.ok) throw new Error(`Bluesky-Post fehlgeschlagen (${r.status})`);
  return 'Auf Bluesky veröffentlicht';
}

// Webhook: Make / Zapier / n8n / eigenes Skript übernimmt die Veröffentlichung
async function postWebhook(acc, post) {
  const r = await fetch(acc.webhook_url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      platform: acc.platform, account: acc.name, post_id: post.id,
      content: post.content, media_url: post.media_url || null, link: post.link || null, sent_at: new Date().toISOString(),
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`Webhook antwortete mit ${r.status}`);
  return `An Webhook übergeben (${r.status})`;
}

export async function publishPost(db, post, { keepStatus = false } = {}) {
  const ids = parseJSON(post.account_ids, []);
  const accounts = ids.length ? db.prepare(`SELECT * FROM social_accounts WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) : [];
  const log = db.prepare('INSERT INTO post_log (post_id, account_id, ok, message) VALUES (?,?,?,?)');
  let failed = 0; let manual = 0; const errors = [];
  if (!accounts.length) { errors.push('Keine Konten ausgewählt'); failed++; }
  for (const acc of accounts) {
    try {
      let msg;
      if (acc.platform === 'bluesky' && acc.handle && acc.secret) msg = await postBluesky(acc, post);
      else if (acc.webhook_url) msg = await postWebhook(acc, post);
      else { manual++; msg = 'Kein Webhook hinterlegt – bitte manuell posten'; }
      log.run(post.id, acc.id, 1, msg);
    } catch (e) {
      failed++; errors.push(`${acc.name}: ${e.message}`); log.run(post.id, acc.id, 0, e.message);
    }
  }
  const status = keepStatus ? post.status : failed ? 'failed' : manual ? 'manual' : 'published';
  db.prepare(`UPDATE posts SET status = ?, last_error = ?, publish_count = publish_count + 1, published_at = datetime('now','localtime') WHERE id = ?`)
    .run(status, errors.join(' | ') || null, post.id);
  return { status, errors };
}

const slotDue = (days, time, lastRun, now) => {
  const today = localStamp(now).slice(0, 10);
  const hm = localStamp(now).slice(11);
  return days.includes(now.getDay()) && hm >= time && (!lastRun || lastRun.slice(0, 10) !== today);
};

export async function runScheduler(db, now = new Date()) {
  const stamp = localStamp(now);
  // 1) Einmalig geplante Beiträge
  for (const p of db.prepare(`SELECT * FROM posts WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ?`).all(stamp)) {
    await publishPost(db, p);
  }
  // 2) Wiederkehrende Beiträge
  for (const p of db.prepare(`SELECT * FROM posts WHERE status = 'recurring'`).all()) {
    const r = parseJSON(p.recurrence, null);
    if (r && slotDue(r.days || [], r.time || '09:00', p.last_run, now)) {
      db.prepare('UPDATE posts SET last_run = ? WHERE id = ?').run(stamp, p.id);
      await publishPost(db, p, { keepStatus: true });
    }
  }
  // 3) Evergreen-Warteschlangen: ältester (am längsten nicht geposteter) Beitrag der Kategorie
  for (const c of db.prepare('SELECT * FROM social_categories WHERE active = 1').all()) {
    if (!slotDue(parseJSON(c.days, []), c.time, c.last_run, now)) continue;
    db.prepare('UPDATE social_categories SET last_run = ? WHERE id = ?').run(stamp, c.id);
    const p = db.prepare(`SELECT * FROM posts WHERE category_id = ? AND status = 'evergreen' ORDER BY COALESCE(published_at, '0000') ASC, id ASC LIMIT 1`).get(c.id);
    if (p) await publishPost(db, { ...p, account_ids: c.account_ids }, { keepStatus: true });
  }
}

// --- RSS / Atom ---
const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim()
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'") : '';
};
export function parseFeed(xml) {
  const items = [...xml.matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  return items.map((it) => {
    let link = tag(it, 'link');
    if (!link) { const l = it.match(/<link[^>]*href="([^"]+)"/i); link = l ? l[1] : ''; }
    const guid = tag(it, 'guid') || tag(it, 'id') || link;
    const img = (it.match(/<(?:media:content|media:thumbnail|enclosure)[^>]*url="([^"]+)"/i) || [])[1] || '';
    return { title: tag(it, 'title'), link, guid, summary: tag(it, 'description') || tag(it, 'summary'), image: img };
  });
}

export async function checkFeed(db, feed) {
  try {
    const r = await fetch(feed.url, { signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'WebhafenOS/1.0 (RSS)' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const items = parseFeed(await r.text());
    const seen = new Set(parseJSON(feed.seen, []));
    const firstRun = !feed.last_checked;
    let created = 0;
    for (const it of items.slice(0, 20).reverse()) {
      if (seen.has(it.guid)) continue;
      seen.add(it.guid);
      if (firstRun) continue; // Beim ersten Abruf nur merken, nicht alte Artikel posten
      const content = (feed.template || '{title}\n\n{link}').replace(/\{title\}/g, it.title).replace(/\{link\}/g, it.link).replace(/\{summary\}/g, it.summary.slice(0, 280));
      const status = feed.mode === 'auto' ? 'scheduled' : 'draft';
      db.prepare(`INSERT INTO posts (content, media_url, link, account_ids, scheduled_at, status, source) VALUES (?,?,?,?,?,?,?)`)
        .run(content, it.image, it.link, feed.account_ids, status === 'scheduled' ? localStamp() : null, status, `RSS: ${feed.name || feed.url}`);
      created++;
    }
    db.prepare(`UPDATE rss_feeds SET seen = ?, last_checked = datetime('now','localtime'), last_error = NULL WHERE id = ?`).run(JSON.stringify([...seen].slice(-500)), feed.id);
    return { created, items: items.length, firstRun };
  } catch (e) {
    db.prepare(`UPDATE rss_feeds SET last_checked = datetime('now','localtime'), last_error = ? WHERE id = ?`).run(e.message, feed.id);
    return { error: e.message };
  }
}
