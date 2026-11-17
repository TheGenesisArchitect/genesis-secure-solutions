// What Helix knows about UnEdit Studio and the Newsroom, as BRIEF lines: recordings and where each stands (waiting for
// review, stuck), the posting calendar for the next 7 days, what went out lately, the Newsroom's latest morning brief
// with its hot topics, productions waiting for a recording, and this month's spend. Used by Enterprise Ask Helix (typed
// and voice) and Studio voice, so Helix can brief and advise on UnEdit from any page. Reads with the caller's client
// (staff-only tables) and never writes.
import type { SupabaseClient } from '@supabase/supabase-js';

const TZ = 'America/New_York';
const NETS: Record<string, string> = { instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', tiktok: 'TikTok', twitter: 'X', linkedin: 'LinkedIn' };
const WORKING = ['uploaded', 'transcribing', 'finding', 'rendering', 'publishing'];
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TZ });
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const ago = (iso: string) => { const h = (Date.now() - Date.parse(iso)) / 3_600_000; return h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`; };
const tally = (xs: string[]) => Object.entries(xs.reduce<Record<string, number>>((a, x) => ({ ...a, [x]: (a[x] ?? 0) + 1 }), {})).map(([k, n]) => `${k} ${n}`).join(', ');
const cut = (s: string | null | undefined, n: number) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

type V = { id: string; tenant_id: string; title: string | null; episode: { title?: string } | null; stage: string; stage_at: string; error: string | null; cost_cents: number; created_at: string };
type P = { vlog_id: string; clip_id: string | null; platform: string; kind: string; status: string; scheduled_at: string | null; mc_error: string | null; posted_url: string | null; updated_at?: string };

/** One desk's section (lib/desk.ts); the house desk when none is given. Nothing from another desk is read. */
export async function uneditBriefLines(db: SupabaseClient, desk?: { id: string; name: string; house: boolean }): Promise<string[]> {
  const d = desk ?? (await (await import('@/lib/desk')).deskFor());
  const tenant = d.id;
  const now = Date.now();
  const since30 = new Date(now - 30 * 86_400_000).toISOString();
  const since14 = new Date(now - 14 * 86_400_000).toISOString();
  const in7 = new Date(now + 7 * 86_400_000).toISOString();
  const month = new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
  const monthStart = new Date(Date.UTC(month.getFullYear(), month.getMonth(), 1)).toISOString();
  const [vlogs, clips, upcoming, recent, briefs, prods, runs, tenants] = await Promise.all([
    db.from('unedit_vlogs').select('id, tenant_id, title, episode, stage, stage_at, error, cost_cents, created_at').eq('tenant_id', tenant).gte('created_at', since30).order('created_at', { ascending: false }).limit(60),
    db.from('unedit_clips').select('vlog_id, status').eq('tenant_id', tenant).gte('created_at', since30),
    db.from('unedit_posts').select('vlog_id, clip_id, platform, kind, status, scheduled_at, mc_error, posted_url').eq('tenant_id', tenant).eq('status', 'queued').gte('scheduled_at', new Date(now).toISOString()).lte('scheduled_at', in7).order('scheduled_at').limit(40),
    db.from('unedit_posts').select('vlog_id, clip_id, platform, kind, status, scheduled_at, mc_error, posted_url').eq('tenant_id', tenant).in('status', ['sent', 'posted', 'error']).gte('created_at', since14).limit(200),
    db.from('newsroom_briefs').select('tenant_id, day, summary, hot').eq('tenant_id', tenant).order('day', { ascending: false }).limit(1),
    db.from('newsroom_productions').select('story_id, angle, vlog_id, next_upload, created_at').eq('tenant_id', tenant).is('vlog_id', null).gte('created_at', since30).order('created_at', { ascending: false }).limit(8),
    db.from('newsroom_runs').select('cost_cents').eq('tenant_id', tenant).gte('created_at', monthStart),
    db.from('tenants').select('id, name, slug'),
  ]);
  if (vlogs.error && briefs.error) return ['UNEDIT STUDIO & NEWSROOM', '- not readable for this viewer.'];

  const V = (vlogs.data ?? []) as V[];
  const nameOf = new Map<string, string>(V.map((v) => [v.id, v.episode?.title || v.title || 'Recording']));
  // Posts can belong to recordings older than 30 days: fetch any names still missing.
  const P = [...(upcoming.data ?? []), ...(recent.data ?? [])] as P[];
  const missing = [...new Set(P.map((p) => p.vlog_id).filter((id) => !nameOf.has(id)))];
  if (missing.length) {
    const { data } = await db.from('unedit_vlogs').select('id, title, episode').in('id', missing);
    for (const v of (data ?? []) as V[]) nameOf.set(v.id, v.episode?.title || v.title || 'Recording');
  }
  const T = (tenants.data ?? []) as { id: string; name: string; slug: string }[];
  const whose = (tenantId: string) => { const t = T.find((x) => x.id === tenantId); return t && t.slug !== 'genovus' ? ` [for ${t.name}]` : ''; };
  const C = (clips.data ?? []) as { vlog_id: string; status: string }[];
  const clipsOf = (id: string) => C.filter((c) => c.vlog_id === id);
  const label = (p: P) => `${nameOf.get(p.vlog_id) ?? 'Recording'}, ${p.clip_id ? 'a clip' : 'full video'}, ${NETS[p.platform] ?? p.platform}`;

  // Test recordings ("[TEST, do not approve] …") are counted, never listed: Helix must not suggest approving them.
  const isTest = (v: V) => /^\[test/i.test(nameOf.get(v.id) ?? '');
  const tests = V.filter((v) => v.stage === 'review' && isTest(v)).length;
  const review = V.filter((v) => v.stage === 'review' && !v.error && !isTest(v));
  const stuck = V.filter((v) => v.error || v.stage === 'failed' || (WORKING.includes(v.stage) && now - Date.parse(v.stage_at) > 2 * 3_600_000));
  const spendVlogs = V.filter((v) => v.created_at >= monthStart).reduce((a, v) => a + Number(v.cost_cents ?? 0), 0);
  const spendNews = (runs.data ?? []).reduce((a, r) => a + Number(r.cost_cents ?? 0), 0);
  const R = (recent.data ?? []) as P[];
  const errs = R.filter((p) => p.status === 'error');

  const lines: string[] = [
    `UNEDIT STUDIO & NEWSROOM · ${d.house ? 'GENOVUS DESK' : `${d.name.toUpperCase()} DESK (agency; pass desk "${d.name}" to look up or act on it)`} (record one take → captioned clips, the full video and thumbnails → one Approve → posts on the calendar; the Newsroom finds the stories to record)`,
    `- Recordings, last 30 days: ${V.length} (${tally(V.map((v) => (v.error ? 'stopped' : v.stage))) || 'none'}).`,
    `- Waiting for review (one Approve sends them): ${review.map((v) => { const cs = clipsOf(v.id); return `"${nameOf.get(v.id)}"${whose(v.tenant_id)} (${cs.filter((c) => c.status === 'ready' || c.status === 'approved').length} clips ready${cs.some((c) => c.status === 'rendering' || c.status === 'redo') ? ', some still cutting' : ''}, waiting ${ago(v.stage_at)})`; }).join('; ') || 'none'}.${tests ? ` Plus ${tests} test recording${tests === 1 ? '' : 's'} marked do-not-approve (ignore them).` : ''}`,
    `- Stuck or stopped: ${stuck.map((v) => `"${nameOf.get(v.id)}" (${v.error ? `stopped: ${cut(v.error, 120)}` : `${v.stage} for ${ago(v.stage_at)}`})`).join('; ') || 'none'}.`,
    `- Posting calendar, next 7 days (${(upcoming.data ?? []).length} waiting; movable by voice on UnEdit pages or on the Recordings calendar): ${((upcoming.data ?? []) as P[]).slice(0, 15).map((p) => `${when(p.scheduled_at!)} ${label(p)}`).join('; ') || 'nothing scheduled'}.`,
    `- Went out, last 14 days: ${R.length} posts (${tally(R.map((p) => `${NETS[p.platform] ?? p.platform} ${p.status === 'posted' ? 'live' : p.status === 'error' ? 'failed' : 'sent to Metricool'}`)) || 'none'}).${errs.length ? ` Failures: ${errs.slice(0, 5).map((p) => `${label(p)}: ${cut(p.mc_error, 90) || 'no detail'}`).join('; ')}.` : ''}`,
    '- Views and engagement per UnEdit post are not tracked in Genovus yet (Metricool has them); say so if asked how clips performed.',
    `- UnEdit and Newsroom spend this month: ${usd(spendVlogs + spendNews)} (recordings ${usd(spendVlogs)}, Newsroom research ${usd(spendNews)}); it counts toward the Studio cap.`,
  ];

  const b = (briefs.data ?? [])[0] as { tenant_id: string; day: string; summary: string; hot: { story_id?: string; why?: string; angle?: string; heat?: number }[] } | undefined;
  const hot = (b?.hot ?? []).filter((h) => h.story_id).slice(0, 6);
  const storyIds = [...new Set([...hot.map((h) => h.story_id!), ...((prods.data ?? []) as { story_id: string }[]).map((p) => p.story_id)])];
  const { data: stories } = storyIds.length ? await db.from('newsroom_stories').select('id, headline, source, status, beat').in('id', storyIds) : { data: [] };
  const S = new Map(((stories ?? []) as { id: string; headline: string; source: string; status: string; beat: string }[]).map((s) => [s.id, s]));
  const { count: onDesk } = await db.from('newsroom_stories').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant).eq('status', 'new');
  lines.push(
    `- Newsroom morning brief${b ? ` (${b.day})` : ''}: ${b ? cut(b.summary, 500) || 'no summary' : 'none yet'}`,
    `- Hot topics to record (heat 0-100): ${hot.map((h) => { const s = S.get(h.story_id!); return `${s ? `"${cut(s.headline, 110)}" (${s.source}, ${s.status === 'in_studio' ? 'already in the Studio' : s.status})` : 'a story'}${typeof h.heat === 'number' ? ` heat ${Math.round(h.heat)}` : ''}${h.why ? `: ${cut(h.why, 140)}` : ''}${h.angle ? ` Angle: ${cut(h.angle, 120)}` : ''}`; }).join(' | ') || 'none'}.`,
    `- Stories new on the Newsroom desk: ${onDesk ?? 0} (story_list shows the whole desk; story_card and recording_card open one in full). Productions written but not recorded yet (scripts waiting for a take): ${((prods.data ?? []) as { story_id: string; angle: string; next_upload: boolean }[]).map((p) => `"${cut(S.get(p.story_id)?.headline ?? 'a story', 90)}" angle "${cut(p.angle, 80)}"${p.next_upload ? ' (the next upload is cut against it)' : ''}`).join('; ') || 'none'}.`,
  );
  return lines;
}
