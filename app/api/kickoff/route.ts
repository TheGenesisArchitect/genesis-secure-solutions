// The kickoff card on the welcome page: POST { slug, action: 'confirm' } or { slug, action: 'move', start } from a
// signed-in member of that agency (the database checks membership, migration 0092). A move only lands on one of the
// open team times the card offered; it re-sends the calendar invite and tells the team.
import { getViewer } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { adminDb } from '@/lib/supabase/admin';
import { kickoffFor, kickoffSlots, etWhen } from '@/lib/welcome';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const viewer = await getViewer().catch(() => null);
  const slug = new URL(req.url).searchParams.get('slug') ?? '';
  if (!viewer || (!viewer.memberships.some((m) => m.slug === slug) && !viewer.staff)) return Response.json({ error: 'Not allowed.' }, { status: 403 });
  const { data: t } = await adminDb().from('tenants').select('id').eq('slug', slug).maybeSingle();
  const k = t ? await kickoffFor(t.id as string) : null;
  return Response.json({ slots: k ? await kickoffSlots(k) : [] }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) return Response.json({ error: 'Not allowed.' }, { status: 403 });
  const viewer = await getViewer().catch(() => null);
  if (!viewer) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { slug?: string; action?: string; start?: string };
  const slug = String(b.slug ?? '');
  if (!viewer.memberships.some((m) => m.slug === slug) && !viewer.staff) return Response.json({ error: 'Not allowed.' }, { status: 403 });
  const { data: t } = await adminDb().from('tenants').select('id').eq('slug', slug).maybeSingle();
  if (!t) return Response.json({ error: 'Not found.' }, { status: 404 });
  const supabase = await db();
  if (b.action === 'confirm') {
    const { data, error } = await supabase.rpc('confirm_kickoff', { p_tenant: t.id });
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ ok: true, starts: data, message: `Confirmed for ${etWhen(String(data))} (Eastern). See you then.` });
  }
  if (b.action === 'move') {
    const k = await kickoffFor(t.id as string);
    if (!k) return Response.json({ error: 'There’s no kickoff on the calendar yet.' }, { status: 400 });
    const ms = Date.parse(String(b.start ?? ''));
    if (!Number.isFinite(ms)) return Response.json({ error: 'Pick one of the times offered.' }, { status: 400 });
    const want = new Date(ms).toISOString();
    const slots = await kickoffSlots(k);
    if (!slots.some((s) => s.iso === want)) return Response.json({ error: 'That time was just taken. Pick another.' }, { status: 409 });
    const { data, error } = await supabase.rpc('move_kickoff', { p_tenant: t.id, p_start: want });
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ ok: true, starts: data, message: `Moved to ${etWhen(String(data))} (Eastern). We’ve updated the calendar invite and let the team know.` });
  }
  return Response.json({ error: 'Unknown action.' }, { status: 400 });
}
