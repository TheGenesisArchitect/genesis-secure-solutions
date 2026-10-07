// Every minute: send due outbox emails. Rows are claimed before sending so two runs never send twice;
// failures retry with backoff and give up after five attempts. Each send is recorded in the audit log.
import { adminDb } from '@/lib/supabase/admin';
import { emailConfigured, outboxEmail, sendEmail } from '@/lib/email';
import { cronAuthorized, siteOrigin } from '@/lib/cron';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response('Unauthorized', { status: 401 });
  if (!emailConfigured()) return Response.json({ skipped: 'email not configured' });
  const db = adminDb();
  const { data: due } = await db.from('outbox').select('id').eq('status', 'pending').lte('send_after', new Date().toISOString()).order('id').limit(25);
  const ids = (due ?? []).map((r) => r.id);
  if (!ids.length) return Response.json({ sent: 0 });
  const { data: claimed } = await db.from('outbox').update({ status: 'sending' }).in('id', ids).eq('status', 'pending').select('*');
  const origin = siteOrigin();
  let sent = 0, failed = 0;
  for (const row of claimed ?? []) {
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
