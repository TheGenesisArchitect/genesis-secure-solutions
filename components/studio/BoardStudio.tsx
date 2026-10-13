'use client';
// StudioNext production board controls (Runway): per shot, read the lines, draw keyframes, render takes and pick
// what goes in the edit; per cast member, lock the identity and choose the voice; per episode, compose the score.
// Capture shots link to the exact screens and take recordings or screenshots straight from a phone. Every button
// is a person's decision; costs are shown before anything starts, and the board refreshes itself as jobs finish.
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { upload } from '@vercel/blob/client';
import { studioApproveRef, studioChooseClip, studioChooseFrame, studioChooseTake, studioRegisterUpload, studioSetRunwayVoice, studioSetShotScreens, type ActionResult } from '@/lib/actions';

const toast = (r: ActionResult) => { if (r) window.dispatchEvent(new CustomEvent('genovus:toast', { detail: r })); };
const ok = (msg: string) => toast({ ok: msg, at: Date.now() });
const err = (msg: string) => toast({ err: msg, at: Date.now() });
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

/** Start a Runway job, then keep the board fresh until the shot's jobs finish. */
function useRunway(shot?: string, running = false) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [watch, setWatch] = useState(running);
  useEffect(() => { if (running) setWatch(true); }, [running]);
  useEffect(() => {
    if (!watch) return;
    let stop = false;
    const tick = async () => {
      const r = await fetch(`/api/studio/runway${shot ? `?shot=${shot}` : ''}`).then((x) => x.json()).catch(() => ({}));
      router.refresh();
      if (!stop && (r.running || r.download_wait || r.errors)) setTimeout(tick, 5000); else setWatch(false);
    };
    const t = setTimeout(tick, 4000);
    return () => { stop = true; clearTimeout(t); };
  }, [watch, shot, router]);
  const start = async (kind: string, body: Record<string, string>) => {
    setBusy(kind);
    const r = await fetch('/api/studio/runway', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, ...body }) }).then(async (x) => ({ okay: x.ok, j: await x.json().catch(() => ({})) }));
    setBusy(null);
    if (r.okay) { ok(r.j.note ?? 'Started.'); setWatch(true); } else err(r.j.error ?? 'Could not start it.');
    router.refresh();
  };
  return { busy, start, watching: watch };
}

const act = async (fn: (p: ActionResult, f: FormData) => Promise<ActionResult>, o: Record<string, string>, refresh: () => void) => { toast(await fn(null, fd(o))); refresh(); };

export type BoardLine = { slot: string; speaker: string; text: string; reads: { id: string; status: string; approved: boolean; error: string | null }[] };
export type BoardFrame = { id: string; status: string; chosen: boolean; error: string | null };
export type BoardTake = { id: string; status: string; chosen: boolean; kind: string; error: string | null; cost_cents: number; still?: boolean };
export type CaptureRecipe = { device?: string; note?: string; steps?: { label: string; route: string; action?: string }[] };

export function ShotStudio(p: {
  shot: string; tool: string; engine: string | null; ready: boolean; lines: BoardLine[]; frames: BoardFrame[]; takes: BoardTake[];
  cost: { line: number; keyframes: number; take: number }; takeSecs: number; capture: CaptureRecipe | null; needsFrame: boolean;
  screens?: string[]; library?: { key: string; title: string; device: string; chapter: string }[];
}) {
  const router = useRouter();
  const running = [...p.lines.flatMap((l) => l.reads), ...p.frames, ...p.takes].some((x) => x.status === 'running' || x.status === 'queued');
  const { busy, start } = useRunway(p.shot, running);
  const file = useRef<HTMLInputElement>(null);
  const [up, setUp] = useState(false);
  const onFile = async (f?: File) => {
    if (!f) return;
    setUp(true);
    try {
      const blob = await upload(`studio/uploads/${p.shot}/${f.name.replace(/[^A-Za-z0-9._-]+/g, '-')}`, f, { access: 'private', handleUploadUrl: '/api/studio/upload', contentType: f.type || undefined });
      toast(await studioRegisterUpload('take', p.shot, blob.pathname, ''));
    } catch (e) { err(e instanceof Error ? e.message : 'Upload failed.'); }
    setUp(false);
    router.refresh();
  };
  const refresh = () => router.refresh();
  const readyTakes = p.takes.filter((t) => t.status !== 'failed' || t.error);

  const linesStep = (title: string) => p.lines.length ? (
    <div className="bs-step">
      <span className="bs-h"><b>{title}</b><button className="btn small" type="button" disabled={!p.ready || !!busy} onClick={() => start('lines', { shot: p.shot })}>{busy === 'lines' ? 'Starting…' : `Read lines · ${money(p.cost.line)}`}</button></span>
      {p.lines.map((l) => (
        <div key={l.slot} className="bs-line">
          <span><b>{l.speaker}</b> {l.text}</span>
          <span className="bs-reads">
            {l.reads.map((r, i) => r.status === 'ready' ? (
              <span key={r.id} className={'bs-read' + (r.approved ? ' on' : '')}>
                <audio controls preload="none" src={`/api/studio/media/voice/${r.id}`} />
                {r.approved ? <b>✓ In the edit</b> : <button className="btn small ghost" type="button" onClick={() => act(studioChooseClip, { id: r.id }, refresh)}>Use read {l.reads.length - i}</button>}
              </span>
            ) : <span key={r.id} className="muted bs-status">{r.status === 'failed' ? `Failed: ${r.error ?? ''}` : <><span className="take-spin" /> Reading…</>}</span>)}
          </span>
        </div>
      ))}
    </div>
  ) : null;

  if (p.tool === 'edit') return <p className="bs-note">Code card: made in the render from the board’s text, pixel-exact.</p>;

  if (p.tool === 'capture') {
    return (
      <div className="bs">
        <form className="bs-libpick" action={async (f) => { toast(await studioSetShotScreens(null, f)); router.refresh(); }}>
          <b>📺 Screens from the Screen Library</b>
          <input type="hidden" name="id" value={p.shot} />
          <select className="input" name="screen" defaultValue={p.screens?.[0] ?? ''} aria-label="Screen from the library">
            <option value="">Choose a screen…</option>
            {(p.library ?? []).map((l) => <option key={l.key} value={l.key}>{l.device === 'phone' ? '📱' : '🖥'} {l.title}</option>)}
          </select>
          <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}><button className="btn small primary" type="submit">Use this screen</button><a className="btn small ghost" href="/console/studio/library" target="_blank" rel="noreferrer">Browse the library ↗</a></span>
          <small className="muted">Real screens, captured with fictional data. Or tell Helix: “use the Genovus line on a phone for this shot”.</small>
        </form>
        <details className="pb-more"><summary>Or record it yourself</summary>
        <div className="bs-cap">
          <b>📱 Capture this scene{p.capture?.device === 'phone' ? ' on your phone' : ''}</b>
          {p.capture?.note ? <small>{p.capture.note}</small> : null}
          <ol>
            {(p.capture?.steps ?? []).map((s) => <li key={s.route + s.label}><a href={s.route} target="_blank" rel="noreferrer">{s.label} ↗</a>{s.action ? <span> {s.action}</span> : null}</li>)}
          </ol>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <input ref={file} type="file" accept="video/*,image/png,image/jpeg" hidden onChange={(e) => onFile(e.target.files?.[0])} />
            <button className="btn small primary" type="button" disabled={up} onClick={() => file.current?.click()}>{up ? 'Uploading…' : 'Upload recording or screenshot'}</button>
            <span className="muted" style={{ fontSize: 11.5 }}>Opens your camera roll on a phone. Signed in to Genovus on the phone? Open this board there and upload directly.</span>
          </div>
        </div>
        </details>
        {p.takes.length ? <Takes takes={p.takes} refresh={refresh} /> : null}
        {linesStep('Voice-over · line reads')}
      </div>
    );
  }

  return (
    <div className="bs">
      {linesStep('1 · Line reads')}
      <div className="bs-step">
        <span className="bs-h"><b>{p.lines.length ? '2' : '1'} · Keyframe</b><button className="btn small" type="button" disabled={!p.ready || !!busy} onClick={() => start('keyframes', { shot: p.shot })}>{busy === 'keyframes' ? 'Starting…' : `Draw 2 keyframes · ${money(p.cost.keyframes)}`}</button></span>
        {p.frames.length ? (
          <div className="bs-frames">
            {p.frames.map((f) => f.status === 'ready' ? (
              <button key={f.id} type="button" className={'bs-frame' + (f.chosen ? ' on' : '')} onClick={() => act(studioChooseFrame, { id: f.id }, refresh)} title={f.chosen ? 'The take starts from this frame (click to unpick)' : 'Start the take from this frame'}>
                <img src={`/api/studio/media/frame/${f.id}`} alt="Keyframe candidate" />{f.chosen ? <b>✓ Start frame</b> : null}
              </button>
            ) : <span key={f.id} className="bs-frame wait">{f.status === 'failed' ? <small>Failed: {f.error}</small> : <span className="take-spin" />}</span>)}
          </div>
        ) : <small className="muted">Keyframes are drawn with the cast’s locked identity references, so faces stay on-model.</small>}
      </div>
      <div className="bs-step">
        <span className="bs-h"><b>{p.lines.length ? '3' : '2'} · Take</b><button className="btn small primary" type="button" disabled={!p.ready || !!busy || p.needsFrame} onClick={() => start('take', { shot: p.shot })} title={p.needsFrame ? 'Pick a keyframe first' : undefined}>{busy === 'take' ? 'Starting…' : `Render ${p.takeSecs}s take · ${money(p.cost.take)}`}</button></span>
        <small className="muted">{p.engine}{p.lines.length && p.engine?.startsWith('Seedance') ? ' · performs to the picked reads (audio-guided lip movement)' : ''}{p.needsFrame ? ' · pick a keyframe first' : ''}</small>
        {readyTakes.length ? <Takes takes={readyTakes} refresh={refresh} /> : null}
      </div>
      {!p.ready ? <p className="bs-note">Runway isn’t connected in this environment.</p> : null}
    </div>
  );
}

function Takes({ takes, refresh }: { takes: BoardTake[]; refresh: () => void }) {
  return (
    <div className="bs-takes">
      {takes.map((t, i) => (
        <figure key={t.id} className={'bs-take' + (t.chosen ? ' on' : '')}>
          {t.status === 'ready' ? (t.still ? <img src={`/api/studio/media/take/${t.id}`} alt="Captured screen" /> : <video src={`/api/studio/media/take/${t.id}`} controls playsInline preload="metadata" />)
            : <span className="bs-wait">{t.status === 'failed' ? <small>Failed: {t.error}</small> : <><span className="take-spin" /><small>Rendering…</small></>}</span>}
          <figcaption>
            <span className="muted">Take {takes.length - i}{t.kind === 'upload' ? ' · uploaded' : t.cost_cents ? ` · ${money(t.cost_cents)}` : ''}</span>
            {t.status === 'ready' ? (t.chosen ? <b className="take-chosen">✓ In the edit</b> : <button className="btn small ghost" type="button" onClick={() => act(studioChooseTake, { id: t.id }, refresh)}>Use this take</button>) : null}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

export type CastIdentity = { state: 'locked' | 'casting' | 'pending' | 'none'; label: string; pendingRef?: string };
export type CastVoice = { engine: 'preset' | 'custom'; preset: string; designs: { id: string; status: string; approved: boolean; error: string | null }[] };

export function CastStudio({ character, name, identity, voice, ready, cost }: { character: string; name: string; identity: CastIdentity; voice: CastVoice; ready: boolean; cost: number }) {
  const router = useRouter();
  const { busy, start } = useRunway(undefined, false);
  const refresh = () => router.refresh();
  return (
    <div className="bs-cast" onClick={(e) => e.stopPropagation()}>
      <span className={'bs-lock ' + identity.state}>{identity.state === 'locked' || identity.state === 'casting' ? '🔒' : '○'} {identity.label}</span>
      {identity.state === 'none' ? <button className="btn small" type="button" disabled={!!busy} onClick={() => start('casting', { character })}>{busy === 'casting' ? 'Adding…' : 'Use the official cast sheet'}</button> : null}
      {identity.state === 'pending' && identity.pendingRef ? <button className="btn small primary" type="button" onClick={() => act(studioApproveRef, { id: identity.pendingRef!, reason: `${name}: official V2 cast sheet` }, refresh)}>Approve to lock</button> : null}
      <span className="bs-voice">🎙 {voice.engine === 'custom' ? 'Designed voice' : `${voice.preset} preset · direction tags`}</span>
      <div className="bs-designs">
        {voice.designs.map((d) => d.status === 'ready' ? (
          <span key={d.id} className={'bs-read' + (d.approved && voice.engine === 'custom' ? ' on' : '')}>
            <audio controls preload="none" src={`/api/studio/media/voice/${d.id}`} />
            {d.approved && voice.engine === 'custom' ? <b>✓ Speaking</b> : <button className="btn small ghost" type="button" onClick={() => act(studioSetRunwayVoice, { character, engine: 'custom', voice: d.id, reason: 'Picked on the production board' }, refresh)}>Use</button>}
          </span>
        ) : <small key={d.id} className="muted">{d.status === 'failed' ? `Design failed: ${d.error ?? ''}` : 'Designing…'}</small>)}
      </div>
      <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button className="btn small ghost" type="button" disabled={!ready || !!busy} onClick={() => start('design', { character })}>{busy === 'design' ? 'Designing…' : `Design a voice · ~${money(cost)}`}</button>
        {voice.engine === 'custom' ? <button className="btn small ghost" type="button" onClick={() => act(studioSetRunwayVoice, { character, engine: 'preset', voice: voice.preset, reason: 'Back to the preset for direction tags' }, refresh)}>Use {voice.preset} preset</button> : null}
      </span>
    </div>
  );
}

export type ScoreCue = { id: string; status: string; error: string | null };
export function ScoreStudio({ episode, cue, cues, ready, cost }: { episode: string; cue: string; cues: ScoreCue[]; ready: boolean; cost: number }) {
  const running = cues.some((c) => c.status === 'running' || c.status === 'queued');
  const { busy, start } = useRunway(undefined, running);
  const [text, setText] = useState(cue);
  return (
    <div className="bs">
      <textarea className="input" rows={4} value={text} onChange={(e) => setText(e.target.value)} aria-label="Score cue sheet" />
      <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className="btn small primary" type="button" disabled={!ready || !!busy || text.trim().length < 20} onClick={() => start('score', { episode, cue: text })}>{busy === 'score' ? 'Starting…' : `Compose a score draft · ~${money(cost)}`}</button>
        <small className="muted">Original music from Runway’s Seed Audio. The render mixes it under dialogue.</small>
      </span>
      {cues.length ? <div className="bs-designs">{cues.map((c, i) => c.status === 'ready' ? <span key={c.id} className="bs-read"><audio controls preload="none" src={`/api/studio/media/voice/${c.id}`} /><small className="muted">Draft {cues.length - i}</small></span> : <small key={c.id} className="muted">{c.status === 'failed' ? `Failed: ${c.error ?? ''}` : 'Composing…'}</small>)}</div> : null}
    </div>
  );
}
