'use client';
// The campaign's Approve: one tap sends every ready clip and the full video, and the user picks how it goes out.
//   Post now      everything within the next minutes
//   Helix plan    Helix's rhythm (flood, drip or steady) with its reason, from the story's heat and age, laid at each
//                 network's best hours and spread around the brand's other scheduled posts (the default)
//   My calendar   the same plan with a day and time per clip the user can change
// The preview is computed by lib/unedit-plan.ts, the same code the server schedules with, and the times shown are the
// times sent. Nothing goes to Metricool until a post is due; each stays movable on the Recordings calendar until then.
import { useEffect, useMemo, useState } from 'react';
import { campaignPosts, dayLabel, fromNyInput, nowTimes, nyAt, nyDay, nyInput, planPosts, RHYTHMS, slotLabel, type Busy, type PostMode, type Rhythm } from '@/lib/unedit-plan';

export type Planning = { rec: { rhythm: Rhythm; why: string }; busy: Busy[]; heat: number | null; headline: string | null };
type PClip = { id: string; n: number; hook: boolean; status: string; title: string };
const NETS: Record<string, string> = { instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', tiktok: 'TikTok', twitter: 'X', linkedin: 'LinkedIn' };
const KIND: Record<string, string> = { reel: 'Reel', short: 'Short', video: 'full video' };
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });

export function PostPlan({ clips, longform, planning, live, busy, onApprove }: { clips: PClip[]; longform: boolean; planning: Planning; live: boolean; busy: boolean; onApprove: (b: { mode: PostMode; rhythm?: Rhythm; at?: Record<string, string> }) => void }) {
  const [mode, setMode] = useState<PostMode>('plan');
  const [rhythm, setRhythm] = useState<Rhythm>(planning.rec.rhythm);
  const [moved, setMoved] = useState<Record<string, string>>({});
  // The plan starts from "now" in the browser (never during the server render, so the page hydrates cleanly), and
  // refreshes each minute so a card left open never shows a time that has passed.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); const t = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(t); }, []);

  const going = useMemo(() => clips.filter((c) => c.status === 'ready' || c.status === 'approved'), [clips]);
  const cutting = clips.filter((c) => c.status === 'rendering' || c.status === 'redo');
  const left = clips.filter((c) => c.status === 'dropped' || c.status === 'failed');
  const posts = useMemo(() => campaignPosts(going.map((c) => ({ id: c.id, n: c.n, hook: c.hook })), longform), [going, longform]);
  const nOf = useMemo(() => new Map(clips.map((c) => [c.id, c.n])), [clips]);
  const times = useMemo(() => {
    if (!now) return null;
    if (mode === 'now') return nowTimes(posts, now);
    const base = planPosts(posts, { rhythm, start: now, busy: planning.busy });
    if (mode !== 'calendar') return base;
    // A clip moved on the calendar moves all its posts together (they keep their spacing).
    const out = { ...base };
    for (const [unit, iso] of Object.entries(moved)) {
      const mine = posts.filter((p) => p.unit === unit);
      const first = Math.min(...mine.map((p) => Date.parse(base[p.key])));
      for (const p of mine) out[p.key] = new Date(Date.parse(base[p.key]) - first + Date.parse(iso)).toISOString();
    }
    return out;
  }, [now, mode, rhythm, posts, planning.busy, moved]);

  const sorted = times ? posts.map((p) => ({ ...p, at: times[p.key] })).sort((a, b) => a.at.localeCompare(b.at) || a.platform.localeCompare(b.platform)) : [];
  const days = useMemo(() => {
    const m = new Map<string, typeof sorted>();
    for (const p of sorted) { const d = dayLabel(p.at); m.set(d, [...(m.get(d) ?? []), p]); }
    return [...m.entries()];
  }, [sorted]);
  // Posts per day for two weeks, from today: the shape of the rhythm.
  const bars = useMemo(() => {
    if (!now) return [];
    const start = nyAt(nyDay(now), 0, 0); // midnight in New York
    return Array.from({ length: 14 }, (_, i) => sorted.filter((p) => { const d = Math.floor((Date.parse(p.at) - start.getTime()) / 86_400_000); return d === i; }).length);
  }, [sorted, now]);
  const max = Math.max(1, ...bars);
  const units = useMemo(() => [...new Set([...posts].sort((a, b) => a.rank - b.rank).map((p) => p.unit))], [posts]);
  const unitName = (u: string) => (u === 'video' ? 'Full video' : `Clip ${nOf.get(u) ?? ''}`);
  const first = sorted[0]?.at;
  const label = mode === 'now' ? `Post ${posts.length} now` : `Approve ${posts.length} post${posts.length === 1 ? '' : 's'}${mode === 'plan' ? ` · ${RHYTHMS[rhythm].name}` : ''}${first ? ` · first ${slotLabel(first)}` : ''}`;
  const blocked = cutting.length > 0 || posts.length === 0;

  return (
    <>
      <section className="ue-plan" aria-labelledby="ue-plan-h">
        <div className="ue-h"><h3 id="ue-plan-h">How should it go out?</h3><span className="muted">{going.length} clip{going.length === 1 ? '' : 's'}{longform ? ' and the full video' : ''} · {posts.length} posts{left.length ? ` · ${left.length} left out` : ''}</span></div>
        <div className="ue-seg" role="radiogroup" aria-label="When it posts">
          {([['now', 'Post now'], ['plan', 'Helix plan'], ['calendar', 'My calendar']] as const).map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={mode === k} className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>{l}</button>
          ))}
        </div>

        {mode === 'now' ? (
          <p className="ue-plan-why">Everything goes out within the next {Math.max(15, 15 + (units.length - 1) * 5)} minutes, a few minutes apart.{planning.rec.rhythm !== 'flood' ? ' Helix suggests a plan: spreading the clips out usually reaches more people than one burst.' : ''}</p>
        ) : (
          <div className="ue-plan-why">
            <span className="ue-plan-k">Helix recommends <b>{RHYTHMS[planning.rec.rhythm].name}</b></span>
            <span>{planning.rec.why}</span>
            <div className="ue-rhythms" role="radiogroup" aria-label="Rhythm">
              {(Object.keys(RHYTHMS) as Rhythm[]).map((r) => (
                <button key={r} type="button" role="radio" aria-checked={rhythm === r} className={rhythm === r ? 'on' : ''} onClick={() => { setRhythm(r); setMoved({}); }} title={RHYTHMS[r].blurb}>{RHYTHMS[r].name}</button>
              ))}
            </div>
            {rhythm !== planning.rec.rhythm ? <span className="muted ue-small">{RHYTHMS[rhythm].blurb}</span> : null}
          </div>
        )}

        {times ? (
          <>
            {mode !== 'now' ? (
              <div className="ue-bars" aria-label={`Posts per day for two weeks: ${bars.join(', ')}`}>
                {bars.map((n, i) => <i key={i} style={{ height: `${n ? Math.max(12, Math.round((n / max) * 100)) : 4}%` }} className={n ? '' : 'z'} title={`${n} post${n === 1 ? '' : 's'}`} />)}
                <span className="muted">Today</span><span className="muted">2 weeks</span>
              </div>
            ) : null}
            {mode === 'calendar' ? (
              <div className="ue-cal">
                {units.map((u) => {
                  const mine = sorted.filter((p) => p.unit === u);
                  if (!mine.length) return null;
                  return (
                    <label key={u} className="ue-cal-row">
                      <b>{unitName(u)}</b>
                      <input type="datetime-local" className="input" value={nyInput(mine[0].at)} min={now ? nyInput(new Date(now.getTime() + 20 * 60_000).toISOString()) : undefined}
                        onChange={(e) => { const iso = fromNyInput(e.target.value); if (iso) setMoved((m) => ({ ...m, [u]: iso })); }} />
                      <span className="muted">{mine.map((p) => `${NETS[p.platform]} ${time(p.at)}`).join(' · ')}</span>
                    </label>
                  );
                })}
                <span className="muted ue-small">Times are New York. Change any of them later on the Recordings calendar, until each post goes out.</span>
              </div>
            ) : (
              <ol className="ue-days">
                {days.map(([d, list]) => (
                  <li key={d}><b>{d}</b><span>{list.map((p) => <span key={p.key} className="ue-slot">{time(p.at)} · {unitName(p.unit)} · {NETS[p.platform]}{p.kind === 'video' ? '' : ` ${KIND[p.kind] ?? ''}`}</span>)}</span></li>
                ))}
              </ol>
            )}
          </>
        ) : <p className="muted">Planning…</p>}
      </section>

      <div className="ue-approve">
        <div>
          <b>{cutting.length ? `Clip ${cutting.map((c) => c.n).join(', ')} ${cutting.length === 1 ? 'is' : 'are'} still being cut` : posts.length ? `Ready: ${going.length} clip${going.length === 1 ? '' : 's'}${longform ? ' and the full video' : ''}` : 'Nothing to post: every clip is left out'}</b>
          <span className="muted">Approve sends every clip above that isn’t left out. {live ? 'Each post goes to Metricool shortly before its time.' : 'Posts land in Metricool as drafts; nothing goes public until it is published there.'}</span>
        </div>
        <button className="btn primary" type="button" disabled={blocked || busy || !times} onClick={() => onApprove(mode === 'now' ? { mode } : { mode, rhythm, at: times ?? undefined })}>{busy ? 'Approving…' : label}</button>
      </div>
    </>
  );
}
