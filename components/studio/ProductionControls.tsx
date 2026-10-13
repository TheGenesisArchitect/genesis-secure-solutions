'use client';
// StudioNext production controls: one approval produces the shots, then each finished shot asks only for a review.
// The same actions are Helix's voice tools (open Ask Helix on the board and say "produce the trailer"); these taps
// are the fallback. The bar keeps the board live while a run is going.
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { upload } from '@vercel/blob/client';
import type { ActionResult } from '@/lib/actions';

const toast = (r: ActionResult) => { if (r) window.dispatchEvent(new CustomEvent('genovus:toast', { detail: r })); };
const direct = async (episode: string, tool: string, args: Record<string, unknown> = {}) =>
  fetch('/api/studio/direct', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ episode, tool, args }) }).then((x) => x.json()).catch(() => ({ ok: false, error: 'The Studio didn’t answer.' }));

export type RunState = { on: boolean; spent: string; ceiling: string; paused_reason: string | null };
export type Counts = { review: number; approved: number; active: number; capture: number; blocked: number; total: number; draftOk?: number };
export type Estimates = { draft: string; final: string; finalDrafts: string };

export function ProductionBar({ episode, run, counts, estimate, needsLock, ready, blocked = [], health, est }: { episode: string; run: RunState; counts: Counts; estimate: string; needsLock: boolean; ready: boolean; blocked?: { board: number; note: string }[]; health?: RunHealth; est?: Estimates }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState<{ quote_id: string; total: string; ceiling: string; shots: number[]; pass?: string } | null>(null);
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
  const plan = async (pass: 'draft' | 'final' = 'final', shots = 'all') => { const r = await go('plan', { shots, pass }); if (r.ok) setQ(r); };
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
          <small>{counts.approved} approved{counts.draftOk ? ` · ${counts.draftOk} drafts approved` : ''} · {counts.review} to review · {counts.active} in production{counts.capture ? ` · ${counts.capture} phone capture` : ''}{counts.blocked ? ` · ${counts.blocked} blocked` : ''}{run.on || run.paused_reason ? ` · ${run.spent} of ${run.ceiling}` : ''}</small>
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
            <span>{(q as { pass?: string }).pass === 'draft' ? 'Quick draft of shots' : 'Final render of shots'} {q.shots.join(', ')} · <b>{q.total}</b> <small>(ceiling {q.ceiling})</small></span>
            <button className="btn small primary" type="button" disabled={busy} onClick={approve}>Approve {q.total}</button>
            <button className="btn small ghost" type="button" onClick={() => setQ(null)}>Cancel</button>
          </span>
        ) : atCeiling ? <button className="btn small primary" type="button" disabled={busy} onClick={raise}>Approve more to finish</button>
          : run.on && !counts.draftOk ? <button className="btn small ghost" type="button" disabled={busy} onClick={() => go('pause')}>Pause</button>
          : counts.draftOk ? <><button className="btn small primary" type="button" disabled={busy || !ready} onClick={() => plan('final', 'drafts')}>Render final · {counts.draftOk} approved draft{counts.draftOk === 1 ? '' : 's'} · ~{est?.finalDrafts ?? estimate}</button><button className="btn small ghost" type="button" disabled={busy || !ready} onClick={() => plan('draft')}>Draft the rest</button></>
          : <><button className="btn small primary" type="button" disabled={busy || !ready} onClick={() => plan('draft')}>Quick draft the episode · ~{est?.draft ?? estimate}</button><button className="btn small ghost" type="button" disabled={busy || !ready} onClick={() => plan('final')}>Final quality · ~{est?.final ?? estimate}</button></>}
      </div>
      {blocked.length ? <p className="pc-blocked">⚠ {blocked.map((b) => `Shot ${b.board}: ${b.note}`).join(' · ')}</p> : null}
      <p className="pc-voice">🎙 Hands-free: open <b>Ask Helix</b> and say <i>“Produce the trailer”</i>, <i>“Approve shot 4”</i> or <i>“Redo shot 11, slower turn”</i>. Helix prices it, asks once, and does the rest.</p>
    </div>
  );
}

export function ShotReview({ episode, board, stage, draft, pictureOnly }: { episode: string; board: number; stage: string; draft?: boolean; pictureOnly?: boolean }) {
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!['review', 'approved', 'draft_ok'].includes(stage)) return null;
  const send = async (action: 'approve' | 'redo' | 'reopen') => {
    setBusy(true);
    const r = await direct(episode, 'review', { shot: board, action, note: note ?? '' });
    setBusy(false);
    toast(r.ok ? { ok: action === 'approve' ? (draft ? `Shot ${board} draft approved: it’s ready for its final render.` : r.say ?? `Shot ${board} approved.`) : action === 'reopen' ? `Shot ${board} is back in review.` : `Shot ${board} is being redone.`, at: Date.now() } : { err: r.error, at: Date.now() });
    setNote(null);
    router.refresh();
  };
  if (stage !== 'review') return <span className="pc-review"><button className="btn small ghost" type="button" disabled={busy} onClick={() => send('reopen')}>Reopen</button></span>;
  return note === null ? (
    <span className="pc-review">
      <button className="btn small primary" type="button" disabled={busy} onClick={() => send('approve')} title={pictureOnly ? 'The dialogue isn’t finished: this approves the picture; the card keeps the dialogue flagged.' : undefined}>{draft ? 'Approve draft' : pictureOnly ? 'Approve picture' : 'Approve'}</button>
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
export function ShotMonitor({ episode, board, steps, stage, note, decision }: { episode: string; board: number; steps: MonitorStep[]; stage: string; note: string | null; decision?: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const failed = steps.find((s) => s.state === 'failed');
  const stuck = steps.find((s) => s.stuck);
  const running = steps.some((s) => s.state === 'running');
  const needsHand = stage === 'blocked' || Boolean(stuck) || (Boolean(failed) && !running && stage !== 'review' && stage !== 'approved');
  const act = async (tool: 'retry_shot' | 'cancel_shot' | 'use_gen45') => {
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
          {decision === 'first_party' ? <button className="btn small primary" type="button" disabled={busy} onClick={() => act('use_gen45')}>Use Gen-4.5</button> : null}
          <button className={'btn small ' + (decision === 'first_party' ? 'ghost' : 'primary')} type="button" disabled={busy} onClick={() => act('retry_shot')}>Retry shot</button>
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

/**
 * Finish dialogue (Act-Two): the front camera opens, the character's line read plays, and the person says or
 * mouths the line along with it. The recording drives the character's face in the take, so the lips land on the
 * read's timing; the voice stays the read. Opens from the card, or from Helix ("finish the dialogue on shot 4").
 */
export function FinishDialogue({ episode, board, shotId, reads }: { episode: string; board: number; shotId: string; reads: { id: string; label: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'ready' | 'count' | 'rec' | 'review' | 'sending'>('idle');
  const [count, setCount] = useState(3);
  const [clip, setClip] = useState<Blob | null>(null);
  const [err, setErr] = useState('');
  const live = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onAsk = (e: Event) => { if ((e as CustomEvent).detail?.shot === board) setOpen(true); };
    window.addEventListener('genovus:finish-dialogue', onAsk);
    return () => window.removeEventListener('genovus:finish-dialogue', onAsk);
  }, [board]);
  useEffect(() => () => stream.current?.getTracks().forEach((t) => t.stop()), []);
  const stop = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };
  const camera = async () => {
    setErr('');
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true });
      if (live.current) { live.current.srcObject = stream.current; await live.current.play().catch(() => {}); }
      setPhase('ready');
    } catch { setErr('The camera didn’t open. Allow camera and microphone, or upload a video instead.'); }
  };
  const record = async () => {
    if (!stream.current) return;
    setPhase('count');
    for (let i = 3; i > 0; i--) { setCount(i); await new Promise((r) => setTimeout(r, 800)); }
    const type = ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
    const rec = new MediaRecorder(stream.current, type ? { mimeType: type } : undefined);
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    const stopped = new Promise<void>((r) => { rec.onstop = () => r(); });
    rec.start(250); setPhase('rec');
    const started = Date.now();
    // The reads play in order while the person performs along. At least 3.2 s (Act-Two's minimum is 3 s).
    for (const r of reads) {
      const a = new Audio(`/api/studio/media/voice/${r.id}`);
      await new Promise<void>((done) => { a.onended = () => done(); a.onerror = () => done(); a.play().catch(() => done()); });
    }
    await new Promise((r) => setTimeout(r, Math.max(600, 3200 - (Date.now() - started))));
    rec.stop(); await stopped;
    setClip(new Blob(parts, { type: rec.mimeType || 'video/webm' }));
    setPhase('review');
  };
  const send = async (blob: Blob, name?: string) => {
    setPhase('sending'); setErr('');
    try {
      // Recorders label clips with codecs (video/mp4;codecs=…); storage takes the plain type.
      const ext = name?.split('.').pop()?.toLowerCase() ?? (/mp4/.test(blob.type) ? 'mp4' : /quicktime/.test(blob.type) ? 'mov' : 'webm');
      const up = await upload(`studio/uploads/${shotId}/performance-${Date.now()}.${ext}`, blob, { access: 'private', handleUploadUrl: '/api/studio/upload', contentType: (blob.type || 'video/mp4').split(';')[0] });
      const r = await direct(episode, 'finish_dialogue', { shot: board, recording: up.pathname });
      if (!r.ok) throw new Error(r.error ?? 'Act-Two couldn’t start.');
      toast({ ok: r.say, at: Date.now() });
      stop(); setOpen(false); setPhase('idle'); setClip(null);
      router.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Upload failed.'); setPhase(clip ? 'review' : 'idle'); }
  };
  if (!reads.length) return null;
  if (!open) return <button className="btn small" type="button" onClick={() => setOpen(true)}>🎙 Finish dialogue</button>;
  return (
    <div className="fd">
      <b>Finish dialogue · Act-Two</b>
      <small className="muted">The read plays: say or mouth {reads.length === 1 ? 'the line' : 'the lines'} along with it, face to the camera, in good light. Your mouth and expression drive {reads.map((r) => r.label).join(' and ')}; the voice stays the read.</small>
      <div className="fd-cam">
        {phase === 'review' && clip ? <video src={URL.createObjectURL(clip)} controls playsInline /> : <video ref={live} muted playsInline />}
        {phase === 'count' ? <span className="fd-count">{count}</span> : null}
        {phase === 'rec' ? <span className="fd-rec">● Recording</span> : null}
      </div>
      <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {phase === 'idle' ? <button className="btn small primary" type="button" onClick={camera}>Open the camera</button> : null}
        {phase === 'ready' ? <button className="btn small primary" type="button" onClick={record}>Record along with the read</button> : null}
        {phase === 'review' && clip ? <><button className="btn small primary" type="button" onClick={() => send(clip)}>Use this take</button><button className="btn small ghost" type="button" onClick={() => { setClip(null); setPhase('ready'); }}>Record again</button></> : null}
        {phase === 'sending' ? <span className="muted"><span className="take-spin" /> Sending to Act-Two…</span> : null}
        <input ref={file} type="file" accept="video/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) send(f, f.name); }} />
        {phase !== 'sending' ? <button className="btn small ghost" type="button" onClick={() => file.current?.click()}>Upload a video instead</button> : null}
        <button className="btn small ghost" type="button" onClick={() => { stop(); setOpen(false); setPhase('idle'); setClip(null); }}>Close</button>
      </span>
      {err ? <p className="pm-msg err">{err}</p> : null}
    </div>
  );
}

/** A person watched the take: the lips match the read. Marks this take's lip-sync verified. */
export function VerifySync({ episode, board }: { episode: string; board: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return <button className="btn small ghost" type="button" disabled={busy} onClick={async () => { setBusy(true); const r = await direct(episode, 'verify_sync', { shot: board }); setBusy(false); toast(r.ok ? { ok: r.say, at: Date.now() } : { err: r.error, at: Date.now() }); router.refresh(); }}>✓ Lips look right</button>;
}

/** Render the episode from its timeline: a draft cut any time, the final once nothing's left open. */
export function RenderPanel({ episode, episodeId, hasFinal, draft, problems }: { episode: string; episodeId: string; hasFinal: boolean; draft: { at: string; note: string | null } | null; problems: { label: string; detail: string; kind: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'draft' | 'final' | null>(null);
  const render = async (kind: 'draft' | 'final') => {
    setBusy(kind);
    const r = await fetch(`/api/studio/render/${episode}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind }) }).then((x) => x.json()).catch(() => ({ ok: false, error: 'The render didn’t answer.' }));
    setBusy(null);
    toast(r.ok ? { ok: r.say, at: Date.now() } : { err: r.error, at: Date.now() });
    router.refresh();
  };
  return (
    <div className="rp">
      <span className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn small" type="button" disabled={Boolean(busy)} onClick={() => render('draft')}>{busy === 'draft' ? 'Rendering the draft cut…' : 'Render draft cut'}</button>
        <button className="btn small primary" type="button" disabled={Boolean(busy) || problems.length > 0} onClick={() => render('final')} title={problems.length ? 'Finish the items below first' : undefined}>{busy === 'final' ? 'Rendering the final…' : 'Render final'}</button>
        <a className="btn small ghost" href={`/console/studio/screen/${episode}`}>Preview the cut</a>
        {draft ? <a className="btn small ghost" href={`/api/studio/media/draft/${episodeId}`} target="_blank" rel="noreferrer">Play the draft cut</a> : null}
        {hasFinal ? <a className="btn small ghost" href={`/api/studio/media/final/${episodeId}`} target="_blank" rel="noreferrer">Play the final</a> : null}
        {busy ? <small className="muted">This takes a minute or two: picture, captions, dialogue and score.</small> : null}
      </span>
      {problems.length ? (
        <details className="pb-more" open={problems.length <= 4}>
          <summary>{problems.length} thing{problems.length === 1 ? '' : 's'} to finish before the final</summary>
          <ul className="rp-list">{problems.map((p, i) => <li key={i}><b>{p.label}</b> {p.detail}</li>)}</ul>
        </details>
      ) : <small className="pb-lib">✓ Everything's in place for the final render.</small>}
    </div>
  );
}
