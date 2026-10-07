// Every weekday morning: one digest to the team (new inquiries, client approvals waiting over two days,
// open care requests) instead of a stream of nudges, plus a full verification of the audit chain.
import { adminDb } from '@/lib/supabase/admin';
import { cronAuthorized } from '@/lib/cron';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response('Unauthorized', { status: 401 });
  const db = adminDb();
  const twoDays = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const [{ count: inquiries }, { data: stale }, { count: care }, { data: broken }] = await Promise.all([
    db.from('inquiries').select('id', { count: 'exact', head: true }).eq('status', 'new'),
    db.from('approvals').select('title, tenants(name)').eq('status', 'pending').eq('approver', 'client').eq('is_sample', false).lte('requested_at', twoDays).limit(20),
    db.from('care_requests').select('id', { count: 'exact', head: true }).in('status', ['new', 'in_progress']).eq('is_sample', false),
    db.rpc('verify_audit_chain', { p_full: true }),
  ]);
  const lines = [
    `New inquiries waiting for a reply: ${inquiries ?? 0}.`,
    `Open care requests: ${care ?? 0}.`,
    stale?.length ? `Client approvals waiting over two days: ${stale.map((s) => `${s.title} (${(s.tenants as unknown as { name: string } | null)?.name})`).join('; ')}.` : 'No client approvals waiting over two days.',
    broken === null ? 'Audit log: every entry verified.' : `Audit log: the chain breaks at entry #${broken}. Investigate today.`,
  ];
  const quiet = !inquiries && !care && !stale?.length && broken === null;
  if (!quiet) {
    const { data: team } = await db.from('staff').select('user_id, role').in('role', ['admin', 'account_lead']);
    const day = new Date().toISOString().slice(0, 10);
    for (const s of team ?? []) {
      const { data: u } = await db.auth.admin.getUserById(s.user_id);
      if (!u.user?.email) continue;
      await db.from('outbox').upsert(
        { to_email: u.user.email, template: 'team_digest', data: { summary: `${inquiries ?? 0} inquiries, ${care ?? 0} care requests`, lines: lines.join('\n') }, dedupe_key: `digest:${day}:${s.user_id}` },
        { onConflict: 'dedupe_key', ignoreDuplicates: true },
      );
    }
  }
  return Response.json({ quiet, lines });
}
