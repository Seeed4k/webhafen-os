// Website-/Marketing-Audit für Interessenten (Prospecting)
const UA = 'Mozilla/5.0 (compatible; WebhafenOS/1.0; +https://web-hafen.de)';

const has = (html, ...res) => res.some((r) => r.test(html));

export const CHAT_WIDGETS = [
  ['Tawk.to', /embed\.tawk\.to/i], ['Crisp', /client\.crisp\.chat/i], ['Intercom', /widget\.intercom\.io|intercomSettings/i],
  ['Tidio', /code\.tidio\.co/i], ['HubSpot Chat', /js\.hs-scripts\.com|hubspot.*conversations/i], ['Zendesk', /static\.zdassets\.com/i],
  ['LiveChat', /cdn\.livechatinc\.com/i], ['Userlike', /userlike/i], ['Smartsupp', /smartsuppchat/i], ['Drift', /js\.driftt\.com/i],
  ['Chatwoot', /chatwoot/i], ['LeadConnector', /leadconnectorhq|msgsndr/i], ['WhatsApp-Button', /wa\.me\/|api\.whatsapp\.com\/send/i],
  ['Facebook Messenger', /connect\.facebook\.net\/[^"']*\/sdk\/xfbml\.customerchat/i], ['Brevo Chat', /conversations-widget\.brevo\.com|sibautomation/i],
];
export const CMS = [
  ['WordPress', /wp-content|wp-includes/i], ['Wix', /static\.wixstatic\.com|wix\.com/i], ['Jimdo', /jimdo/i],
  ['Shopify', /cdn\.shopify\.com/i], ['Squarespace', /squarespace/i], ['Webflow', /webflow/i], ['TYPO3', /typo3/i],
  ['Joomla', /\/media\/jui\/|joomla/i], ['IONOS MyWebsite', /ionos|mywebsite-editor|website-editor\.net/i], ['Contao', /contao/i],
  ['Drupal', /drupal/i], ['Shopware', /shopware/i], ['Astro', /astro-island|_astro\//i], ['Next.js', /__NEXT_DATA__|_next\/static/i],
  ['LeadConnector', /leadconnectorhq|msgsndr/i], ['Strato Sitebuilder', /strato/i],
];
const CONSENT = [/cookiebot/i, /usercentrics/i, /borlabs/i, /complianz/i, /cookieyes/i, /onetrust/i, /consentmanager/i, /klaro/i, /ccm19/i, /real-cookie-banner/i, /cookie-?consent/i, /cookie-?banner/i];

// Homepage-Baukästen: meist langsam, schlecht auffindbar – ein gutes Verkaufsargument
const BUILDERS = ['Wix', 'Jimdo', 'IONOS MyWebsite', 'Strato Sitebuilder', 'Squarespace'];

// Schnellprüfung für die Ergebnisliste im Lead-Finder (eine Anfrage, max. 8 s)
export async function quickSiteCheck(rawUrl) {
  let url;
  try { url = normalizeUrl(rawUrl); } catch (e) { return { reachable: false, error: e.message }; }
  try {
    const { r, body, ms } = await fetchTimed(url, { signal: AbortSignal.timeout(8000) });
    const html = body.slice(0, 600000);
    const final = r.url || url;
    const cms = CMS.filter(([, re]) => re.test(html)).map(([n]) => n);
    return {
      reachable: r.ok, status: r.status, final_url: final, https: final.startsWith('https://'), ms,
      cms, builder: cms.some((c) => BUILDERS.includes(c)),
      viewport: /<meta[^>]+name=["']viewport["']/i.test(html),
      analytics: /googletagmanager\.com\/(gtag|gtm)|google-analytics\.com|GTM-[A-Z0-9]{4,}/i.test(html),
      pixel: /fbevents\.js|fbq\(['"]init/i.test(html),
      chat: CHAT_WIDGETS.filter(([, re]) => re.test(html)).map(([n]) => n),
      title: (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.trim().slice(0, 120) || '',
    };
  } catch (e) {
    return { reachable: false, error: e.name === 'TimeoutError' ? 'Zeitüberschreitung' : e.cause?.code || e.message };
  }
}

async function fetchTimed(url, opts = {}) {
  const t0 = performance.now();
  const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000), headers: { 'user-agent': UA, accept: 'text/html,*/*' }, ...opts });
  const body = await r.text();
  return { r, body, ms: Math.round(performance.now() - t0) };
}

const check = (label, ok, detail, tip = '') => ({ label, ok, detail, tip });

function scoreOf(checks) {
  const rel = checks.filter((c) => c.ok !== null);
  return rel.length ? Math.round((rel.filter((c) => c.ok).length / rel.length) * 100) : null;
}

export function normalizeUrl(u) {
  u = String(u || '').trim();
  if (!u) throw new Error('Bitte eine Website-Adresse angeben');
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  const parsed = new URL(u);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Nur http/https erlaubt');
  // Schutz vor Abfragen interner Adressen (SSRF)
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$)/i.test(parsed.hostname)) throw new Error('Interne Adressen sind nicht erlaubt');
  return parsed.toString();
}

export function analyzeHtml(html, { url, headers = {}, ms = 0, httpRedirectsToHttps = null, robots = null, sitemap = null, phone = '' }) {
  const lower = html.toLowerCase();
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.trim() || '';
  const metaDesc = (html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i) || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i) || [])[1] || '';
  const h1 = (html.match(/<h1[\s>]/gi) || []).length;
  const imgs = html.match(/<img\b[^>]*>/gi) || [];
  const imgsNoAlt = imgs.filter((i) => !/\balt=["'][^"']+["']/i.test(i)).length;
  const scripts = (html.match(/<script\b/gi) || []).length;
  const sizeKb = Math.round(Buffer.byteLength(html) / 1024);
  const isHttps = url.startsWith('https://');
  const chat = CHAT_WIDGETS.filter(([, r]) => r.test(html)).map(([n]) => n);
  const cms = CMS.filter(([, r]) => r.test(html)).map(([n]) => n);
  const generator = (html.match(/<meta[^>]+name=["']generator["'][^>]*content=["']([^"']+)["']/i) || [])[1];
  const telLinks = (html.match(/href=["']tel:/gi) || []).length;
  const digits = (s) => s.replace(/\D/g, '').replace(/^0049|^49/, '0');
  const phoneOnPage = phone ? digits(html).includes(digits(phone).slice(-7)) : null;
  const mailVisible = /mailto:|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(html);
  const localBusiness = /"@type"\s*:\s*"(LocalBusiness|Organization|[A-Za-z]*(Store|School|Business|Service|Restaurant|Dentist|Physician|Attorney))"/i.test(html);
  const mobileNumber = phone ? /^(\+?49|0)1[5-7]/.test(phone.replace(/[\s/()-]/g, '')) : null;

  const categories = [
    {
      key: 'business', name: 'Unternehmensangaben',
      description: 'Wichtige Kontakt- und Pflichtangaben, über die Kunden Ihr Unternehmen erreichen und ihm vertrauen.',
      checks: [
        check('Chat-Widget auf der Website', chat.length > 0, chat.length ? `Gefunden: ${chat.join(', ')}` : 'Auf der Website ist kein Chat-Widget aktiv.', 'Ein Chat- oder WhatsApp-Button senkt die Hürde für Anfragen deutlich – viele Besucher schreiben lieber, als anzurufen.'),
        check('Klickbare Telefonnummer', telLinks > 0, telLinks ? `${telLinks} tel:-Link(s) gefunden` : 'Keine klickbare Telefonnummer gefunden.', 'Auf dem Smartphone sollte ein Tipp auf die Nummer direkt den Anruf starten (tel:-Link).'),
        check('Nachrichtenfähige Nummer (Mobil/WhatsApp)', mobileNumber === null ? null : mobileNumber || /wa\.me|whatsapp/i.test(html), mobileNumber === null ? 'Keine Telefonnummer angegeben' : mobileNumber ? 'Mobilnummer – per SMS/WhatsApp erreichbar' : 'Festnetznummer – keine Nachrichten per SMS/WhatsApp möglich.', 'Die meisten Menschen schreiben Unternehmen lieber eine Nachricht. WhatsApp Business oder eine SMS-fähige Nummer anbieten.'),
        check('Telefonnummer auf der Website', phoneOnPage, phoneOnPage === null ? 'Keine Vergleichsnummer angegeben' : phoneOnPage ? 'Die Telefonnummer steht auf der Startseite.' : 'Die angegebene Telefonnummer steht nicht auf der Startseite.', 'Name, Adresse und Telefonnummer sollten überall identisch sein (NAP-Konsistenz) – wichtig für lokales SEO.'),
        check('E-Mail-Adresse sichtbar', mailVisible, mailVisible ? 'E-Mail-Adresse oder mailto-Link gefunden' : 'Keine E-Mail-Adresse auf der Startseite.'),
        check('Impressum verlinkt', /impressum|imprint/i.test(lower), /impressum|imprint/i.test(lower) ? 'Impressum-Link gefunden' : 'Kein Impressum-Link auf der Startseite gefunden.', 'In Deutschland Pflicht (§ 5 DDG). Fehlt es, drohen Abmahnungen.'),
        check('Datenschutzerklärung verlinkt', /datenschutz|privacy/i.test(lower), /datenschutz|privacy/i.test(lower) ? 'Datenschutz-Link gefunden' : 'Kein Datenschutz-Link gefunden.', 'Pflicht nach DSGVO.'),
        check('Strukturierte Unternehmensdaten (Schema.org)', localBusiness, localBusiness ? 'LocalBusiness/Organization-Markup vorhanden' : 'Keine strukturierten Unternehmensdaten gefunden.', 'Schema.org-Markup hilft Google, Öffnungszeiten, Adresse und Bewertungen korrekt anzuzeigen.'),
      ],
    },
    {
      key: 'tech', name: 'Technologie-Stack',
      description: 'Grundlegende Werkzeuge, um Marketing-Erfolg zu messen und Zielgruppen gezielt anzusprechen.',
      checks: [
        check('Google Analytics', has(html, /gtag\(['"]config['"],\s*['"]G-/i, /googletagmanager\.com\/gtag\/js\?id=G-/i, /google-analytics\.com\/(analytics|ga)\.js/i), null, 'Ohne Analytics fehlen Informationen über Besucher, Quellen und das Verhalten auf der Seite.'),
        check('Google Tag Manager', has(html, /googletagmanager\.com\/gtm\.js/i, /GTM-[A-Z0-9]{4,}/), null, 'Der Tag Manager bündelt alle Tracking-Codes und macht Änderungen ohne Entwickler möglich.'),
        check('Google-Ads-Conversion-Tracking', has(html, /AW-\d{6,}/, /googleadservices\.com/i), null, 'Ohne Conversion-Tracking lässt sich der Erfolg von Google-Ads-Kampagnen nicht messen.'),
        check('Meta-Pixel', has(html, /connect\.facebook\.net\/[^"']*\/fbevents\.js/i, /fbq\(['"]init['"]/i), null, 'Das Meta-Pixel ist Voraussetzung, um Facebook-/Instagram-Werbung zu optimieren und Retargeting zu nutzen.'),
        check('Cookie-Einwilligung (Consent-Tool)', has(html, ...CONSENT), null, 'Wer Tracking einsetzt, braucht in der EU eine Einwilligungs-Abfrage (TTDSG/DSGVO).'),
      ].map((c) => ({ ...c, detail: c.detail ?? (c.ok ? 'Auf der Website erkannt.' : 'Auf der Website nicht erkannt.') })),
    },
    {
      key: 'seo', name: 'SEO-Grundlagen',
      description: 'Technische Grundlagen, damit Google die Seite versteht und gut darstellt.',
      checks: [
        check('Seitentitel', title.length >= 10 && title.length <= 65, title ? `„${title.slice(0, 80)}“ (${title.length} Zeichen)` : 'Kein Seitentitel vorhanden.', 'Ideal sind 30–65 Zeichen mit Leistung und Ort, z. B. „Fahrschule in Haren (Ems) – Neehoff“.'),
        check('Meta-Beschreibung', metaDesc.length >= 50 && metaDesc.length <= 170, metaDesc ? `${metaDesc.length} Zeichen` : 'Keine Meta-Beschreibung vorhanden.', 'Die Beschreibung erscheint in den Google-Ergebnissen – 120–160 Zeichen mit Handlungsaufforderung.'),
        check('Genau eine H1-Überschrift', h1 === 1, `${h1} H1-Überschrift(en) gefunden`),
        check('Mobil-optimiert (Viewport)', /<meta[^>]+name=["']viewport["']/i.test(html), null, 'Ohne Viewport-Angabe wird die Seite auf Smartphones verkleinert dargestellt.'),
        check('Bilder mit Alternativtext', imgs.length === 0 ? null : imgsNoAlt / imgs.length <= 0.2, `${imgs.length - imgsNoAlt} von ${imgs.length} Bildern haben einen Alt-Text`),
        check('Sprachangabe (lang)', /<html[^>]+lang=/i.test(html), null),
        check('Canonical-Tag', /<link[^>]+rel=["']canonical["']/i.test(html), null),
        check('Social-Vorschau (Open Graph)', /property=["']og:(title|image)["']/i.test(html), null, 'Open-Graph-Tags sorgen für eine schöne Vorschau, wenn die Seite auf Facebook, WhatsApp oder LinkedIn geteilt wird.'),
        check('robots.txt', robots, robots === null ? 'Nicht geprüft' : robots ? 'Vorhanden' : 'Nicht gefunden'),
        check('XML-Sitemap', sitemap, sitemap === null ? 'Nicht geprüft' : sitemap ? 'Vorhanden' : 'Nicht gefunden', 'Eine Sitemap hilft Google, alle Unterseiten zu finden.'),
      ].map((c) => ({ ...c, detail: c.detail ?? (c.ok ? 'Vorhanden' : 'Fehlt') })),
    },
    {
      key: 'performance', name: 'Website-Performance & Sicherheit',
      description: 'Ladezeit, Verschlüsselung und technischer Zustand der Website.',
      checks: [
        check('HTTPS-Verschlüsselung', isHttps, isHttps ? 'Die Seite wird verschlüsselt ausgeliefert.' : 'Die Seite ist nicht verschlüsselt.', 'Browser warnen bei unverschlüsselten Seiten – das kostet Vertrauen und Rankings.'),
        check('Weiterleitung von http auf https', httpRedirectsToHttps, httpRedirectsToHttps === null ? 'Nicht geprüft' : httpRedirectsToHttps ? 'http:// leitet auf https:// weiter' : 'http:// leitet nicht auf https:// weiter'),
        check('Server-Antwortzeit', ms < 1500, `${ms} ms bis die Startseite geladen war`, 'Unter 0,8 s ist gut, über 1,5 s wirkt die Seite träge.'),
        check('Seitengröße (HTML)', sizeKb < 300, `${sizeKb} KB HTML`),
        check('Anzahl Skripte', scripts <= 25, `${scripts} Skript-Einbindungen`, 'Viele Skripte verlangsamen den Seitenaufbau, besonders auf dem Smartphone.'),
        check('Sicherheits-Header (HSTS)', !!headers['strict-transport-security'], headers['strict-transport-security'] ? 'HSTS aktiv' : 'Kein HSTS-Header gesetzt'),
        check('Kein gemischter Inhalt', isHttps ? !/(src|href)=["']http:\/\/(?!localhost)[^"']+\.(js|css|png|jpe?g|gif|webp|svg)/i.test(html) : null, null),
      ].map((c) => ({ ...c, detail: c.detail ?? (c.ok ? 'In Ordnung' : 'Unverschlüsselte Ressourcen auf einer HTTPS-Seite gefunden') })),
    },
  ];
  return { categories, meta: { title, metaDesc, cms: generator ? [generator, ...cms] : cms, chat, sizeKb, ms, scripts, htmlDigits: html.replace(/\D/g, '') } };
}

async function pageSpeed(url, strategy, key) {
  const q = new URLSearchParams({ url, strategy });
  for (const c of ['performance', 'seo', 'accessibility', 'best-practices']) q.append('category', c);
  if (key) q.set('key', key);
  const r = await fetch(`${process.env.PAGESPEED_BASE_URL || 'https://www.googleapis.com/pagespeedonline/v5'}/runPagespeed?${q}`, { signal: AbortSignal.timeout(90000) });
  if (!r.ok) throw new Error(`PageSpeed ${r.status}${r.status === 429 ? ' (Kontingent erschöpft – PAGESPEED_API_KEY setzen)' : ''}`);
  const j = await r.json();
  const lh = j.lighthouseResult || {}; const a = lh.audits || {};
  const cat = (k) => Math.round((lh.categories?.[k]?.score ?? 0) * 100);
  const m = (k) => ({ value: a[k]?.displayValue || '–', score: Math.round((a[k]?.score ?? 0) * 100), ms: a[k]?.numericValue ?? null });
  // Einzelprüfungen zählen wie im Lighthouse-Bericht
  let failed = 0; let warn = 0; let passed = 0; const issues = [];
  for (const x of Object.values(a)) {
    if (!['numeric', 'binary'].includes(x.scoreDisplayMode) || x.score == null) continue;
    if (x.score >= 0.9) passed++; else if (x.score >= 0.5) warn++; else { failed++; if (issues.length < 8) issues.push(x.title); }
  }
  return {
    performance: cat('performance'), seo: cat('seo'), accessibility: cat('accessibility'), best_practices: cat('best-practices'),
    fcp: m('first-contentful-paint'), lcp: m('largest-contentful-paint'), tbt: m('total-blocking-time'), cls: m('cumulative-layout-shift'), si: m('speed-index'),
    failed, warn, passed, issues,
  };
}

const daysSince = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 864e5 : null);

function placeCategories(pl, finalUrl, ranking) {
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const cats = [];
  cats.push({
    key: 'gbp', name: 'Google-Unternehmensprofil',
    description: 'Ein vollständiges, aktives Google-Profil ist der wichtigste Faktor, um vor Ort gefunden zu werden.',
    checks: pl ? [
      check('Profil aktiv und sichtbar', pl.status === 'OPERATIONAL' || !pl.status, pl.status === 'OPERATIONAL' || !pl.status ? 'Das Profil ist aktiv und für Kunden sichtbar.' : `Status: ${pl.status}`),
      check('Geschäftsadresse hinterlegt', !!pl.address, pl.address || 'Keine Adresse'),
      check('Website im Profil hinterlegt', finalUrl ? !!pl.website && hostOf(pl.website) === hostOf(finalUrl) : !!pl.website, pl.website || 'Keine Website hinterlegt', 'Die eigene Website gehört ins Profil – sonst landen Interessenten bei Verzeichnissen oder der Konkurrenz.'),
      check('Telefonnummer im Profil', !!pl.phone, pl.phone || 'Keine Telefonnummer'),
      check('Öffnungszeiten gepflegt', pl.has_hours, pl.has_hours ? 'Vorhanden' : 'Fehlen', 'Fehlende Öffnungszeiten kosten Vertrauen – Google zeigt dann „Öffnungszeiten unbekannt“.'),
      check('Mindestens 10 Fotos', pl.photos >= 10, `${pl.photos} Fotos gefunden (Google liefert max. 10)`, 'Profile mit vielen aktuellen Fotos erhalten deutlich mehr Anfragen und Routenplanungen.'),
    ] : [check('Profil gefunden', false, 'Kein Google-Unternehmensprofil gefunden.', 'Ein eigenes Google-Unternehmensprofil anlegen und verifizieren – kostenlos und sehr wirksam.')],
  });
  if (pl) {
    const rv = pl.reviews || [];
    const neg = rv.filter((r) => r.rating <= 2).length;
    const newest = rv.map((r) => daysSince(r.published)).filter((d) => d != null).sort((a, b) => a - b)[0];
    cats.push({
      key: 'reputation', name: 'Online-Ruf',
      description: 'Bewertungen sind für die meisten Kunden ausschlaggebend – Anzahl, Durchschnitt und Aktualität zählen.',
      checks: [
        check('Durchschnittsbewertung ≥ 4,5', (pl.rating || 0) >= 4.5, pl.rating ? `${String(pl.rating).replace('.', ',')} von 5 Sternen` : 'Noch keine Bewertungen', 'Zufriedene Kunden aktiv um eine Bewertung bitten – z. B. per QR-Code, Link in der Rechnung oder nach dem Termin.'),
        check('Mindestens 25 Bewertungen', pl.review_count >= 25, `${pl.review_count} Bewertungen bei Google`, 'Mehr Bewertungen = mehr Vertrauen und besseres Ranking in Google Maps.'),
        check('Aktuelle Bewertungen (letzte 90 Tage)', rv.length ? newest != null && newest <= 90 : null, newest != null ? `Neueste Bewertung: ${pl.reviews.find((r) => daysSince(r.published) === newest)?.when || Math.round(newest) + ' Tage'}` : 'Keine Bewertungen'),
        check('Kaum negative Bewertungen', rv.length ? neg / rv.length <= 0.2 : null, rv.length ? `${neg} von ${rv.length} aktuellen Bewertungen mit 1–2 Sternen` : 'Keine Bewertungen'),
      ],
    });
  }
  if (ranking) {
    cats.push({
      key: 'local', name: 'Lokale Sichtbarkeit',
      description: `So erscheint das Unternehmen in Google Maps, wenn jemand in der Nähe nach „${ranking.keyword}“ sucht.`,
      checks: [
        check(`Top 3 bei „${ranking.keyword}“`, ranking.rank != null && ranking.rank <= 3, ranking.rank ? `Platz ${ranking.rank} von ${ranking.results.length}` : `Nicht unter den ersten ${ranking.results.length} Treffern`, 'Nur die ersten 3 Treffer erscheinen im „Local Pack“ – dort landen die meisten Klicks.'),
        (() => { const comp = ranking.results.filter((x) => x.place_id !== pl?.place_id).map((x) => x.review_count); const med = median(comp);
          return check('Mehr Bewertungen als der Wettbewerb', comp.length ? (pl?.review_count || 0) >= med : null, `${pl?.review_count || 0} eigene Bewertungen · Median der Konkurrenz: ${med}`, 'Bewertungen sind einer der stärksten Ranking-Faktoren in Google Maps.'); })(),
      ],
    });
  }
  return cats;
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

export async function runAudit({ url, business_name, phone = '', address = '', place_id = '', industry = '' }, env = {}) {
  const notes = []; let res; let finalUrl = '';
  if (url) {
    url = normalizeUrl(url);
    const main = await fetchTimed(url);
    finalUrl = main.r.url || url;
    const headers = Object.fromEntries(main.r.headers);
    const origin = new URL(finalUrl).origin;
    const probe = async (u) => { try { const r = await fetch(u, { signal: AbortSignal.timeout(8000), headers: { 'user-agent': UA } }); return r.ok; } catch { return false; } };
    const [robots, sitemap, httpRedirectsToHttps] = await Promise.all([
      probe(origin + '/robots.txt'),
      probe(origin + '/sitemap.xml').then((ok) => ok || probe(origin + '/sitemap_index.xml')),
      (async () => {
        try { const r = await fetch(finalUrl.replace(/^https:/, 'http:'), { redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { 'user-agent': UA } });
          return r.status >= 300 && r.status < 400 && /^https:/i.test(r.headers.get('location') || ''); } catch { return null; }
      })(),
    ]);
    res = analyzeHtml(main.body, { url: finalUrl, headers, ms: main.ms, httpRedirectsToHttps, robots, sitemap, phone });

    // Google PageSpeed (mobil + Desktop); ohne Schlüssel nur mit kleinem Kontingent
    const [mob, desk] = await Promise.allSettled([pageSpeed(finalUrl, 'mobile', env.PAGESPEED_API_KEY), pageSpeed(finalUrl, 'desktop', env.PAGESPEED_API_KEY)]);
    if (mob.status === 'fulfilled' || desk.status === 'fulfilled') {
      res.meta.pagespeed = { mobile: mob.value || null, desktop: desk.value || null };
      const perf = res.categories.find((c) => c.key === 'performance').checks;
      if (desk.value) perf.unshift(check('PageSpeed Desktop ≥ 80', desk.value.performance >= 80, `${desk.value.performance}/100 · LCP ${desk.value.lcp.value}`));
      if (mob.value) perf.unshift(check('PageSpeed mobil ≥ 70', mob.value.performance >= 70, `${mob.value.performance}/100 · LCP ${mob.value.lcp.value} · CLS ${mob.value.cls.value} · TBT ${mob.value.tbt.value}`, 'Google bewertet langsame mobile Seiten schlechter. Bilder komprimieren, Skripte reduzieren, Caching aktivieren.'));
      const seo = res.categories.find((c) => c.key === 'seo').checks;
      if (mob.value) seo.unshift(check('Lighthouse-SEO-Wert ≥ 90', mob.value.seo >= 90, `${mob.value.seo}/100`));
    }
    for (const r of [mob, desk]) if (r.status === 'rejected') { notes.push(`PageSpeed nicht verfügbar: ${r.reason.message}`); break; }
  } else {
    // Unternehmen ohne eigene Website – der wichtigste Befund überhaupt
    res = { meta: { cms: [], chat: [] }, categories: [{
      key: 'website', name: 'Eigene Website', description: 'Ohne eigene Website fehlt der zentrale Anlaufpunkt für Kunden, Google und Werbung.',
      checks: [check('Eigene Website vorhanden', false, 'Für dieses Unternehmen ist keine Website hinterlegt.', 'Eine schnelle, mobil optimierte Website mit Kontaktmöglichkeit ist die Grundlage jeder Online-Sichtbarkeit.')],
    }] };
  }

  // Google-Profil, Online-Ruf und lokales Ranking (nur mit Places-Schlüssel)
  if (env.GOOGLE_PLACES_API_KEY) {
    try {
      const places = await import('./places.js');
      const pid = place_id || await places.findBusiness(business_name, address);
      const pl = pid ? await places.placeDetails(pid) : null;
      let ranking = null;
      if (pl?.lat != null) {
        const keyword = industry || pl.category || business_name;
        const rk = await places.rankAt({ keyword, lat: pl.lat, lng: pl.lng, placeId: pl.place_id, radiusM: 5000 });
        ranking = { keyword, rank: rk.rank, results: rk.results.slice(0, 10).map((x) => ({ place_id: x.place_id, name: x.name, rating: x.rating, review_count: x.review_count, photos: x.photos, maps_url: x.maps_url })) };
      }
      res.meta.place = pl; res.meta.ranking = ranking;
      res.categories.push(...placeCategories(pl, finalUrl, ranking));
      // NAP: Telefonnummer der Website = Telefonnummer im Google-Profil?
      if (pl?.phone && url) {
        const tail = pl.phone.replace(/\D/g, '').slice(-7);
        const biz = res.categories.find((c) => c.key === 'business');
        biz?.checks.push(check('Telefonnummer wie im Google-Profil', res.meta.htmlDigits?.includes(tail) ?? null, res.meta.htmlDigits?.includes(tail) ? 'Website und Google-Profil nennen dieselbe Nummer.' : `Die Nummer aus dem Google-Profil (${pl.phone}) steht nicht auf der Startseite.`, 'Name, Adresse und Telefonnummer sollten überall identisch sein (NAP-Konsistenz).'));
      }
    } catch (e) { notes.push(`Google-Daten nicht abrufbar: ${e.message}`); }
  } else notes.push('Google-Profil, Bewertungen und Ranking nicht geprüft (GOOGLE_PLACES_API_KEY fehlt).');

  delete res.meta.htmlDigits;
  for (const c of res.categories) c.score = scoreOf(c.checks);
  const scored = res.categories.filter((c) => c.score !== null);
  const score = Math.round(scored.reduce((a, c) => a + c.score, 0) / (scored.length || 1));
  return { url: finalUrl, score, categories: res.categories, meta: res.meta, notes, checked_at: new Date().toISOString() };
}
