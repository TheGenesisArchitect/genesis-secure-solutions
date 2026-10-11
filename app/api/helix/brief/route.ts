// Today's morning brief for an agency, made on first open when the daily cron hasn't made it yet. A member (or
// staff) of that agency with Ask Helix; the brief reads only that agency's data.
import { getViewer } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { adminDb } from '@/lib/supabase/admin';
import { accessFor } from '@/lib/access';
import { makeMorningBrief } from '@/lib/helix-morning';
import { businessToday } from '@/lib/billing';
import { PROGRAM_NAME } from '@/lib/programs';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  const viewer = await getViewer().catch(() => null);
  if (!viewer) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const { slug } = (await req.json().catch(() => ({}))) as { slug?: string };
  const m = viewer.memberships.find((x) => x.slug === slug);
  const t = m ? { id: m.tenantId, name: m.name, plan: m.plan } : viewer.staff ? await (await db()).from('tenants').select('id, name, plan').eq('slug', String(slug ?? '')).maybeSingle().then((r) => r.data) : null;
  if (!t) return Response.json({ error: 'Not your agency.' }, { status: 403 });
  const access = await accessFor(t.id, t.plan);
  if (!access.has('helix')) return Response.json({ error: 'The morning brief is part of Growth.' }, { status: 403 });
  const admin = adminDb();
  const { data: have } = await admin.from('helix_briefs').select('body').eq('tenant_id', t.id).eq('day', businessToday()).maybeSingle();
  if (have) return Response.json(have.body);
  try {
    return Response.json(await makeMorningBrief(admin, t.id, t.name, PROGRAM_NAME[access.program]));
  } catch (e) {
    console.error(`[helix-brief] ${e instanceof Error ? e.message : e}`);
    return Response.json({ error: 'Helix couldn’t write today’s brief just now.' }, { status: 502 });
  }
}
