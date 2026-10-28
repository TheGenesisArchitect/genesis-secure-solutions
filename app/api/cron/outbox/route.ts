// Every minute: send due outbox emails. Rows are claimed before sending so two runs never send twice;
// failures retry with backoff and give up after five attempts. Each send is recorded in the audit log.
// Push alerts (templates lead_push, post_push) go out the same way, to the agency members' devices, even where email isn't set up.
import { adminDb } from '@/lib/supabase/admin';
import { emailConfigured, outboxEmail, sendEmail } from '@/lib/email';
import { cronAuthorized, siteOrigin } from '@/lib/cron';
import { PUSH_TEMPLATES, pushConfigured, sendLeadPush, sendPostPush } from '@/lib/push';
import { sendChecklistLinks } from '@/lib/client-checklist';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response('Unauthorized', { status: 401 });
  const email = emailConfigured(), push = pushConfigured();
  if (!email && !push) return Response.json({ skipped: 'email and push not configured' });
  const db = adminDb();
  // Clients whose deposit is paid get their setup checklist link (queued here, sent below with everything else).
  if (email) await sendChecklistLinks(siteOrigin()).catch((e) => console.error(`[checklist] ${e instanceof Error ? e.message : e}`));
  let q = db.from('outbox').select('id').eq('status', 'pending').lte('send_after', new Date().toISOString());
  if (!email) q = q.in('template', PUSH_TEMPLATES);
  if (!push) q = q.not('template', 'in', `(${PUSH_TEMPLATES.join(',')})`);
  const { data: due } = await q.order('id').limit(25);
  const ids = (due ?? []).map((r) => r.id);
  if (!ids.length) return Response.json({ sent: 0 });
  const { data: claimed } = await db.from('outbox').update({ status: 'sending' }).in('id', ids).eq('status', 'pending').select('*');
  const origin = siteOrigin();
  let sent = 0, failed = 0;
  for (const row of claimed ?? []) {
    if (PUSH_TEMPLATES.includes(row.template)) {
      const p = row.template === 'post_push' ? await sendPostPush(db, row.tenant_id, row.data as Record<string, string>) : await sendLeadPush(db, row.tenant_id, row.data as Record<string, string>);
      await db.from('outbox').update({ status: p.sent ? 'sent' : 'skipped', attempts: row.attempts + 1, sent_at: new Date().toISOString(), last_error: p.sent ? null : `no device took it (${p.gone} gone, ${p.failed} failed)` }).eq('id', row.id);
      if (p.sent) await db.from('audit_events').insert({ tenant_id: row.tenant_id, actor: null, actor_label: 'outbox', action: 'push.sent', subject: row.template, after: { devices: p.sent, outbox: row.id }, prev_hash: '', hash: '' });
      sent += p.sent ? 1 : 0;
      continue;
    }
    const mail = outboxEmail(row.template, row.to_email, row.data as Record<string, string>, origin);
    if (!mail) {
      await db.from('outbox').update({ status: 'skipped', last_error: 'unknown template' }).eq('id', row.id);
      continue;
    }
    const r = await sendEmail(mail);
    const attempts = row.attempts + 1;
    if (r.ok) {
      sent++;
      await db.from('outbox').update({ status: 'sent', attempts, sent_at: new Date().toISOString(), last_error: null }).eq('id', row.id);
      await db.from('audit_events').insert({ tenant_id: row.tenant_id, actor: null, actor_label: 'outbox', action: 'email.sent', subject: row.template, after: { to: row.to_email, outbox: row.id }, prev_hash: '', hash: '' });
    } else {
      failed++;
      const giveUp = attempts >= 5;
      await db.from('outbox').update({
        status: giveUp ? 'failed' : 'pending', attempts, last_error: r.error.slice(0, 500),
        send_after: new Date(Date.now() + 2 ** attempts * 60_000).toISOString(),
      }).eq('id', row.id);
    }
  }
  return Response.json({ sent, failed });
}
