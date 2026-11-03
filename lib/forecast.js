// Prognose-Berechnung für Opportunities
export function riskLevel(o) {
  if (!o.slip_count && !o.slip_days) return null;
  if (o.slip_count >= 2 || o.slip_days >= 14) return 'high';
  if (o.slip_days >= 7) return 'medium';
  return 'low';
}

export function forecast(db, pipelineId, today = new Date().toISOString().slice(0, 10)) {
  const where = pipelineId ? 'WHERE o.pipeline_id = ?' : '';
  const rows = db.prepare(`
    SELECT o.*, s.name AS stage_name, s.probability AS stage_probability, p.use_opp_probability
    FROM opportunities o JOIN pipelines p ON p.id = o.pipeline_id LEFT JOIN stages s ON s.id = o.stage_id
    ${where}`).all(...(pipelineId ? [pipelineId] : []));

  const prob = (o) => (o.use_opp_probability && o.probability != null ? o.probability : o.stage_probability ?? 0) / 100;
  const open = rows.filter((o) => o.status === 'open');
  const sum = (arr, f) => arr.reduce((a, o) => a + f(o), 0);

  const risk = { high: [], medium: [], low: [] };
  for (const o of open) { const r = riskLevel(o); if (r) risk[r].push(o); }
  const riskOut = Object.fromEntries(Object.entries(risk).map(([k, v]) => [k, { count: v.length, value: sum(v, (o) => o.value || 0), items: v.map((o) => ({ id: o.id, name: o.name })) }]));

  const quality = {
    missing_close_date: open.filter((o) => !o.close_date).length,
    missing_value: open.filter((o) => !o.value).length,
    overdue: open.filter((o) => o.close_date && o.close_date < today).length,
  };

  const byStatus = ['open', 'won', 'lost', 'abandoned'].map((st) => {
    const g = rows.filter((o) => o.status === st);
    return {
      key: st, count: g.length,
      max_potential: sum(g, (o) => o.value || 0),
      expected: st === 'open' ? sum(g, (o) => (o.value || 0) * prob(o)) : null,
      won: st === 'won' ? sum(g, (o) => o.value || 0) : 0,
    };
  });

  const stageRows = pipelineId ? db.prepare('SELECT * FROM stages WHERE pipeline_id = ? ORDER BY position').all(pipelineId) : [];
  const byStage = stageRows.map((s) => {
    const g = open.filter((o) => o.stage_id === s.id);
    return { key: s.name, count: g.length, max_potential: sum(g, (o) => o.value || 0), expected: sum(g, (o) => (o.value || 0) * prob(o)), won: 0 };
  });

  // Zeitachse: erwartete Einnahmen je Monat (nach erwartetem Abschlussdatum)
  const months = {};
  for (const o of open) {
    if (!o.close_date) continue;
    const m = o.close_date.slice(0, 7);
    months[m] ??= { month: m, expected: 0, max_potential: 0, count: 0 };
    months[m].expected += (o.value || 0) * prob(o); months[m].max_potential += o.value || 0; months[m].count++;
  }
  for (const o of rows.filter((o) => o.status === 'won' && o.closed_at)) {
    const m = o.closed_at.slice(0, 7);
    months[m] ??= { month: m, expected: 0, max_potential: 0, count: 0 };
    months[m].won = (months[m].won || 0) + (o.value || 0);
  }

  return {
    totals: {
      max_potential: sum(open, (o) => o.value || 0),
      expected: sum(open, (o) => (o.value || 0) * prob(o)),
      won: sum(rows.filter((o) => o.status === 'won'), (o) => o.value || 0),
      open_count: open.length,
    },
    risk: riskOut, quality, byStatus, byStage,
    timeline: Object.values(months).sort((a, b) => a.month.localeCompare(b.month)),
  };
}
