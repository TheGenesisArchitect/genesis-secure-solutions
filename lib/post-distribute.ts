// Agency posts, server only: a post goes out only after the agency owner approved it (its approval, not just the
// post's status), and only through that agency's own Metricool brand, with its approved ad from the Library.
// Metricool fetches the image from a signed, expiring link. Until METRICOOL_MODE=publish a post lands in Metricool
// as a draft for the team to check; the post stays "approved" (not "scheduled") so nobody reads a draft as booked.
// A post approved after its planned time has passed is held for a new time instead of going out late.
import 'server-only';
import { adminDb } from '@/lib/supabase/admin';
import { metricoolConfigured, metricoolLive, postStatus, schedulePost } from '@/lib/metricool';
import { signedMediaUrl } from '@/lib/media-link';

type Item = { id: string; tenant_id: string; channel: string; copy: string; format: 'post' | 'story'; asset_id: string; scheduled_for: string | null };
const LATE_MS = 3 * 3_600_000;

/** Send owner-approved posts to their agency's Metricool brand. */
export async function sendApprovedPosts(origin: string): Promise<{ sent: number; held: number; skipped: number; failed: number; live: boolean }> {
  const out = { sent: 0, held: 0, skipped: 0, failed: 0, live: metricoolLive() };
  if (!metricoolConfigured()) return out;
  const db = adminDb();
  const { data } = await db.from('content_items').select('id, tenant_id, channel, copy, format, asset_id, scheduled_for')
    .eq('status', 'approved').eq('is_sample', false).is('mc_post_id', null).is('mc_status', null).not('asset_id', 'is', null).limit(20);
  const items = (data ?? []) as Item[];
  if (!items.length) return out;
  // The owner's yes, on the record: an approved client approval for this very post.
  const { data: yes } = await db.from('approvals').select('content_item_id').in('content_item_id', items.map((i) => i.id)).eq('approver', 'client').eq('status', 'approved');
  const approved = new Set((yes ?? []).map((a) => a.content_item_id as string));
  const { data: ts } = await db.from('tenants').select('id, metricool_blog_id').in('id', [...new Set(items.map((i) => i.tenant_id))]);
  const brand = new Map((ts ?? []).map((t) => [t.id as string, t.metricool_blog_id as string | null]));
  const mark = (id: string, patch: Record<string, unknown>) => db.from('content_items').update({ mc_sent_at: new Date().toISOString(), ...patch }).eq('id', id);
  for (const i of items) {
    if (!approved.has(i.id)) continue;
    const blogId = brand.get(i.tenant_id);
    if (!blogId) { out.skipped++; continue; }
    if (i.channel !== 'facebook' && i.channel !== 'instagram') { await mark(i.id, { mc_status: 'SKIPPED', mc_error: `${i.channel} posting isn’t connected yet.` }); out.skipped++; continue; }
    const planned = i.scheduled_for ? Date.parse(i.scheduled_for) : NaN;
    if (!Number.isFinite(planned) || planned < Date.now() - LATE_MS) { await mark(i.id, { mc_status: 'NEEDS_TIME', mc_error: 'Approved after its planned time. Pick a new time.' }); out.held++; continue; }
    // Metricool needs a future time: a post approved just before (or a little after) its time goes out in ten minutes.
    const when = new Date(Math.max(planned, Date.now() + 10 * 60_000));
    const media = signedMediaUrl(origin, 'asset', i.asset_id, when.getTime() + 3 * 86_400_000);
    if (!media) { out.failed++; continue; }
    const r = await schedulePost({ blogId, network: i.channel, text: i.copy, mediaUrl: media, when, vertical: i.format === 'story', aiGenerated: false, format: i.format });
    if (r.ok) {
      await mark(i.id, { mc_post_id: r.data.id, mc_status: r.data.status, mc_error: null, ...(r.data.status === 'SCHEDULED' ? { status: 'scheduled', scheduled_for: when.toISOString() } : {}) });
      out.sent++;
    } else { await mark(i.id, { mc_status: 'ERROR', mc_error: r.error.slice(0, 500) }); out.failed++; }
  }
  return out;
}

/** Posts Metricool has published are marked published with their live link; failures are recorded. */
export async function syncAgencyPosts(): Promise<{ checked: number; published: number; failed: number }> {
  const out = { checked: 0, published: 0, failed: 0 };
  if (!metricoolConfigured()) return out;
  const db = adminDb();
  const { data } = await db.from('content_items').select('id, tenant_id, mc_post_id, mc_status').eq('status', 'scheduled').not('mc_post_id', 'is', null).in('mc_status', ['SCHEDULED', 'PENDING']).limit(25);
  if (!data?.length) return out;
  const { data: ts } = await db.from('tenants').select('id, metricool_blog_id').in('id', [...new Set(data.map((p) => p.tenant_id as string))]);
  const brand = new Map((ts ?? []).map((t) => [t.id as string, t.metricool_blog_id as string | null]));
  for (const p of data) {
    const blogId = brand.get(p.tenant_id as string);
    if (!blogId) continue;
    out.checked++;
    const r = await postStatus(blogId, Number(p.mc_post_id));
    if (!r.ok) continue;
    if (r.data.status === 'PUBLISHED') { await db.from('content_items').update({ status: 'published', mc_status: 'PUBLISHED', post_url: r.data.url ?? `https://app.metricool.com/planner?blogId=${blogId}` }).eq('id', p.id); out.published++; }
    else if (r.data.status === 'ERROR') { await db.from('content_items').update({ mc_status: 'ERROR', mc_error: r.data.detail ?? 'Metricool reported an error' }).eq('id', p.id); out.failed++; }
    else if (r.data.status !== p.mc_status) await db.from('content_items').update({ mc_status: r.data.status }).eq('id', p.id);
  }
  return out;
}
