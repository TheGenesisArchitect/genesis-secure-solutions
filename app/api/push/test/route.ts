// "Send a test alert": one push to the signed-in person's devices, with the push service's answer for each, so a
// device that isn't getting alerts says why. POST { endpoint } also reports whether this device is on file.
import { getViewer } from '@/lib/session';
import { adminDb } from '@/lib/supabase/admin';
import { pushConfigured, pushTo } from '@/lib/push';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) return Response.json({ ok: false, error: 'Not allowed.' }, { status: 403 });
  const viewer = await getViewer().catch(() => null);
  if (!viewer) return Response.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  if (!pushConfigured()) return Response.json({ ok: false, error: 'Alerts aren’t set up on this server (push keys are missing).' });
  const b = (await req.json().catch(() => ({}))) as { endpoint?: string };
  const db = adminDb();
  const onFile = b.endpoint ? Boolean((await db.from('push_subscriptions').select('id').eq('endpoint', b.endpoint).eq('user_id', viewer.userId).maybeSingle()).data) : null;
  const r = await pushTo(db, [viewer.userId], { title: 'Test alert from Genovus', body: 'Alerts work on this device. New inquiries and bookings will look like this.', url: viewer.staff ? '/console' : '/go', tag: 'test-alert' });
  const message = onFile === false ? 'This device wasn’t on file. Tap “Alert me on this device” to turn it on again.'
    : r.sent ? `Sent to ${r.sent} device${r.sent > 1 ? 's' : ''}${r.devices > r.sent ? ` (${r.devices - r.sent} refused: ${r.errors.join('; ')})` : ''}. If it didn’t appear here, check this device’s notification settings for genovus.io.`
    : r.devices ? `The push service refused it: ${r.errors.join('; ')}` : 'No devices have alerts on for your account yet.';
  return Response.json({ ok: r.sent > 0 && onFile !== false, message, ...r, onFile });
}
