// Open consult times for an agency site's booking (Growth and Premium): times only, never what's on the calendar.
import { siteFor } from '@/lib/site-access';
import { adminDb } from '@/lib/supabase/admin';
import { openTimes } from '@/lib/helix-lookups';
import { easternIso } from '@/lib/agency-calendar';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const site = await siteFor(slug, new URL(req.url).searchParams.get('k'));
  if (!site || !site.d.booking) return Response.json({ slots: [] }, { status: site ? 200 : 404 });
  const open = await openTimes(adminDb(), site.d.tenantId, { minutes: 30, days: 10 });
  return Response.json({ slots: open.slots.map((x: { day: string; time: string; label: string }) => ({ iso: easternIso(x.day, x.time), label: x.label })) }, { headers: { 'Cache-Control': 'no-store' } });
}
