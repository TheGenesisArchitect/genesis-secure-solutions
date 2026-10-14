// Studio distribution, server only: the Publish tap's approved posts go out through Metricool on the Genovus brand.
// Instagram gets the episode's 9:16 Short as a Reel, Facebook the 16:9 final; every post carries the network's AI
// label (instagramData.isAiGenerated). Metricool fetches the video from a signed, expiring link. The minute's sync
// (syncPosted) marks each post posted with its live link, or records why it failed. TikTok and YouTube join once
// their accounts are connected on the brand and their formats are confirmed.
import 'server-only';
import { adminDb } from '@/lib/supabase/admin';
import { GENOVUS_BLOG_ID, metricoolConfigured, metricoolLive, postStatus, schedulePost } from '@/lib/metricool';
import { signedMediaUrl } from '@/lib/media-link';

type Post = { id: string; platform: string; caption: string; link: string; scheduled_for: string | null; mc_post_id: number | null };
const NETWORKS = ['instagram', 'facebook'] as const;

/** Send a published episode's approved posts to Metricool. Returns what happened, in words, for the toast. */
export async function distributeEpisode(episodeId: string, origin: string): Promise<{ sent: number; skipped: string[]; failed: string[]; live: boolean }> {
  const out = { sent: 0, skipped: [] as string[], failed: [] as string[], live: metricoolLive() };
  if (!metricoolConfigured()) { out.skipped.push('Metricool is not connected'); return out; }
  const db = adminDb();
  const { data: rows } = await db.from('studio_posts').select('id, platform, caption, link, scheduled_for, mc_post_id').eq('episode_id', episodeId).eq('status', 'approved').is('mc_post_id', null);
  const posts = (rows ?? []) as Post[];
  if (!posts.length) return out;
  const [{ data: ep }, { data: shorts }] = await Promise.all([
    db.from('studio_episodes').select('id, final_blob').eq('id', episodeId).single(),
    db.from('studio_renders').select('id').eq('episode_id', episodeId).eq('kind', 'short').eq('format', 'vertical').order('created_at', { ascending: false }).limit(1),
  ]);
  const record = (p: Post, id: number | null, status: string, error = '') => db.rpc('studio_system_post_sent', { p_id: p.id, p_mc_id: id, p_status: status, p_error: error });
  for (const p of posts) {
    if (!(NETWORKS as readonly string[]).includes(p.platform)) { out.skipped.push(`${p.platform} (not connected yet)`); continue; }
    const vertical = p.platform === 'instagram';
    const short = shorts?.[0]?.id as string | undefined;
    if (vertical && !short) { await record(p, null, 'SKIPPED', 'Instagram needs the episode’s 9:16 Short.'); out.skipped.push('instagram (no 9:16 Short)'); continue; }
    if (!vertical && !ep?.final_blob) { await record(p, null, 'SKIPPED', 'No final cut yet.'); out.skipped.push('facebook (no final cut)'); continue; }
    // A post scheduled ahead keeps its time; otherwise it goes out in ten minutes (Metricool needs a future time).
    const soon = Date.now() + 10 * 60_000;
    const when = new Date(p.scheduled_for && Date.parse(p.scheduled_for) > soon ? p.scheduled_for : soon);
    const media = signedMediaUrl(origin, vertical ? 'render' : 'final', vertical ? short! : episodeId, when.getTime() + 3 * 86_400_000);
    if (!media) { out.failed.push(`${p.platform}: no signing secret`); continue; }
    const r = await schedulePost({ blogId: GENOVUS_BLOG_ID(), network: p.platform as 'instagram' | 'facebook', text: p.caption.replaceAll('{link}', p.link), mediaUrl: media, when, vertical, aiGenerated: true });
    if (r.ok) { await record(p, r.data.id, r.data.status); out.sent++; }
    else { await record(p, null, 'ERROR', r.error); out.failed.push(`${p.platform}: ${r.error}`); }
  }
  return out;
}

/** Every minute: posts Metricool has published are marked posted with their live link; failures are recorded. */
export async function syncPosted(): Promise<{ checked: number; posted: number; failed: number }> {
  const out = { checked: 0, posted: 0, failed: 0 };
  if (!metricoolConfigured()) return out;
  const db = adminDb();
  const { data } = await db.from('studio_posts').select('id, mc_post_id, mc_status').eq('status', 'approved').not('mc_post_id', 'is', null).in('mc_status', ['SCHEDULED', 'PENDING']).limit(25);
  for (const p of data ?? []) {
    out.checked++;
    const r = await postStatus(GENOVUS_BLOG_ID(), Number(p.mc_post_id));
    if (!r.ok) continue;
    // Published: the network's live link when Metricool gives one, else the post in Metricool's planner.
    if (r.data.status === 'PUBLISHED') { await db.rpc('studio_system_mark_posted', { p_id: p.id, p_url: r.data.url ?? `https://app.metricool.com/planner?blogId=${GENOVUS_BLOG_ID()}` }); out.posted++; }
    else if (r.data.status === 'ERROR') { await db.rpc('studio_system_post_sent', { p_id: p.id, p_mc_id: null, p_status: 'ERROR', p_error: r.data.detail ?? 'Metricool reported an error' }); out.failed++; }
    else if (r.data.status !== p.mc_status) await db.rpc('studio_system_post_sent', { p_id: p.id, p_mc_id: null, p_status: r.data.status, p_error: '' });
  }
  return out;
}
