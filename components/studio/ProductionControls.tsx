'use client';
// StudioNext production controls: one approval produces the shots, then each finished shot asks only for a review.
// The same actions are Helix's voice tools (open Ask Helix on the board and say "produce the trailer"); these taps
// are the fallback. The bar keeps the board live while a run is going.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { upload } from '@vercel/blob/client';
import type { ActionResult } from '@/lib/actions';

const toast = (r: ActionResult) => { if (r) window.dispatchEvent(new CustomEvent('genovus:toast', { detail: r })); };
const direct = async (episode: string, tool: string, args: Record<string, unknown> = {}) =>
  fetch('/api/studio/direct', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ episode, tool, args }) }).then((x) => x.json()).catch(() => ({ ok: false, error: 'The Studio didn’t answer.' }));

export type RunState = { on: boolean; spent: string; ceiling: string; paused_reason: string | null; finishing?: boolean; finished?: boolean; finish_note?: string | null };
export type Counts = { review: number; approved: number; active: number; capture: number; blocked: number; total: number; draftOk?: number };
export type Estimates = { draft: string; final: string; finalDrafts: string };

export function ProductionBar({ episode, hasFinal = false, published = false, run, counts, estimate, needsLock, ready, blocked = [], health, est }: { episode: string; hasFinal?: boolean; published?: boolean; run: RunState; counts: Counts; estimate: string; needsLock: boolean; ready: boolean; blocked?: { board: number; note: string }[]; health?: RunHealth; est?: Estimates }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState<{ quote_id: string; total: string; ceiling: string; shots: number[]; pass?: string } | null>(null);
  // Live while a run is going: advance it and refresh the board.
  useEffect(() => {
    if (!run.on && !run.finishing) return;
    let stop = false;
    const tick = async () => { await fetch(`/api/studio/direct?episode=${episode}`).catch(() => null); if (!stop) { router.refresh(); setTimeout(tick, 6000); } };
    const t = setTimeout(tick, 3000);
    return () => { stop = true; clearTimeout(t); };
  }, [run.on, run.finishing, episode, router]);
  const go = async (tool: string, args: Record<string, unknown> = {}) => {
    setBusy(true);
    const r = await direct(episode, tool, args);
    setBusy(false);
    if (!r.ok) toast({ err: r.error ?? 'That didn’t work.', at: Date.now() });
    router.refresh();
    return r;
  };
  const plan = async (pass: 'draft' | 'final' = 'final', shots = 'all') => { const r = await go('plan', { shots, pass }); if (r.ok) setQ(r); };
  // One tap: inside the $5 line it starts and finishes on its own; over it, the quote shows for one approval.
  const produce = async () => { const r = await go('plan', { shots: 'all', pass: 'final', auto: true }); if (!r.ok) return; if (r.started) toast({ ok: r.say, at: Date.now() }); else { setQ(r); if (r.say) toast({ ok: r.say, at: Date.now() }); } };
  const publish = async () => { const r = await go('publish'); if (r.ok) toast({ ok: r.say, at: Date.now() }); };
  const finishNow = async () => { const r = await go('finish'); if (r.ok) toast({ ok: r.say, at: Date.now() }); };
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
          <b>{run.finishing ? 'Finishing: final cut and Shorts' : counts.active ? 'In production' : published && run.finished ? 'Published' : run.finished && hasFinal ? 'Finished · ready to publish' : run.paused_reason ? 'Paused' : run.on ? 'Landing the last shots' : counts.approved || counts.review ? 'Run finished' : 'Ready to produce'}</b>
          <small>{counts.approved} approved{counts.draftOk ? ` · ${counts.draftOk} drafts approved` : ''} · {counts.review} to review · {counts.active} in production{counts.capture ? ` · ${counts.capture} phone capture` : ''}{counts.blocked ? ` · ${counts.blocked} blocked` : ''}{run.on || run.paused_reason ? ` · ${run.spent} of ${run.ceiling}` : ''}</small>
          {run.paused_reason ? <small className="pc-warn">{run.paused_reason}</small> : null}
          {run.finish_note && !run.finishing ? <small className={/^Couldn|failed/.test(run.finish_note) ? 'pc-warn' : 'pc-ok'}>{run.finish_note}</small> : null}
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
        ) : run.finishing ? <span className="muted"><span className="take-spin" /> Rendering the final cut and Shorts…</span>
          : hasFinal && run.finished && !published && !counts.active && !counts.draftOk ? <><button className="btn small primary" type="button" disabled={busy} onClick={publish}>Publish the episode</button><button className="btn small ghost" type="button" disabled={busy || !ready} onClick={produce}>Produce again · ~{est?.final ?? estimate}</button></>
          : atCeiling ? <button className="btn small primary" type="button" disabled={busy} onClick={raise}>Approve more to finish</button>
          : run.on && !counts.draftOk ? <button className="btn small ghost" type="button" disabled={busy} onClick={() => go('pause')}>Pause</button>
          : counts.draftOk ? <><button className="btn small primary" type="button" disabled={busy || !ready} onClick={() => plan('final', 'drafts')}>Render final · {counts.draftOk} approved draft{counts.draftOk === 1 ? '' : 's'} · ~{est?.finalDrafts ?? estimate}</button><button className="btn small ghost" type="button" disabled={busy || !ready} onClick={() => plan('draft')}>Draft the rest</button></>
          : run.finish_note && /^Couldn|failed/.test(run.finish_note) ? <button className="btn small primary" type="button" disabled={busy} onClick={finishNow}>Finish now</button>
          : <><button className="btn small primary" type="button" disabled={busy || !ready} onClick={produce}>Produce the episode · ~{est?.final ?? estimate}</button><button className="btn small ghost" type="button" disabled={busy || !ready} onClick={() => plan('draft')}>Quick draft first · ~{est?.draft ?? estimate}</button></>}
      </div>
      {blocked.length ? <p className="pc-blocked">⚠ {blocked.map((b) => `Shot ${b.board}: ${b.note}`).join(' · ')}</p> : null}
      <p className="pc-voice">🎙 Hands-free: open <b>Ask Helix</b> and say <i>“Produce the trailer”</i>, <i>“Approve shot 4”</i> or <i>“Redo shot 11, slower turn”</i>. Inside the $5 line it starts on its own and finishes itself (final cut and Shorts); you tap Publish. Over $5, Helix asks once.</p>
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
 * Finish dialogue (Act-Two): the front camera opens and a teleprompter above it feeds the lines one at a time, each
 * held for as long as the character's read lasts, so the person performs in the read's timing without hearing it
 * (or, with earphones, along with it). The recording drives the character's face in the take, so the lips land on
 * the read's timing; the voice stays the read. Helix's voice session is hushed while the recorder is open, so it
 * neither hears the lines nor talks over the take. Opens from the card, or from Helix ("finish the dialogue on shot 4").
 */
export type PromptLine = { id: string; label: string; text: string };
// A read's length when its audio can't be measured: the cast's delivery is about 2.4 words a second.
const guessSecs = (text: string) => Math.max(1.6, text.replace(/\[[^\]]*\]/g, ' ').trim().split(/\s+/).length / 2.4);
// H.264 first: Runway takes it everywhere; some Chrome builds otherwise put VP9 inside the MP4.
const REC_TYPES = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,opus', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
// Direction tags ([warmly]) show as quiet italics, not words to say.
const Prompt = ({ text }: { text: string }) => <>{text.split(/(\[[^\]]+\])/g).map((part, i) => (/^\[.*\]$/.test(part) ? <i key={i}>{part.slice(1, -1)}</i> : <span key={i}>{part}</span>))}</>;

export function FinishDialogue({ episode, board, shotId, reads }: { episode: string; board: number; shotId: string; reads: PromptLine[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'ready' | 'count' | 'rec' | 'review' | 'sending'>('idle');
  const [count, setCount] = useState(3);
  const [clip, setClip] = useState<Blob | null>(null);
  const [err, setErr] = useState('');
  const [secs, setSecs] = useState<number[]>([]);
  const [cur, setCur] = useState(0);
  const [hear, setHear] = useState(false);
  const live = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const prompter = useRef<HTMLDivElement>(null);
  useEffect(() => { prompter.current?.querySelector('p.on')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [cur]);
  const clipUrl = useMemo(() => (clip ? URL.createObjectURL(clip) : ''), [clip]);
  useEffect(() => () => { if (clipUrl) URL.revokeObjectURL(clipUrl); }, [clipUrl]);
  useEffect(() => {
    const onAsk = (e: Event) => { if ((e as CustomEvent).detail?.shot === board) setOpen(true); };
    window.addEventListener('genovus:finish-dialogue', onAsk);
    return () => window.removeEventListener('genovus:finish-dialogue', onAsk);
  }, [board]);
  // Helix stays quiet (and stops listening) while the recorder is open.
  useEffect(() => {
    if (!open) return;
    window.dispatchEvent(new CustomEvent('genovus:helix-hush', { detail: { on: true } }));
    return () => { window.dispatchEvent(new CustomEvent('genovus:helix-hush', { detail: { on: false } })); };
  }, [open]);
  // How long each read lasts, so the teleprompter holds each line for exactly that long.
  const readKey = reads.map((r) => r.id).join(',');
  useEffect(() => {
    if (!open) return;
    let gone = false;
    Promise.all(reads.map((r) => new Promise<number>((done) => {
      const a = new Audio(); a.preload = 'metadata';
      const t = setTimeout(() => done(guessSecs(r.text)), 5000);
      a.onloadedmetadata = () => { clearTimeout(t); done(isFinite(a.duration) && a.duration > 0 ? a.duration : guessSecs(r.text)); };
      a.onerror = () => { clearTimeout(t); done(guessSecs(r.text)); };
      a.src = `/api/studio/media/voice/${r.id}`;
    }))).then((d) => { if (!gone) setSecs(d); });
    return () => { gone = true; };
  }, [open, readKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => stream.current?.getTracks().forEach((t) => t.stop()), []);
  // The live view has its own element (the review plays in another), and the camera re-attaches whenever it
  // mounts, so a retake always shows the live feed.
  const attach = (el: HTMLVideoElement | null) => {
    live.current = el;
    if (el && stream.current && el.srcObject !== stream.current) { el.srcObject = stream.current; el.play().catch(() => {}); }
  };
  const stop = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; if (live.current) live.current.srcObject = null; };
  const camera = async () => {
    setErr('');
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true });
      attach(live.current);
      setPhase('ready');
    } catch { setErr('The camera didn’t open. Allow camera and microphone, or upload a video instead.'); }
  };
  const record = async () => {
    if (!stream.current) return;
    attach(live.current);
    setClip(null); setCur(0); setErr(''); setPhase('count');
    for (let i = 3; i > 0; i--) { setCount(i); await new Promise((r) => setTimeout(r, 800)); }
    const type = REC_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
    const rec = new MediaRecorder(stream.current, type ? { mimeType: type } : undefined);
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    const stopped = new Promise<void>((r) => { rec.onstop = () => r(); });
    rec.start(250); setPhase('rec');
    const started = Date.now();
    // One line at a time on the prompter, each held for its read's length (with earphones on, the read plays too).
    for (let i = 0; i < reads.length; i++) {
      setCur(i);
      if (hear) {
        const a = new Audio(`/api/studio/media/voice/${reads[i].id}`);
        await new Promise<void>((done) => { a.onended = () => done(); a.onerror = () => done(); a.play().catch(() => done()); });
      } else await new Promise((r) => setTimeout(r, (secs[i] ?? guessSecs(reads[i].text)) * 1000));
      if (i < reads.length - 1) await new Promise((r) => setTimeout(r, 350));
    }
    // At least 3.2 s in all (Act-Two's minimum is 3 s), and a beat after the last line.
    await new Promise((r) => setTimeout(r, Math.max(600, 3200 - (Date.now() - started))));
    rec.stop(); await stopped;
    const blob = new Blob(parts, { type: rec.mimeType || type || 'video/webm' });
    if (!blob.size) { setErr('Nothing was recorded. Check that no other app is using the camera, then record again.'); setPhase('ready'); return; }
    setClip(blob);
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
  const rolling = phase === 'rec';
  const lineSecs = (i: number) => secs[i] ?? guessSecs(reads[i].text);
  const total = reads.reduce((t, _, i) => t + lineSecs(i), 0);
  return (
    <div className="fd">
      <b>Finish dialogue · Act-Two</b>
      <small className="muted">Read {reads.length === 1 ? 'the line' : 'the lines'} from the prompter, face to the camera, in good light. Each line stays up as long as its read lasts ({total.toFixed(1)} s in all): finish it as the bar fills. Your mouth and expression drive {[...new Set(reads.map((r) => r.label))].join(' and ')}; the voice stays the read. Helix is quiet while this is open.</small>
      <div ref={prompter} className={'fd-prompt' + (rolling ? ' rolling' : '')} aria-live="polite">
        {reads.map((r, i) => (
          <p key={r.id + i} className={i === cur ? 'on' : i < cur && rolling ? 'done' : ''}>
            <small>{r.label} · {lineSecs(i).toFixed(1)} s</small>
            <span><Prompt text={r.text} /></span>
            {i === cur && rolling ? <em className="fd-pace" style={{ animationDuration: `${lineSecs(i)}s` }} /> : null}
          </p>
        ))}
      </div>
      <div className="fd-cam">
        <video ref={attach} muted playsInline autoPlay style={phase === 'review' && clip ? { display: 'none' } : undefined} />
        {phase === 'review' && clip ? <video key={clipUrl} src={clipUrl} controls playsInline /> : null}
        {phase === 'count' ? <span className="fd-count">{count}</span> : null}
        {rolling ? <span className="fd-rec">● Recording · line {cur + 1} of {reads.length}</span> : null}
      </div>
      <span className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {phase === 'idle' ? <button className="btn small primary" type="button" onClick={camera}>Open the camera</button> : null}
        {phase === 'ready' ? <button className="btn small primary" type="button" onClick={record}>Record</button> : null}
        {phase === 'review' && clip ? <><button className="btn small primary" type="button" onClick={() => send(clip)}>Use this take</button><button className="btn small ghost" type="button" onClick={() => { setClip(null); setCur(0); setPhase('ready'); }}>Record again</button></> : null}
        {phase === 'sending' ? <span className="muted"><span className="take-spin" /> Sending to Act-Two…</span> : null}
        {phase === 'idle' || phase === 'ready' ? <label className="muted fd-hear"><input type="checkbox" checked={hear} onChange={(e) => setHear(e.target.checked)} /> Play the read while I record (earphones)</label> : null}
        <input ref={file} type="file" accept="video/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) send(f, f.name); }} />
        {phase !== 'sending' && !rolling ? <button className="btn small ghost" type="button" onClick={() => file.current?.click()}>Upload a video instead</button> : null}
        {!rolling ? <button className="btn small ghost" type="button" onClick={() => { stop(); setOpen(false); setPhase('idle'); setClip(null); setCur(0); }}>Close</button> : null}
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
export function RenderPanel({ episode, episodeId, hasFinal, draft, problems, shorts = [], renders = [] }: { episode: string; episodeId: string; hasFinal: boolean; draft: { at: string; note: string | null } | null; problems: { label: string; detail: string; kind: string }[]; shorts?: { code: string; title: string; shots: number[] }[]; renders?: { id: string; kind: string; format: string; short: string | null; title: string; secs: number; at: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const render = async (kind: 'draft' | 'final' | 'short', short?: string) => {
    setBusy(short ? `short:${short}` : kind);
    const r = await fetch(`/api/studio/render/${episode}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, short, format: short ? 'vertical' : 'wide' }) }).then((x) => x.json()).catch(() => ({ ok: false, error: 'The render didn’t answer.' }));
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
      {shorts.length ? (
        <div className="rp-shorts">
          <b>Shorts · 9:16</b>
          {shorts.map((s) => {
            const last = renders.find((x) => x.kind === 'short' && x.short === s.code && x.format === 'vertical');
            return (
              <div key={s.code} className="rp-short">
                <span><b>{s.title}</b><small className="muted"> · {s.shots.length} shots{last ? ` · rendered ${Math.round(last.secs)} s` : ''}</small></span>
                <span className="row" style={{ gap: 6 }}>
                  {last ? <a className="btn small ghost" href={`/api/studio/media/render/${last.id}`} target="_blank" rel="noreferrer">Play</a> : null}
                  <button className="btn small" type="button" disabled={Boolean(busy)} onClick={() => render('short', s.code)}>{busy === `short:${s.code}` ? 'Rendering…' : last ? 'Render again' : 'Render'}</button>
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
