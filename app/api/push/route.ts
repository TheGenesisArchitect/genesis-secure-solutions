// New-lead alerts on this device: POST { subscription, device } turns them on for the signed-in person; DELETE
// { endpoint } turns them off. The subscription is the browser's push address; only its owner can read it.
import { getViewer } from '@/lib/session';
import { db } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const viewer = await getViewer().catch(() => null);
  if (!viewer) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }; device?: string };
  const s = b.subscription;
  if (!s?.endpoint || !s.keys?.p256dh || !s.keys?.auth) return Response.json({ error: 'Not a push subscription.' }, { status: 400 });
  const { error } = await (await db()).rpc('push_subscribe', { p_endpoint: s.endpoint, p_p256dh: s.keys.p256dh, p_auth: s.keys.auth, p_device: String(b.device ?? '').slice(0, 120) });
  return error ? Response.json({ error: error.message }, { status: 400 }) : Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const viewer = await getViewer().catch(() => null);
  if (!viewer) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { endpoint?: string };
  await (await db()).rpc('push_unsubscribe', { p_endpoint: String(b.endpoint ?? '') });
  return Response.json({ ok: true });
}
