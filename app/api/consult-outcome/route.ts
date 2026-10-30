// How a booked consultation went, from the Command Brief card or the consultation page: POST { invite, outcome } (staff only; migration 0088).
import { getViewer } from '@/lib/session';
import { db } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const SAID = { showed: 'Marked as showed.', no_show: 'Marked as a no-show.', rescheduled: 'Marked as rescheduled.' } as const;

export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) return Response.json({ ok: false, error: 'Not allowed.' }, { status: 403 });
  const viewer = await getViewer().catch(() => null);
  if (!viewer?.staff) return Response.json({ ok: false, error: 'Sign in as the Genovus team.' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { invite?: string; outcome?: string };
  if (!b.invite || !/^[0-9a-f-]{36}$/.test(b.invite) || !(b.outcome && b.outcome in SAID)) return Response.json({ ok: false, error: 'Pick showed, no-show or rescheduled.' }, { status: 400 });
  const { error } = await (await db()).rpc('set_consult_outcome', { p_invite: b.invite, p_outcome: b.outcome });
  return error ? Response.json({ ok: false, error: error.message }, { status: 400 }) : Response.json({ ok: true, message: SAID[b.outcome as keyof typeof SAID] });
}
