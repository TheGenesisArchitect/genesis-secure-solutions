// Voice Helix's lookups (typed Helix runs the same ones inside /api/helix/agency): POST { slug, tool, args } from a
// member (or staff) of that agency. Runs with the person's own session; the result goes back to the conversation's
// tool call only and is never saved. See lib/helix-lookups.ts.
import { getViewer } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { helixScope } from '@/lib/helix-thread';
import { LOOKUPS, runLookup } from '@/lib/helix-lookups';
import { PROSPECT_LOOKUPS, runProspectLookup } from '@/lib/helix-prospects';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: Request) {
  const viewer = await getViewer().catch(() => null);
  if (!viewer) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { slug?: string; tool?: string; args?: Record<string, unknown>; surface?: string };
  // Enterprise (staff only): prospect lookups, nothing else.
  if (b.surface === 'enterprise') {
    if (!viewer.staff) return Response.json({ error: 'Enterprise Helix is for the Genovus team.' }, { status: 403 });
    if (!PROSPECT_LOOKUPS.includes(b.tool as (typeof PROSPECT_LOOKUPS)[number])) return Response.json({ error: 'Helix can’t look that up yet.' }, { status: 400 });
    const args = b.args && typeof b.args === 'object' && !Array.isArray(b.args) ? Object.fromEntries(Object.entries(b.args).slice(0, 8)) : {};
    return Response.json(await runProspectLookup(await db(), String(b.tool), args));
  }
  if (!LOOKUPS.includes(b.tool as (typeof LOOKUPS)[number])) return Response.json({ error: 'Helix can’t look that up yet.' }, { status: 400 });
  const supabase = await db();
  const scope = await helixScope(supabase, viewer, 'agency', b.slug);
  if ('error' in scope) return Response.json({ error: scope.error }, { status: scope.status });
  const args = b.args && typeof b.args === 'object' && !Array.isArray(b.args) ? Object.fromEntries(Object.entries(b.args).slice(0, 8)) : {};
  return Response.json(await runLookup(supabase, scope.tenantId, String(b.tool), args, viewer.userId));
}
