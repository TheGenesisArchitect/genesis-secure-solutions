'use client';
// Studio Live (app/console/studio/unedit/[id]/live): the monitor, the episode's real multitrack timeline with a
// playhead that follows the video, an inspector for any piece, the crew with what each agent did, and what needs a
// person. Helix's quick asks map to the card's real actions (take a graphic out, restyle, add graphics again).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export type LiveClip = { track: string; kind: string; label: string; text: string; T: number; D: number; removable: boolean; state?: string; tone?: string; /** the plan's own text, to find it again */ raw?: string };
export type LiveTrack = { name: string; clips: LiveClip[] };
export type LiveCrew = { name: string; state: 'done' | 'work' | 'wait' | 'idle'; doing: string };

const toast = (r: { ok?: string; err?: string }) => window.dispatchEvent(new CustomEvent('genovus:toast', { detail: { ...r, at: Date.now() } }));
const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const PACKAGES = [['signature', 'Genovus Signature'], ['documentary', 'Documentary'], ['keynote', 'Keynote'], ['kinetic', 'Agency kinetic']];

export function StudioLive({ id, title, src, polished, secs, stage, working, review, pkg, tracks, crew, needs }: { id: string; title: string; src: string | null; polished: boolean; secs: number; stage: string; working: boolean; review: boolean; pkg: string | null; tracks: LiveTrack[]; crew: LiveCrew[]; needs: string[] }) {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const [t, setT] = useState(0);
  const [sel, setSel] = useState<LiveClip | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<{ who: string; text: string }[]>([]);

  useEffect(() => {
    if (!working) return;
    const h = setInterval(() => router.refresh(), 6000);
    return () => clearInterval(h);
  }, [working, router]);

  const total = Math.max(1, secs);
  const ruler = useMemo(() => { const step = total > 240 ? 60 : total > 90 ? 30 : 10; return Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step); }, [total]);
  const current = useMemo(() => tracks.flatMap((tr) => tr.clips).filter((c) => c.track !== 'Camera' && c.track !== 'Captions' && c.track !== 'Music' && c.track !== 'Effects' && t >= c.T && t < c.T + c.D), [tracks, t]);

  const send = async (body: Record<string, unknown>, key: string, said: string) => {
    setBusy(key);
    setLog((l) => [...l, { who: 'You', text: said }]);
    try {
      const r = await fetch('/api/studio/unedit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, ...body }) });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; say?: string; error?: string };
      setLog((l) => [...l, { who: 'Helix', text: r.ok && j.ok ? j.say ?? 'Done.' : j.error ?? 'That didn’t work.' }]);
      toast(r.ok && j.ok ? { ok: j.say ?? 'Done.' } : { err: j.error ?? 'That didn’t work.' });
    } finally { setBusy(null); router.refresh(); }
  };
  const seek = (s: number) => { setT(s); if (video.current) video.current.currentTime = s; };

  return (
    <div className="sl">
      <div className="sl-top">
        <span className={`sl-state ${working ? 'work' : review ? 'review' : ''}`}>{working ? '● Working' : review ? 'Ready for review' : stage}</span>
        <span className="muted">{polished ? 'Polished episode' : 'The recording (the polished episode replaces it when it finishes)'} · {mmss(secs)}</span>
      </div>

      <div className="sl-grid">
        <section className="sl-helix" aria-label="Helix the Director">
          <div className="sl-helix-head"><span className="sl-egg" aria-hidden="true" /><div><b>Helix · Director</b><span className="muted">{working ? 'Directing the edit' : needs.length ? `${needs.length} ${needs.length === 1 ? 'thing needs' : 'things need'} you` : 'All clear'}</span></div></div>
          <div className="sl-log">
            <p className="sl-msg">This is {title}. {polished ? 'The polished episode is on the monitor.' : 'I’ll put the polished episode on the monitor when it finishes.'} Click any piece on the timeline to see it; I can take it out, restyle the whole episode, or add the graphics again.</p>
            {log.map((m, i) => <p key={i} className={`sl-msg${m.who === 'You' ? ' you' : ''}`}><b>{m.who}</b> {m.text}</p>)}
          </div>
          <div className="sl-asks">
            <span className="nr-label">Ask Helix</span>
            {PACKAGES.filter(([p]) => p !== pkg).map(([p, l]) => <button type="button" key={p} className="btn small" disabled={!review || busy !== null} onClick={() => send({ tool: 'set_package', pkg: p }, p, `Restyle the episode as ${l}.`)}>Restyle as {l}</button>)}
            <button type="button" className="btn small" disabled={!review || busy !== null} onClick={() => send({ tool: 'retry_episode' }, 'retry', 'Add the graphics again.')}>Add the graphics again</button>
            {!review ? <span className="muted nr-small">Helix can change the episode once it’s ready for review.</span> : null}
          </div>
        </section>

        <main className="sl-main">
          <div className="sl-monitor">
            {src ? <video ref={video} src={src} controls playsInline preload="metadata" onTimeUpdate={(e) => setT(e.currentTarget.currentTime)} /> : <div className="ue-blank" />}
          </div>
          <div className="sl-now">{current.length ? current.map((c, i) => <span key={i} className="sl-chip">{c.label}{c.text && c.kind !== 'broll' ? `: ${c.text.slice(0, 40)}` : ''}</span>) : <span className="muted nr-small">{mmss(t)} · on camera</span>}</div>
          <div className="sl-timeline" aria-label="Timeline">
            <div className="sl-inner">
              <div className="sl-ruler">{ruler.map((r) => <span key={r} style={{ left: `${(r / total) * 100}%` }}>{mmss(r)}</span>)}</div>
              {tracks.map((tr) => (
                <div key={tr.name} className="sl-row">
                  <span className="sl-name">{tr.name}</span>
                  <div className="sl-lane">
                    {tr.clips.map((c, i) => (
                      <button type="button" key={i} title={`${c.label}: ${c.text}`} className={`sl-clip t-${tr.name.toLowerCase().replace(/[^a-z]/g, '')}${c.tone ? ` tone-${c.tone}` : ''}${sel === c ? ' on' : ''}`} style={{ left: `${(c.T / total) * 100}%`, width: `max(4px, ${(c.D / total) * 100}%)` }} onClick={() => { setSel(c); seek(c.T + 0.05); }}>{c.label}</button>
                    ))}
                  </div>
                </div>
              ))}
              <div className="sl-head" style={{ left: `calc(96px + (100% - 96px) * ${Math.min(1, t / total)})` }} aria-hidden="true" />
            </div>
          </div>
        </main>

        <aside className="sl-side">
          <section className="sl-card">
            <span className="nr-label">Selected{sel ? ` · ${sel.track}` : ''}</span>
            {sel ? (<>
              <b className="sl-sel-title">{sel.label}</b>
              <span className="sl-sel-text">{sel.text}</span>
              <span className="muted nr-small">{mmss(sel.T)}–{mmss(sel.T + sel.D)}{sel.state ? ` · ${sel.state}` : ''}</span>
              {sel.removable ? <button type="button" className="btn" disabled={!review || busy !== null} onClick={() => send({ tool: 'drop_graphic', kind: sel.kind, text: sel.raw ?? sel.text, T: sel.T }, 'drop', `Take out the ${sel.label.toLowerCase()} at ${mmss(sel.T)}.`)}>Take it out</button> : null}
            </>) : <span className="muted">Click any piece on the timeline.</span>}
          </section>
          <section className="sl-card">
            <span className="nr-label">The crew · {crew.length} agents</span>
            {crew.map((c) => <div key={c.name} className="sl-crew"><span className={`sl-dot ${c.state}`} aria-hidden="true" /><span><b>{c.name}</b><br /><span className="muted">{c.doing}</span></span></div>)}
          </section>
          <section className="sl-card needs">
            <span className="nr-label hot">Needs you · {needs.length}</span>
            {needs.length ? needs.map((n, i) => <span key={i} className="sl-need">{n}</span>) : <span className="nr-ok">All clear.</span>}
            <a className="btn primary" href={`/console/studio/unedit/${id}`}>Review and approve</a>
          </section>
        </aside>
      </div>
    </div>
  );
}
