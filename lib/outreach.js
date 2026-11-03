// Entwurf für die Erstansprache eines Interessenten – mit Claude (optional) oder als Vorlage
const fmtPct = (n) => (n == null ? '–' : `${n} %`);

function findings(audit) {
  const cats = audit?.result?.categories || [];
  return cats.flatMap((c) => c.checks.filter((k) => k.ok === false).map((k) => ({ area: c.name, label: k.label, detail: k.detail, tip: k.tip })));
}

export function templateOutreach({ prospect, audit, settings, reportUrl }) {
  const f = findings(audit).slice(0, 3);
  const agency = settings.agency_name || 'unsere Agentur';
  const sender = [settings.agency_name, settings.agency_phone, settings.agency_email, settings.agency_website].filter(Boolean).join('\n');
  const subject = prospect.website ? `Kurzer Online-Check für ${prospect.name}` : `${prospect.name} – mehr Anfragen über Google`;
  const intro = prospect.website
    ? `wir haben uns die Online-Präsenz von ${prospect.name} angesehen${audit ? ` – Gesamtwertung: ${fmtPct(audit.score)}` : ''}. Dabei sind uns ein paar Punkte aufgefallen, mit denen Sie vermutlich schnell mehr Anfragen gewinnen:`
    : `bei der Suche nach ${prospect.category || 'Ihrer Branche'} in Ihrer Region sind wir auf ${prospect.name} gestoßen${prospect.rating ? ` – mit ${String(prospect.rating).replace('.', ',')} Sternen bei ${prospect.review_count} Bewertungen` : ''}. Uns ist aufgefallen, dass Sie noch keine eigene Website haben. Damit gehen Ihnen Kunden verloren, die Sie über Google suchen.`;
  const list = f.length ? '\n\n' + f.map((x) => `• ${x.label}: ${x.tip || x.detail}`).join('\n') : '';
  const body = `Guten Tag,\n\n${intro}${list}\n\n${reportUrl ? `Den vollständigen Bericht finden Sie hier: ${reportUrl}\n\n` : ''}Wenn Sie möchten, gehen wir die Ergebnisse in einem kurzen, unverbindlichen Gespräch (15 Minuten) gemeinsam durch.\n\nViele Grüße\n${sender || agency}`;
  return { subject, body, generator: 'Vorlage' };
}

export async function draftOutreach(ctx, env = process.env) {
  if (!env.ANTHROPIC_API_KEY) return templateOutreach(ctx);
  let Anthropic;
  try { ({ default: Anthropic } = await import('@anthropic-ai/sdk')); } catch {
    return { ...templateOutreach(ctx), note: 'Paket @anthropic-ai/sdk fehlt (npm install) – Vorlage verwendet.' };
  }
  const { prospect, audit, settings, reportUrl } = ctx;
  const facts = {
    unternehmen: prospect.name, branche: prospect.category || audit?.industry || '', ort: prospect.address,
    website: prospect.website || 'keine', google_bewertung: prospect.rating, anzahl_bewertungen: prospect.review_count,
    gesamtwertung: audit?.score ?? null, schwachstellen: findings(audit).slice(0, 8), berichtslink: reportUrl || null,
  };
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  try {
    const msg = await client.beta.messages.create({
      model: env.ANTHROPIC_MODEL || 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      system: `Du schreibst für die Webagentur „${settings.agency_name || 'Webagentur'}“ kurze, persönliche Erstanschreiben an lokale Unternehmen in Deutschland. Ton: freundlich, auf Augenhöhe, konkret, kein Marketing-Sprech, keine Übertreibungen, Sie-Form. Höchstens 140 Wörter. Nenne zwei bis drei konkrete Beobachtungen aus den Daten und was der Nutzen einer Verbesserung wäre. Erfinde keine Fakten, Zahlen oder Namen von Ansprechpartnern. Schließe mit dem Angebot eines kurzen, unverbindlichen Gesprächs und dieser Signatur:\n${[settings.agency_name, settings.agency_phone, settings.agency_email, settings.agency_website].filter(Boolean).join('\n')}\nAntworte exakt im Format:\nBETREFF: <Betreffzeile>\n\n<E-Mail-Text>`,
      messages: [{ role: 'user', content: `Daten zum Interessenten (JSON):\n${JSON.stringify(facts, null, 2)}` }],
    });
    if (msg.stop_reason === 'refusal') return { ...templateOutreach(ctx), note: 'KI hat abgelehnt – Vorlage verwendet.' };
    const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    const m = text.match(/^BETREFF:\s*(.+)\n+([\s\S]+)$/);
    return m ? { subject: m[1].trim(), body: m[2].trim(), generator: `KI (${msg.model})` } : { subject: templateOutreach(ctx).subject, body: text, generator: `KI (${msg.model})` };
  } catch (e) {
    return { ...templateOutreach(ctx), note: `KI nicht erreichbar (${e.status || ''} ${e.message}) – Vorlage verwendet.` };
  }
}
