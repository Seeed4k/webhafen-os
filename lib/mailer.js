// E-Mail-Versand über das eigene Postfach (z. B. IONOS: smtp.ionos.de, Port 587 STARTTLS oder 465 SSL)
import nodemailer from 'nodemailer';
import { getSettings } from './db.js';
import { esc } from './util.js';

export const outbox = []; // nur für Tests (MAIL_TRANSPORT=json)
let cache = { key: '', transport: null };

function transportFor(s) {
  if (process.env.MAIL_TRANSPORT === 'json') return nodemailer.createTransport({ jsonTransport: true });
  if (!s.smtp_host) return null;
  const port = Number(s.smtp_port) || 587;
  const secure = s.smtp_secure === 'ssl' || port === 465;
  const key = [s.smtp_host, port, secure, s.smtp_user, s.smtp_pass].join('|');
  if (cache.key !== key) {
    cache = { key, transport: nodemailer.createTransport({
      host: s.smtp_host, port, secure, requireTLS: !secure,
      auth: s.smtp_user ? { user: s.smtp_user, pass: s.smtp_pass || '' } : undefined,
      connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
    }) };
  }
  return cache.transport;
}

export const mailReady = (db) => process.env.MAIL_TRANSPORT === 'json' || !!getSettings(db).smtp_host;

// Schlichte HTML-Version: Absätze, klickbare Links, Signatur-Fuß
function toHtml(text, s) {
  const body = esc(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
  return `<!doctype html><html><body style="margin:0;background:#f4f6fb"><div style="max-width:600px;margin:0 auto;padding:24px;font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a">
<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px">${body}</div>
<p style="color:#64748b;font-size:12px;text-align:center">${esc([s.agency_name, s.agency_website, s.agency_phone].filter(Boolean).join(' · '))}</p></div></body></html>`;
}

export async function sendMail(db, { to, subject, text, ics, icsMethod = 'REQUEST', replyTo }) {
  const s = getSettings(db);
  const t = transportFor(s);
  if (!t) throw new Error('E-Mail-Versand ist nicht eingerichtet (Einstellungen → E-Mail-Versand)');
  const from = s.mail_from || (s.smtp_user ? `${s.agency_name || ''} <${s.smtp_user}>`.trim() : s.agency_email);
  if (!from) throw new Error('Kein Absender eingetragen (Einstellungen → E-Mail-Versand)');
  const info = await t.sendMail({
    from, to, subject, text, html: toHtml(text, s), replyTo: replyTo || s.agency_email || undefined,
    icalEvent: ics ? { method: icsMethod, filename: 'termin.ics', content: ics } : undefined,
  });
  if (process.env.MAIL_TRANSPORT === 'json') outbox.push({ ...JSON.parse(info.message), to, subject, text });
  return info;
}
