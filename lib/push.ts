// Push notifications to a person's devices (web push: Android, desktop, and iPhone home-screen apps; the store app
// later uses the same alerts). VAPID keys in env: NEXT_PUBLIC_VAPID_PUBLIC_KEY (the browser subscribes with it),
// VAPID_PRIVATE_KEY and VAPID_SUBJECT. Server only; sends with the service role from the outbox run.
import 'server-only';
import webpush from 'web-push';
import type { SupabaseClient } from '@supabase/supabase-js';

export const pushConfigured = () => Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

let ready = false;
function setup() {
  if (ready || !pushConfigured()) return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:info@genovus.io', process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  ready = true;
}

export type PushMessage = { title: string; body: string; url: string; tag?: string };

/** Send one alert to every device of these people. Devices the push service says are gone are removed. */
export async function pushTo(db: SupabaseClient, userIds: string[], msg: PushMessage): Promise<{ sent: number; gone: number; failed: number }> {
  setup();
  const out = { sent: 0, gone: 0, failed: 0 };
  if (!ready || !userIds.length) return out;
  const { data: subs } = await db.from('push_subscriptions').select('id, endpoint, p256dh, auth, failures').in('user_id', userIds);
  const payload = JSON.stringify(msg);
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, urgency: 'high', topic: msg.tag?.slice(0, 32) });
      out.sent++;
      await db.from('push_subscriptions').update({ last_ok_at: new Date().toISOString(), failures: 0 }).eq('id', s.id);
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode ?? 0;
      if (code === 404 || code === 410 || s.failures >= 9) { out.gone++; await db.from('push_subscriptions').delete().eq('id', s.id); }
      else { out.failed++; await db.from('push_subscriptions').update({ failures: s.failures + 1 }).eq('id', s.id); }
    }
  }
  return out;
}

/** A new lead, to every subscribed device of the agency's members: tap to open Today with that lead, ready to call. */
export async function sendLeadPush(db: SupabaseClient, tenantId: string, d: Record<string, string>) {
  const { data: members } = await db.from('memberships').select('user_id').eq('tenant_id', tenantId);
  const what = [d.topic, d.channel === 'call' ? 'called the office' : d.source ? `via ${d.source}` : ''].filter(Boolean).join(' · ');
  return pushTo(db, (members ?? []).map((m) => m.user_id), {
    title: `New lead · ${d.name}`,
    body: `${what ? `${what} · ` : ''}Tap to call while it’s fresh.`,
    url: `/app/${d.slug}/today?lead=${d.lead}`,
    tag: `lead-${String(d.lead).slice(0, 27)}`,
  });
}
