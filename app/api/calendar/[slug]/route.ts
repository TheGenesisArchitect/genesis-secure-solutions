// The agency calendar as an iCal feed for Google or Apple Calendar: /api/calendar/<slug>?k=<signed token>.
// The token is the agency's own signature; without it the feed does not exist.
import { adminDb } from '@/lib/supabase/admin';
import { calendarItems, feedTokenOk, toIcs } from '@/lib/agency-calendar';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const k = new URL(req.url).searchParams.get('k') ?? '';
  const db = adminDb();
  const { data: t } = await db.from('tenants').select('id, name').eq('slug', slug).maybeSingle();
  if (!t || !feedTokenOk(t.id, k)) return new Response('Not found', { status: 404 });
  const from = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
  const to = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
  const ics = toIcs(`${t.name} · Genovus`, await calendarItems(db, t.id, from, to));
  return new Response(ics, { headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'private, max-age=300' } });
}
