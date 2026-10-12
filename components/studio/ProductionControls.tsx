'use client';
// StudioNext production controls: one approval produces the shots, then each finished shot asks only for a review.
// The same actions are Helix's voice tools (open Ask Helix on the board and say "produce the trailer"); these taps
// are the fallback. The bar keeps the board live while a run is going.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ActionResult } from '@/lib/actions';

const toast = (r: ActionResult) => { if (r) window.dispatchEvent(new CustomEvent('genovus:toast', { detail: r })); };
const direct = async (episode: string, tool: string, args: Record<string, unknown> = {}) =>
  fetch('/api/studio/direct', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ episode, tool, args }) }).then((x) => x.json()).catch(() => ({ ok: false, error: 'The Studio didn’t answer.' }));

export type RunState = { on: boolean; spent: string; ceiling: string; paused_reason: string | null };
export type Counts = { review: number; approved: number; active: number; capture: number; blocked: number; total: number };

export function ProductionBar({ episode, run, counts, estimate, needsLock, ready, blocked = [], health }: { episode: string; run: RunState; counts: Counts; estimate: string; needsLock: boolean; ready: boolean; blocked?: { board: number; note: string }[]; health?: RunHealth }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState<{ quote_id: string; total: string; ceiling: string; shots: number[] } | null>(null);
  // Live while a run is going: advance it and refresh the board.
  useEffect(() => {
    if (!run.on) return;
    let stop = false;
    const tick = async () => { await fetch(`/api/studio/direct?episode=${episode}`).catch(() => null); if (!stop) { router.refresh(); setTimeout(tick, 6000); } };
    const t = setTimeout(tick, 3000);
    return () => { stop = true; clearTimeout(t); };
  }, [run.on, episode, router]);
  const go = async (tool: string, args: Record<string, unknown> = {}) => {
    setBusy(true);
    const r = await direct(episode, tool, args);
    setBusy(false);
    if (!r.ok) toast({ err: r.error ?? 'That didn’t work.', at: Date.now() });
    router.refresh();
    return r;
  };
  const plan = async () => { const r = await go('plan', { shots: 'all' }); if (r.ok) setQ(r); };
  const raise = async () => { const r = await go('raise_ceiling'); if (r.ok) setQ(r); };
  const atCeiling = /ceiling/i.test(run.paused_reason ?? '');
  const approve = async () => { if (!q) return; const r = await go('approve', { quote_id: q.quote_id }); if (r.ok) { setQ(null); toast({ ok: r.say, at: Date.now() }); } };
  const fixRetry = async () => { if (needsLock) await go('lock_cast'); const r = await go('retry'); if (r.ok) toast({ ok: r.say ?? 'Retrying.', at: Date.now() }); };
  const pct = counts.total ? Math.round(((counts.review + counts.approved) / counts.total) * 100) : 0;
  return (
    <div className="pc-bar">
      <div className="pc-state">
        <span className={'pc-dot' + (run.on ? ' on' : '')} aria-hidden="true" />
        <span>
          <b>{run.on ? (counts.active ? 'In production' : 'Waiting on review') : run.paused_reason ? 'Paused' : counts.approved || counts.review ? 'Run finished' : 'Ready to produce'}</b>
          <small>{counts.approved} approved · {counts.review} to review · {counts.active} in production{counts.capture ? ` · ${counts.capture} phone capture` : ''}{counts.blocked ? ` · ${counts.blocked} blocked` : ''}{run.on || run.paused_reason ? ` · ${run.spent} of ${run.ceiling}` : ''}</small>
          {run.paused_reason ? <small className="pc-warn">{run.paused_reason}</small> : null}
          {health && (run.on || health.active) ? <RunHealthLine h={health} /> : null}
        </span>
        <span className="pc-progress" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
      </div>
      <div className="pc-actions">
        {blocked.length ? <button className="btn small primary" type="button" disabled={busy} onClick={fixRetry}>Fix &amp; retry {blocked.length === 1 ? `shot ${blocked[0].board}` : `${blocked.length} shots`}</button> : null}
        {needsLock && !blocked.length ? <button className="btn small" type="button" disabled={busy} onClick={() => go('lock_cast').then((r) => r.ok && toast({ ok: r.say, at: Date.now() }))}>Lock the cast</button> : null}
        {q ? (
          <span className="pc-confirm">
            <span>Shots {q.shots.join(', ')} · <b>{q.total}</b> <small>(ceiling {q.ceiling})</small></span>
            <button className="btn small primary" type="button" disabled={busy} onClick={approve}>Approve {q.total}</button>
            <button className="btn small ghost" type="button" onClick={() => setQ(null)}>Cancel</button>
          </span>
        ) : atCeiling ? <button className="btn small primary" type="button" disabled={busy} onClick={raise}>Approve more to finish</button>
          : run.on ? <button className="btn small ghost" type="button" disabled={busy} onClick={() => go('pause')}>Pause</button>
          : <button className="btn small primary" type="button" disabled={busy || !ready} onClick={plan}>Produce the episode · ~{estimate}</button>}
      </div>
      {blocked.length ? <p className="pc-blocked">⚠ {blocked.map((b) => `Shot ${b.board}: ${b.note}`).join(' · ')}</p> : null}
      <p className="pc-voice">🎙 Hands-free: open <b>Ask Helix</b> and say <i>“Produce the trailer”</i>, <i>“Approve shot 4”</i> or <i>“Redo shot 11, slower turn”</i>. Helix prices it, asks once, and does the rest.</p>
    </div>
  );
}

export function ShotReview({ episode, board, stage }: { episode: string; board: number; stage: string }) {
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (stage !== 'review') return null;
  const send = async (action: 'approve' | 'redo') => {
    setBusy(true);
    const r = await direct(episode, 'review', { shot: board, action, note: note ?? '' });
    setBusy(false);
    toast(r.ok ? { ok: action === 'approve' ? `Shot ${board} approved.` : `Shot ${board} is being redone.`, at: Date.now() } : { err: r.error, at: Date.now() });
    setNote(null);
    router.refresh();
  };
  return note === null ? (
    <span className="pc-review">
      <button className="btn small primary" type="button" disabled={busy} onClick={() => send('approve')}>Approve</button>
      <button className="btn small ghost" type="button" disabled={busy} onClick={() => setNote('')}>Redo…</button>
    </span>
  ) : (
    <span className="pc-review">
      <input className="input" autoFocus placeholder="What should change? e.g. slower turn, warmer smile" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send('redo')} />
      <button className="btn small primary" type="button" disabled={busy} onClick={() => send('redo')}>Redo</button>
      <button className="btn small ghost" type="button" onClick={() => setNote(null)}>✕</button>
    </span>
  );
}

export type MonitorStep = { key: string; label: string; state: 'waiting' | 'running' | 'done' | 'failed'; secs: number; status: string | null; progress: number | null; error: string | null; model: string | null; stuck: boolean; text: string };
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** A shot's live step timeline: each step's time, Runway's status, why it failed, and Retry / Stop when it's stuck. */
export function ShotMonitor({ episode, board, steps, stage, note }: { episode: string; board: number; steps: MonitorStep[]; stage: string; note: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const failed = steps.find((s) => s.state === 'failed');
  const stuck = steps.find((s) => s.stuck);
  const running = steps.some((s) => s.state === 'running');
  const needsHand = stage === 'blocked' || Boolean(stuck) || (Boolean(failed) && !running && stage !== 'review' && stage !== 'approved');
  const act = async (tool: 'retry_shot' | 'cancel_shot') => {
    setBusy(true);
    const r = await direct(episode, tool, { shot: board });
    setBusy(false);
    toast(r.ok ? { ok: r.say, at: Date.now() } : { err: r.error, at: Date.now() });
    router.refresh();
  };
  // Only shots in production show the monitor (an old, unrelated failure never nags an idle card).
  if (!stage || (!steps.length && stage !== 'blocked')) return null;
  return (
    <div className={'pm' + (stuck ? ' stuck' : '') + (stage === 'blocked' ? ' blocked' : '')}>
      <div className="pm-steps">
        {steps.map((s) => (
          <span key={s.key} className={'pm-step ' + s.state + (s.stuck ? ' stuck' : '')} title={s.model ?? undefined}>
            <i aria-hidden="true">{s.state === 'done' ? '✓' : s.state === 'failed' ? '✕' : s.state === 'running' ? '' : '·'}</i>
            <b>{s.label}</b> {mmss(s.secs)}{s.state === 'running' && s.text ? <em> {s.text}</em> : null}
            {s.state === 'running' && s.progress != null ? <span className="pm-bar"><span style={{ width: `${Math.round(s.progress * 100)}%` }} /></span> : null}
          </span>
        ))}
      </div>
      {steps.find((s) => s.key === 'take' && s.model) ? <small className="pm-model">Take on {steps.find((s) => s.key === 'take')!.model}</small> : null}
      {stuck ? <p className="pm-msg warn">⏱ {stuck.label} has taken {mmss(stuck.secs)}, longer than it should. Runway: {stuck.text || 'no update'}.</p> : null}
      {failed ? <p className="pm-msg err">✕ {failed.label} failed: {failed.error}</p> : null}
      {stage === 'blocked' && note && !failed ? <p className="pm-msg err">⚠ {note}</p> : null}
      {needsHand ? (
        <span className="pm-actions">
          <button className="btn small primary" type="button" disabled={busy} onClick={() => act('retry_shot')}>Retry shot</button>
          {running ? <button className="btn small ghost" type="button" disabled={busy} onClick={() => act('cancel_shot')}>Stop &amp; refund</button> : null}
        </span>
      ) : null}
    </div>
  );
}

export type RunHealth = { elapsed: number; left: number | null; credits: number | null; active: number };
export function RunHealthLine({ h }: { h: RunHealth }) {
  return (
    <span className="pm-health">
      <span>⏱ {mmss(h.elapsed)} elapsed</span>
      {h.left != null && h.active ? <span>≈ {Math.max(1, Math.round(h.left / 60))} min to go</span> : null}
      {h.credits != null ? <span>Runway credits {h.credits.toLocaleString()} (${(h.credits / 100).toFixed(2)})</span> : null}
    </span>
  );
}
