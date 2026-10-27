// A photo on an agency site (headshot, logo): only that agency's own images; before launch only with the preview
// key; once live only photos whose rights the team has cleared.
import { get } from '@vercel/blob';
import { siteFor } from '@/lib/site-access';
import { adminDb } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
const NO = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });

export async function GET(req: Request, ctx: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return NO();
  const site = await siteFor(slug, new URL(req.url).searchParams.get('k'));
  if (!site) return NO();
  const { data: a } = await adminDb().from('assets').select('tenant_id, kind, audience, location_kind, location, rights_status').eq('id', id).maybeSingle();
  if (!a || a.tenant_id !== site.d.tenantId || !['image', 'brand'].includes(a.kind) || a.audience === 'internal' || a.location_kind !== 'blob') return NO();
  if (site.d.live && a.rights_status !== 'cleared') return NO();
  const res = await get(a.location, { access: 'private', useCache: false });
  if (!res || res.statusCode !== 200 || !res.stream) return NO();
  const type = res.headers.get('content-type') ?? 'image/jpeg';
  if (!/^image\/(jpeg|png|webp)$/.test(type)) return NO();
  return new Response(res.stream, { headers: { 'Content-Type': type, 'Cache-Control': site.d.live ? 'public, max-age=3600' : 'private, no-store' } });
}
