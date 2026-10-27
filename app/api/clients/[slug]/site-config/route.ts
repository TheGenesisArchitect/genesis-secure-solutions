// The client's draft site.config.ts (lib/site-config.ts), written from its current record each time it's opened, so
// it always matches what the team has confirmed. Genovus staff only; the client's own data under row-level security.
import { getViewer } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { siteConfigDraft } from '@/lib/site-config';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const viewer = await getViewer().catch(() => null);
  if (!viewer?.staff) return new Response('Genovus team only', { status: 403 });
  const { slug } = await ctx.params;
  const supabase = await db();
  const { data: t } = await supabase.from('tenants').select('id, slug').eq('slug', slug).maybeSingle();
  if (!t) return new Response('Not found', { status: 404 });
  const { data: rec } = await supabase.from('agent_records').select('data').eq('tenant_id', t.id).eq('is_current', true).maybeSingle();
  return new Response(siteConfigDraft((rec?.data ?? {}) as Record<string, unknown>, t.slug), {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': `inline; filename="site.config.ts"`, 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow' },
  });
}
