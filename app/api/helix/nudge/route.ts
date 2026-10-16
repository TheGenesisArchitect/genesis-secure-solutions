// The one nudge Ask Helix may show beside its button: the newest lead from the last 24 hours nobody has called yet.
// GET ?slug=… for a member (or staff) of that agency with Ask Helix. Read with the person's own session.
import { getViewer } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { helixScope } from '@/lib/helix-thread';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const viewer = await getViewer().catch(() => null);
  if (!viewer) return Response.json({ lead: null }, { status: 401 });
  const supabase = await db();
  const scope = await helixScope(supabase, viewer, 'agency', new URL(req.url).searchParams.get('slug') ?? undefined);
  if ('error' in scope) return Response.json({ lead: null }, { status: scope.status });
  const { data } = await supabase.from('leads').select('id, name, topic, created_at').eq('tenant_id', scope.tenantId).eq('status', 'new')
    .gte('created_at', new Date(Date.now() - 86_400_000).toISOString()).order('created_at', { ascending: false }).limit(1).maybeSingle();
  return Response.json({ lead: data ?? null }, { headers: { 'cache-control': 'no-store' } });
}
