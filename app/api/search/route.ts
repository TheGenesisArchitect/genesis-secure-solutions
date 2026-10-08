// Ctrl/⌘K search for clients and agencies. Runs as the signed-in person, so row-level security decides
// what comes back: staff see every agency and network, members only their own.
import { getViewer } from '@/lib/session';
import { db } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const v = await getViewer();
  if (!v) return Response.json({ results: [] }, { status: 401 });
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim().replace(/[%_,()]/g, '').slice(0, 60);
  if (q.length < 2) return Response.json({ results: [] });
  const supabase = await db();
  const [{ data: tenants }, { data: networks }] = await Promise.all([
    supabase.from('tenants').select('slug, name, is_sample').ilike('name', `%${q}%`).order('is_sample').order('name').limit(8),
    supabase.from('networks').select('slug, name').ilike('name', `%${q}%`).limit(3),
  ]);
  const results = [
    ...(tenants ?? []).flatMap((t) => v.staff
      ? [{ label: t.name, href: `/console/clients/${t.slug}`, group: t.is_sample ? 'Client · Sample' : 'Client', icon: 'clients' },
         { label: `${t.name} dashboard`, href: `/app/${t.slug}`, group: 'Agency view', icon: 'building' }]
      : [{ label: t.name, href: `/app/${t.slug}`, group: 'Agency', icon: 'building' }]),
    ...(networks ?? []).map((n) => ({ label: n.name, href: `/network?n=${n.slug}`, group: 'Network', icon: 'map' })),
  ];
  return Response.json({ results });
}
