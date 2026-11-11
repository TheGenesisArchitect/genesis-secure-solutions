// Client email from the terminal, through genovus.io's ops endpoint (app/api/ops/client-emails): the same checks and
// outbox as the client page's Client email panel. Every email is previewed and approved by a person first.
//   node scripts/client-email.mjs list <client-slug> [--delivery]     what's scheduled, sent (Resend id) or failed
//   node scripts/client-email.mjs preview <email.json> [out.html]      render only (dry), nothing queued
//   node scripts/client-email.mjs schedule <email.json>                schedule it (after the person's yes)
//   node scripts/client-email.mjs cancel <outbox-id>                   stop one that hasn't gone out
// <email.json> = { "slug", "kind": "site_review" | "note", "to", "cc", "when": "YYYY-MM-DDTHH:MM" (Eastern), ... }
// The key lives outside the repo, in ~/.genovus/ops.env (GENOVUS_OPS_KEY=…, optional GENOVUS_OPS_URL); never printed.
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const env = Object.fromEntries(readFileSync(join(homedir(), '.genovus', 'ops.env'), 'utf8').split(/\r?\n/).filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const BASE = (env.GENOVUS_OPS_URL || 'https://genovus.io').replace(/\/$/, '') + '/api/ops/client-emails';
const call = async (method, qs = '', body) => {
  const res = await fetch(`${BASE}${qs}`, { method, headers: { Authorization: `Bearer ${env.GENOVUS_OPS_KEY}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { console.error(`${res.status}: ${j.error ?? 'failed'}`); process.exit(1); }
  return j;
};
const et = (iso) => iso ? new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: 'America/New_York' }) + ' ET' : '';
const [cmd, a, b] = process.argv.slice(2);

if (cmd === 'list') {
  const j = await call('GET', `?slug=${encodeURIComponent(a)}${process.argv.includes('--delivery') ? '&delivery=1' : ''}`);
  if (!j.emails.length) console.log('No client emails yet.');
  for (const e of j.emails) {
    console.log(`#${e.id} ${e.status.toUpperCase()}${e.test ? ' (test)' : ''}  ${e.subject}`);
    console.log(`   to ${e.to}${e.cc ? `, cc ${e.cc}` : ''}`);
    console.log(`   ${e.status === 'sent' ? `sent ${et(e.sentAt)}${e.providerId ? `, Resend id ${e.providerId}` : ' (before Resend ids were kept)'}${e.delivery ? `, ${e.delivery}` : ''}` : `send at ${et(e.sendAfter)}`}${e.error ? `  error: ${e.error}` : ''}${e.by ? `  by ${e.by}` : ''}`);
  }
} else if (cmd === 'preview' || cmd === 'schedule') {
  const body = JSON.parse(readFileSync(a, 'utf8'));
  const j = await call('POST', '', { ...body, dry: cmd === 'preview' });
  console.log(j.message);
  if (j.preview) {
    console.log(`subject: ${j.preview.subject}\nto: ${j.preview.to}\ncc: ${j.preview.cc.join(', ') || '(none)'}\nsend: ${et(j.preview.sendAt)}`);
    if (cmd === 'preview' && b) { writeFileSync(b, j.preview.html); console.log(`html: ${b}`); }
  }
  if (j.outboxId) console.log(`outbox id: ${j.outboxId}`);
} else if (cmd === 'cancel') {
  console.log((await call('DELETE', `?id=${encodeURIComponent(a)}`)).message);
} else {
  console.log('usage: list <slug> [--delivery] | preview <email.json> [out.html] | schedule <email.json> | cancel <id>');
}
