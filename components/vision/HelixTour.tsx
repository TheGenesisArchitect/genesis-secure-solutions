'use client';
// Helix Live, the guided tour of the vision. Mounted in the /vision layout so the voice session survives page
// changes. The browser gets a single-use token from /api/helix/session (Helix's instructions and tools locked
// server-side), streams the mic to the Gemini Live API, plays Helix's voice, and runs Helix's tools: move between
// chapters, spotlight elements, run the demo actions, and take notes that the team can hand to a background agent.
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

type Note = { id: string; kind: string; text: string; chapter: string | null; status: string; work?: { title?: string; summary?: string; steps?: string[]; acceptance?: string[]; effort?: string; area?: string; error?: string } | null };
type Phase = 'idle' | 'connecting' | 'live' | 'ended' | 'error';
type Line = { who: 'helix' | 'you'; text: string };

const PATH: Record<string, string> = { map: '/vision', helix: '/vision/briefing' };
const toPath = (slug: string) => PATH[slug] ?? `/vision/${slug}`;
const toSlug = (path: string) => (path === '/vision' ? 'map' : path === '/vision/briefing' ? 'helix' : path.replace('/vision/', '').split('/')[0]);
const KIND_LABEL: Record<string, string> = { idea: 'Idea', action_item: 'Action item', question: 'Question', risk: 'Risk' };
const BARGE_IN = 0.08;
const b64 = (buf: ArrayBuffer) => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };

/** `context`: the vision tour (default) or Ask Helix on the Character Bible. `floating`: show the launch pill (otherwise open it with the genovus:helix-open event). */
export function HelixTour({ context = 'tour', floating = true }: { context?: 'tour' | 'bible'; floating?: boolean } = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  useEffect(() => { pathRef.current = pathname; }, [pathname]);

  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [err, setErr] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [level, setLevel] = useState(0);
  const [caption, setCaption] = useState('');
  const [heard, setHeard] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [tab, setTab] = useState<'live' | 'notes'>('live');
  const [notes, setNotes] = useState<Note[]>([]);
  const [staff, setStaff] = useState(false);
  const [left, setLeft] = useState(0);
  const [spot, setSpot] = useState<{ target: string; caption?: string } | null>(null);
  const [typed, setTyped] = useState('');
  const [voice, setVoice] = useState('');
  const [cta, setCta] = useState(false);
  // Minimized: just the orb, controls and a one-line caption, so the presentation stays visible. Phones start
  // minimized; the choice is remembered on this device.
  const [mini, setMini] = useState(false);
  const setMiniPref = (v: boolean) => { setMini(v); try { localStorage.setItem('helix-mini', v ? '1' : '0'); } catch {} };
  useEffect(() => {
    if (!open) return;
    let saved: string | null = null;
    try { saved = localStorage.getItem('helix-mini'); } catch {}
    setMini(saved != null ? saved === '1' : window.matchMedia('(max-width: 600px)').matches);
  }, [open]);

  const ws = useRef<WebSocket | null>(null);
  const session = useRef<{ id: string; started: number; max: number } | null>(null);
  const micCtx = useRef<AudioContext | null>(null);
  const micStream = useRef<MediaStream | null>(null);
  const outCtx = useRef<AudioContext | null>(null);
  const playAt = useRef(0);
  const sources = useRef<AudioBufferSourceNode[]>([]);
  const micOnRef = useRef(true);
  const turnText = useRef('');
  const heardText = useRef('');
  const wrapSent = useRef(false);
  const speakingRef = useRef(false);
  const loud = useRef(0);
  const tokens = useRef(0);
  useEffect(() => { speakingRef.current = speaking; }, [speaking]);

  const send = (msg: unknown) => { if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(msg)); };

  // ---------- audio out ----------
  const play = (data: string, mime: string) => {
    const ctx = outCtx.current; if (!ctx) return;
    const rate = Number(/rate=(\d+)/.exec(mime)?.[1] ?? 24000);
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const pcm = new Int16Array(bytes.buffer, 0, bytes.byteLength >> 1);
    const buf = ctx.createBuffer(1, pcm.length, rate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;
    const src = ctx.createBufferSource();
    src.buffer = buf; src.connect(ctx.destination);
    const at = Math.max(ctx.currentTime + 0.03, playAt.current);
    src.start(at); playAt.current = at + buf.duration;
    sources.current.push(src);
    setSpeaking(true);
    src.onended = () => { sources.current = sources.current.filter((s) => s !== src); if (!sources.current.length) setSpeaking(false); };
  };
  const stopPlayback = () => { sources.current.forEach((s) => { try { s.stop(); } catch {} }); sources.current = []; playAt.current = 0; setSpeaking(false); };

  // ---------- tools ----------
  const waitFor = (test: () => boolean, ms = 4000) => new Promise<boolean>((res) => { const t0 = Date.now(); const tick = () => { if (test()) res(true); else if (Date.now() - t0 > ms) res(false); else setTimeout(tick, 120); }; tick(); });
  const targetsHere = () => [...new Set([...document.querySelectorAll<HTMLElement>('[data-tour]')].map((e) => e.dataset.tour!))];
  const saveNote = useCallback(async (kind: string, text: string, chapter: string | null, source: 'helix' | 'person') => {
    if (!session.current) return { ok: false };
    const r = await fetch('/api/helix/notes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: session.current.id, kind, text, chapter, source }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.note) { setNotes((n) => [...n, j.note]); return { ok: true }; }
    return { ok: false, error: j.error ?? 'not saved' };
  }, []);

  const runTool = async (name: string, args: Record<string, string>): Promise<Record<string, unknown>> => {
    if (name === 'go_to_chapter') {
      const path = toPath(args.chapter);
      if (pathRef.current !== path) router.push(path);
      setSpot(null);
      await waitFor(() => pathRef.current === path && document.querySelectorAll('[data-tour]').length > 0);
      await new Promise((r) => setTimeout(r, 120));
      return { ok: true, chapter: args.chapter, title: document.querySelector('.topbar h1')?.textContent ?? '', targets: targetsHere() };
    }
    if (name === 'highlight') {
      const el = document.querySelector(`[data-tour="${CSS.escape(args.target)}"]`);
      if (!el) return { ok: false, error: 'not on this chapter', targets: targetsHere() };
      setSpot({ target: args.target, caption: args.caption });
      return { ok: true };
    }
    if (name === 'demo_action') {
      const el = document.querySelector<HTMLElement>(`[data-tour-action="${CSS.escape(args.action)}"]`);
      if (!el) return { ok: false, error: 'that demo is not available on this chapter right now' };
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return { ok: true };
    }
    if (name === 'take_note') {
      const r = await saveNote(args.kind ?? 'idea', args.text ?? '', args.chapter ?? toSlug(pathRef.current), 'helix');
      if (r.ok) setTab((t) => t);
      return r;
    }
    if (name === 'talk_to_team') { setCta(true); return { ok: true, shown: 'A “Talk to the team” button is now on screen.' }; }
    if (name === 'end_tour') { setTimeout(() => end('Tour complete.'), 2500); return { ok: true }; }
    return { ok: false, error: 'unknown tool' };
  };

  // ---------- messages ----------
  const onMessage = async (ev: MessageEvent) => {
    const raw = typeof ev.data === 'string' ? ev.data : await (ev.data as Blob).text();
    let m: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    try { m = JSON.parse(raw); } catch { return; }
    if (m.setupComplete) {
      setPhase('live');
      send({ realtimeInput: { text: context === 'bible' ? 'The Studio team just opened Ask Helix on the Character Bible. Greet them and ask what they want to work on.' : `The tour is starting now. The listener is on the chapter "${toSlug(pathRef.current)}". Begin.` } });
      return;
    }
    const sc = m.serverContent;
    if (sc) {
      if (sc.interrupted) { stopPlayback(); }
      for (const p of sc.modelTurn?.parts ?? []) if (p.inlineData?.data) play(p.inlineData.data, p.inlineData.mimeType ?? 'audio/pcm;rate=24000');
      if (sc.outputTranscription?.text) { turnText.current += sc.outputTranscription.text; setCaption(turnText.current); }
      if (sc.inputTranscription?.text) { heardText.current += sc.inputTranscription.text; setHeard(heardText.current); }
      if (sc.turnComplete) {
        const said = turnText.current.trim(), you = heardText.current.trim();
        setLines((l) => [...l, ...(you ? [{ who: 'you' as const, text: you }] : []), ...(said ? [{ who: 'helix' as const, text: said }] : [])].slice(-40));
        turnText.current = ''; heardText.current = ''; setHeard('');
      }
    }
    if (m.toolCall?.functionCalls?.length) {
      const responses = [];
      for (const fc of m.toolCall.functionCalls) responses.push({ id: fc.id, name: fc.name, response: { result: await runTool(fc.name, fc.args ?? {}) } });
      send({ toolResponse: { functionResponses: responses } });
    }
    if (m.usageMetadata?.totalTokenCount) tokens.current += Number(m.usageMetadata.totalTokenCount) || 0;
    if (m.goAway) setErr('The session is ending soon.');
  };

  // ---------- lifecycle ----------
  const start = async () => {
    setOpen(true); setErr(''); setPhase('connecting'); setLines([]); setCaption(''); setNotes([]); wrapSent.current = false;
    try {
      // Both audio contexts are created inside the click, so the browser lets them play and record.
      outCtx.current = new AudioContext();
      micCtx.current = new AudioContext();
      void outCtx.current.resume(); void micCtx.current.resume();
      // Microphone first (optional: the tour still works with typed questions), so a slow permission prompt
      // doesn't use up the session token's start window.
      try {
        micStream.current = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        await micCtx.current!.audioWorklet.addModule('/helix-mic-worklet.js');
        const node = new AudioWorkletNode(micCtx.current!, 'helix-mic');
        micCtx.current!.createMediaStreamSource(micStream.current).connect(node);
        node.port.onmessage = (e) => {
          setLevel(e.data.level);
          if (!micOnRef.current) return;
          // The mic always streams (the browser's echo cancellation removes Helix's own voice), so the Live API
          // hears an interruption from its first syllable. Locally, sustained speech while Helix talks (~120 ms)
          // silences the queued audio at once instead of waiting for the server to notice.
          if (speakingRef.current && e.data.level >= BARGE_IN) {
            if (++loud.current >= 3) { loud.current = 0; stopPlayback(); }
          } else loud.current = 0;
          send({ realtimeInput: { audio: { data: b64(e.data.pcm), mimeType: 'audio/pcm;rate=16000' } } });
        };
        setMicOn(true); micOnRef.current = true;
      } catch {
        setMicOn(false); micOnRef.current = false;
        setErr('Microphone is off: type your questions below.');
      }
      const r = await fetch('/api/helix/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ voice: new URLSearchParams(location.search).get('voice') ?? undefined, context }) });
      const s = await r.json();
      if (!r.ok) throw new Error(s.error ?? 'Helix could not start.');
      session.current = { id: s.sessionId, started: Date.now(), max: s.maxSeconds };
      tokens.current = 0;
      setStaff(Boolean(s.staff));
      setVoice(s.voice ?? '');
      const sock = new WebSocket(`${s.wsUrl}?access_token=${encodeURIComponent(s.token)}`);
      ws.current = sock;
      sock.onopen = () => send({ setup: s.setup });
      sock.onmessage = onMessage;
      sock.onerror = () => setErr('The voice connection had a problem.');
      sock.onclose = (e) => { if (session.current) end(e.code === 1000 ? 'Tour ended.' : `Voice connection closed${e.reason ? `: ${e.reason}` : ''}.`); };
    } catch (e) {
      setPhase('error'); setErr(e instanceof Error ? e.message : 'Helix could not start.');
      cleanup();
    }
  };
  const cleanup = () => {
    try { ws.current?.close(); } catch {}
    ws.current = null;
    micStream.current?.getTracks().forEach((t) => t.stop()); micStream.current = null;
    micCtx.current?.close().catch(() => {}); micCtx.current = null;
    stopPlayback();
    outCtx.current?.close().catch(() => {}); outCtx.current = null;
  };
  const end = (why?: string) => {
    const s = session.current;
    session.current = null;
    cleanup(); setSpot(null);
    setPhase('ended'); if (why) setErr(why);
    if (s) fetch('/api/helix/session', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: s.id, seconds: (Date.now() - s.started) / 1000, tokens: tokens.current }) }).catch(() => {});
    if (s) setTimeout(() => refreshNotes(s.id), 500);
  };
  useEffect(() => () => { if (session.current) end(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Session clock and a polite wrap-up before the cap.
  useEffect(() => {
    if (phase !== 'live') return;
    const t = setInterval(() => {
      const s = session.current; if (!s) return;
      const remaining = Math.max(0, s.max - Math.round((Date.now() - s.started) / 1000));
      setLeft(remaining);
      if (remaining <= 30 && !wrapSent.current) { wrapSent.current = true; send({ realtimeInput: { text: 'We have 30 seconds left in this session. Wrap up warmly in one or two sentences.' } }); }
      if (remaining <= 0) end('Session time is up. Thanks for taking the tour.');
    }, 1000);
    return () => clearInterval(t);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // Notes: poll while any note is with the agent.
  const sid = useRef<string | null>(null);
  useEffect(() => { if (session.current) sid.current = session.current.id; });
  const refreshNotes = async (id = session.current?.id ?? sid.current) => {
    if (!id) return;
    const r = await fetch(`/api/helix/notes?session=${id}`); const j = await r.json().catch(() => ({ notes: [] }));
    if (Array.isArray(j.notes)) setNotes(j.notes);
  };
  useEffect(() => {
    if (!notes.some((n) => n.status === 'drafting' || n.status === 'handed_off')) return;
    const t = setInterval(() => refreshNotes(), 2500);
    return () => clearInterval(t);
  }, [notes]); // eslint-disable-line react-hooks/exhaustive-deps
  const handoff = async (id: string) => {
    setNotes((n) => n.map((x) => (x.id === id ? { ...x, status: 'drafting' } : x)));
    const r = await fetch('/api/helix/handoff', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ noteId: id }) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j.error ?? 'Hand-off failed.'); refreshNotes(); }
  };

  const toggleMic = () => { const v = !micOn; setMicOn(v); micOnRef.current = v; };
  const sendTyped = (e: React.FormEvent) => {
    e.preventDefault();
    const t = typed.trim(); if (!t) return;
    if (phase === 'live') { stopPlayback(); send({ realtimeInput: { text: t } }); setLines((l) => [...l, { who: 'you', text: t }]); }
    else if (session.current || sid.current) saveNote('idea', t, toSlug(pathname), 'person');
    setTyped('');
  };

  // Spotlight follows its element (scroll, resize, page changes).
  const [box, setBox] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!spot) { setBox(null); return; }
    const el = document.querySelector(`[data-tour="${CSS.escape(spot.target)}"]`);
    if (!el) { setBox(null); return; }
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    let raf = 0; const loop = () => { setBox(el.getBoundingClientRect()); raf = requestAnimationFrame(loop); }; loop();
    const t = setTimeout(() => setSpot(null), 12000);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
  }, [spot, pathname]);

  const live = phase === 'live' || phase === 'connecting';
  const mm = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;

  // Open from anywhere on the page (e.g. the Ask Helix egg on the Character Bible).
  useEffect(() => {
    const open = () => { if (!session.current && phase !== 'connecting') start(); else setOpen(true); };
    window.addEventListener('genovus:helix-open', open);
    return () => window.removeEventListener('genovus:helix-open', open);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {box ? (
        <div className="hx-spot" style={{ top: box.top - 8, left: box.left - 8, width: box.width + 16, height: box.height + 16 }} aria-hidden="true">
          {spot?.caption ? <span className="hx-spot-cap">{spot.caption}</span> : null}
        </div>
      ) : null}
      {!open && !floating ? null : !open ? (
        <button className="hx-launch" onClick={start} data-tour-launch>
          <span className="hx-orb on" aria-hidden="true"><i /><i /><i /></span>
          <span><b>Take the tour with Helix</b><small>Talk to it, interrupt it, ask anything</small></span>
        </button>
      ) : (
        <aside className={'hx-dock' + (mini ? ' mini' : box ? ' spotting' : '')} aria-label="Helix Live tour">
          <header className="hx-dock-head">
            <span className={'hx-orb' + (speaking ? ' on' : '')} aria-hidden="true"><i /><i /><i /></span>
            <span style={{ minWidth: 0, flex: 1, cursor: mini ? 'pointer' : undefined }} onClick={mini ? () => setMiniPref(false) : undefined}>
              <b>Helix Live{voice ? <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}> · {voice}</span> : null}</b>
              <small>{phase === 'connecting' ? 'Connecting…' : phase === 'live' ? (speaking ? 'Speaking · interrupt any time' : micOn ? 'Listening' : 'Mic off · type below') : phase === 'ended' ? 'Tour ended' : 'Not connected'}</small>
            </span>
            {phase === 'live' ? <span className="hx-timer" title="Session time left">{mm}</span> : null}
            {phase === 'live' ? <button className={'hx-ic' + (micOn ? '' : ' off')} onClick={toggleMic} aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'} title={micOn ? 'Mute' : 'Unmute'}><span className="hx-level" style={{ transform: `scaleY(${micOn ? Math.min(1, 0.15 + level * 3) : 0.1})` }} />{micOn ? 'Mic' : 'Muted'}</button> : null}
            {live ? <button className="hx-ic" onClick={() => end('Tour ended.')}>End</button> : <button className="hx-ic" onClick={() => { setOpen(false); setPhase('idle'); setErr(''); }}>Close</button>}
            <button className="hx-ic hx-min" onClick={() => setMiniPref(!mini)} aria-label={mini ? 'Expand Helix' : 'Minimize Helix'} title={mini ? 'Expand' : 'Minimize'} aria-expanded={!mini}>{mini ? '▴' : '▾'}</button>
          </header>
          {cta || phase === 'ended' ? (
            <a className="hx-cta" href="/for/captive-agents?from=helix#consult">
              <b>Talk to the team</b><span>Book a 15-minute consult →</span>
            </a>
          ) : null}
          {mini && (caption || lines.length) ? <p className="hx-sub" aria-live="polite">{caption || [...lines].reverse().find((l) => l.who === 'helix')?.text || ''}</p> : null}
          <nav className="hx-tabs">
            <button aria-pressed={tab === 'live'} onClick={() => setTab('live')}>Conversation</button>
            <button aria-pressed={tab === 'notes'} onClick={() => setTab('notes')}>Notes{notes.length ? ` · ${notes.length}` : ''}</button>
          </nav>
          {tab === 'live' ? (
            <div className="hx-convo">
              {lines.slice(-6).map((l, i) => <p key={i} className={'hx-line ' + l.who}><span>{l.who === 'helix' ? 'Helix' : 'You'}</span>{l.text}</p>)}
              {caption ? <p className="hx-line helix now"><span>Helix</span>{caption}</p> : null}
              {heard ? <p className="hx-line you now"><span>You</span>{heard}</p> : null}
              {phase === 'connecting' ? <p className="muted" style={{ fontSize: 13 }}>Starting a voice session… allow the microphone when your browser asks.</p> : null}
              {phase === 'ended' && !lines.length ? <p className="muted" style={{ fontSize: 13 }}>Start again any time.</p> : null}
            </div>
          ) : (
            <div className="hx-notes">
              {notes.length ? notes.map((n) => (
                <div key={n.id} className="hx-note">
                  <div className="spread"><span className={'hx-kind ' + n.kind}>{KIND_LABEL[n.kind] ?? n.kind}</span><span className="muted" style={{ fontSize: 11 }}>{n.chapter ?? ''}</span></div>
                  <p>{n.text}</p>
                  {n.status === 'drafting' || n.status === 'handed_off' ? <span className="hx-agent">Agent is drafting a plan…</span> : null}
                  {n.status === 'drafted' && n.work ? (
                    <details className="hx-draft" open>
                      <summary>{n.work.title} · {n.work.area} · effort {n.work.effort}</summary>
                      <p>{n.work.summary}</p>
                      <ol>{(n.work.steps ?? []).map((s) => <li key={s}>{s}</li>)}</ol>
                    </details>
                  ) : null}
                  {n.status === 'failed' ? <span className="hx-agent bad">The agent couldn’t draft this one.</span> : null}
                  {staff && (n.status === 'new' || n.status === 'failed') ? <button className="btn small" onClick={() => handoff(n.id)}>{n.status === 'failed' ? 'Try the agent again' : 'Hand off to an agent'}</button> : null}
                </div>
              )) : <p className="muted" style={{ fontSize: 13 }}>Ideas, action items, questions and risks Helix notes during the tour land here{staff ? '. Hand any of them to an agent and it drafts a plan while you keep going.' : ' and go to the Genovus team.'}</p>}
            </div>
          )}
          {err ? <p className="hx-err">{err}</p> : null}
          <form className="hx-input" onSubmit={sendTyped}>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={phase === 'live' ? 'Type to Helix…' : 'Add a note…'} aria-label={phase === 'live' ? 'Message Helix' : 'Add a note'} maxLength={500} />
            {phase === 'live' || phase === 'connecting' ? <button className="btn small primary" type="submit">Send</button> : <button className="btn small primary" type="button" onClick={start}>{phase === 'ended' ? 'Tour again' : 'Start'}</button>}
          </form>
        </aside>
      )}
    </>
  );
}
