// Helix voice on UnEdit Studio: read the posting calendar and move or take posts off it by voice ("push the DeepSeek
// clips to Thursday", "move clip 2's Instagram to 6 PM", "take the boat video off Friday"). The same rules as the
// calendar buttons: only posts still waiting (queued) change; sent posts are locked; moves land at least LEAD_MIN out
// and within 60 days. Times are New York. Genovus team only (the route checks staff). Server only.
import 'server-only';
import { adminDb } from '@/lib/supabase/admin';
import { deskFor } from '@/lib/desk';
import { LEAD_MIN, nyAt, nyDay } from '@/lib/unedit-plan';

const NETS: Record<string, string> = { instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', tiktok: 'TikTok', twitter: 'X', linkedin: 'LinkedIn' };
const TZ = 'America/New_York';
const ymd = (d: Date) => { const x = nyDay(d); return `${x.y}-${String(x.m).padStart(2, '0')}-${String(x.d).padStart(2, '0')}`; };
const fromYmd = (s: string) => { const [y, m, d] = s.split('-').map(Number); return { y, m, d }; };
const fmt = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TZ });

type Row = { id: string; vlog_id: string; clip_id: string | null; platform: string; kind: string; status: string; scheduled_at: string; posted_url: string | null };
export type CalItem = { id: string; vlog: string; recording: string; clip: number | null; platform: string; kind: string; status: string; at: string };
/** Which posts a voice command means. Every field narrows; recording "this" means the recording on screen. */
export type Selector = { recording?: string; clip?: number | string; platform?: string; day?: string; current?: string; tenant?: string };

/** Today in New York, for Helix's instructions (it resolves "Thursday" or "tomorrow" into a date). */
export function nyToday(now = new Date()): string {
  return `${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: TZ })} (${ymd(now)}), ${now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ })} New York time`;
}

/** Every post from the start of today (New York) on, waiting or sent, with its recording's name and clip number. */
export async function calendar(tenantId?: string): Promise<CalItem[]> {
  const db = adminDb();
  const tenant = tenantId ?? (await deskFor()).id;
  const today = nyAt(nyDay(new Date()), 0, 0).toISOString();
  const { data: ps } = await db.from('unedit_posts').select('id, vlog_id, clip_id, platform, kind, status, scheduled_at, posted_url, unedit_vlogs!inner(title, episode, tenant_id)')
    .eq('unedit_vlogs.tenant_id', tenant).gte('scheduled_at', today).in('status', ['queued', 'sent', 'posted', 'error']).order('scheduled_at').limit(300);
  const rows = (ps ?? []) as unknown as (Row & { unedit_vlogs: { title: string | null; episode: { title?: string } | null } })[];
  const clipIds = [...new Set(rows.map((r) => r.clip_id).filter(Boolean))] as string[];
  const { data: cs } = clipIds.length ? await db.from('unedit_clips').select('id, n').in('id', clipIds) : { data: [] };
  const nOf = new Map((cs ?? []).map((c) => [c.id as string, c.n as number]));
  return rows.map((r) => ({ id: r.id, vlog: r.vlog_id, recording: r.unedit_vlogs?.episode?.title || r.unedit_vlogs?.title || 'Recording', clip: r.clip_id ? nOf.get(r.clip_id) ?? null : null, platform: r.platform, kind: r.kind, status: r.status, at: r.scheduled_at }));
}

const what = (p: CalItem) => `${p.recording}, ${p.clip ? `clip ${p.clip}` : 'full video'}, ${NETS[p.platform] ?? p.platform}${p.kind === 'video' ? '' : p.kind === 'short' ? ' Short' : ' Reel'}`;

/** The calendar read out: one line per post, so Helix can answer "what's going out this week?". */
export async function calendarText(tenant?: string): Promise<{ ok: true; waiting: number; posts: string[] }> {
  const all = await calendar(tenant);
  return { ok: true, waiting: all.filter((p) => p.status === 'queued').length, posts: all.map((p) => `${fmt(p.at)}: ${what(p)} (${p.status === 'queued' ? 'waiting, can move' : p.status === 'posted' ? 'live' : p.status === 'error' ? 'failed' : 'sent to Metricool, locked'})`) };
}

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !['the', 'clips', 'clip', 'video', 'one', 'post', 'posts', 'episode', 'recording'].includes(w));

/** The posts a selector names, waiting ones only; or why none match. */
export function pick(all: CalItem[], s: Selector): { posts: CalItem[] } | { error: string; choices?: string[] } {
  let list = all.filter((p) => p.status === 'queued');
  if (!list.length) return { error: 'Nothing is waiting on the calendar.' };
  const rec = String(s.recording ?? '').trim();
  if (rec && rec.toLowerCase() !== 'all') {
    if (/^(this|this one|this recording|current)$/i.test(rec)) {
      if (!s.current) return { error: 'No recording is open on screen; say its name.' };
      list = list.filter((p) => p.vlog === s.current);
    } else {
      const want = words(rec);
      const names = [...new Set(list.map((p) => p.recording))];
      // Best match by shared words; a tie between recordings is ambiguous.
      // Most words matched first, then the fewest unmatched words in the name ("Boat" picks "Boat" over "Boat Show").
      const scored = names.map((n) => { const k = want.filter((w) => words(n).some((x) => x.startsWith(w) || w.startsWith(x))).length; return { n, k, extra: words(n).length - k }; })
        .filter((x) => x.k > 0).sort((a, b) => b.k - a.k || a.extra - b.extra);
      if (!scored.length) return { error: `No waiting posts from a recording called “${rec}”.`, choices: names };
      if (scored.length > 1 && scored[1].k === scored[0].k && scored[1].extra === scored[0].extra) return { error: `“${rec}” matches more than one recording.`, choices: scored.filter((x) => x.k === scored[0].k && x.extra === scored[0].extra).map((x) => x.n) };
      list = list.filter((p) => p.recording === scored[0].n);
    }
  }
  if (s.clip !== undefined && s.clip !== null && String(s.clip) !== '') {
    const c = String(s.clip).toLowerCase();
    list = /full|video|long/.test(c) ? list.filter((p) => p.clip === null) : list.filter((p) => p.clip === Number(c));
  }
  if (s.platform) {
    const n = String(s.platform).toLowerCase().replace(/^x$/, 'twitter');
    list = list.filter((p) => p.platform === n || (NETS[p.platform] ?? '').toLowerCase() === n);
  }
  if (s.day && /^\d{4}-\d{2}-\d{2}$/.test(s.day)) list = list.filter((p) => ymd(new Date(p.at)) === s.day);
  if (!list.length) return { error: 'No waiting post matches that.' };
  return { posts: list };
}

/** Parse "HH:MM" (24h). */
function hm(t?: string): [number, number] | null {
  const m = String(t ?? '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  return h < 24 && mi < 60 ? [h, mi] : null;
}

/**
 * Move the chosen posts so the first lands on `date` (New York; at `time` if given, else at its own time of day); the
 * rest shift by the same amount, so a drip keeps its rhythm. preview true reports the new times without moving.
 */
export async function movePosts(s: Selector & { date?: string; time?: string; preview?: boolean }, by: string): Promise<Record<string, unknown>> {
  const all = await calendar(s.tenant);
  const r = pick(all, s);
  if ('error' in r) return { ok: false, ...r };
  const posts = [...r.posts].sort((a, b) => a.at.localeCompare(b.at));
  const first = new Date(posts[0].at);
  const day = s.date && /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? s.date : ymd(first);
  const t = hm(s.time);
  if (s.time && !t) return { ok: false, error: 'Say the time as hours and minutes.' };
  if (!s.date && !t) return { ok: false, error: 'Say the day or the time to move it to.' };
  // The first post's own time of day in New York, when no time was said.
  const [h0, m0] = t ?? first.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ }).split(':').map(Number) as [number, number];
  const target = nyAt(fromYmd(day), 0, h0, m0);
  const delta = target.getTime() - first.getTime();
  const moved = posts.map((p) => ({ p, at: new Date(Date.parse(p.at) + delta) }));
  const early = moved.find((x) => x.at.getTime() < Date.now() + LEAD_MIN * 60_000);
  if (early) return { ok: false, error: `That puts ${what(early.p)} at ${fmt(early.at.toISOString())}, less than ${LEAD_MIN} minutes from now. Pick a later time.` };
  if (moved.some((x) => x.at.getTime() > Date.now() + 60 * 86_400_000)) return { ok: false, error: 'Pick a time within the next 60 days.' };
  const plan = moved.map((x) => `${what(x.p)}: ${fmt(x.p.at)} → ${fmt(x.at.toISOString())}`);
  if (s.preview) return { ok: true, preview: true, count: moved.length, plan };
  const db = adminDb();
  let done = 0;
  const gone: string[] = [];
  for (const x of moved) {
    const u = await db.from('unedit_posts').update({ scheduled_at: x.at.toISOString() }).eq('id', x.p.id).eq('status', 'queued').select('id');
    if (u.data?.length) done++; else gone.push(what(x.p));
  }
  await logVoice('voice-move-posts', posts.map((p) => p.vlog), { by, count: done, date: day, time: s.time ?? null });
  return { ok: done > 0, moved: done, plan, ...(gone.length ? { not_moved: gone, why: 'these went to Metricool just now and are locked' } : {}) };
}

/** Take the chosen posts off the calendar (they don't go out). Only after the person said yes. */
export async function cancelPosts(s: Selector, by: string): Promise<Record<string, unknown>> {
  const r = pick(await calendar(s.tenant), s);
  if ('error' in r) return { ok: false, ...r };
  const db = adminDb();
  let done = 0;
  for (const p of r.posts) {
    const u = await db.from('unedit_posts').update({ status: 'cancelled' }).eq('id', p.id).eq('status', 'queued').select('id');
    if (u.data?.length) done++;
  }
  await logVoice('voice-cancel-posts', r.posts.map((p) => p.vlog), { by, count: done });
  return { ok: done > 0, cancelled: done, posts: r.posts.map((p) => `${fmt(p.at)}: ${what(p)}`) };
}

// The same audit log the calendar buttons write (unedit_log), once per recording touched.
async function logVoice(action: string, vlogs: string[], after: Record<string, unknown>) {
  const db = adminDb();
  for (const v of [...new Set(vlogs)]) await db.rpc('unedit_log', { p_action: `studio.unedit.${action}`, p_subject: v, p_after: after }).then(() => null, () => null);
}
