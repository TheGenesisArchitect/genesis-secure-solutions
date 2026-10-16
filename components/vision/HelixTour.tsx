'use client';
// Helix Live, the guided tour of the vision. Mounted in the /vision layout so the voice session survives page
// changes. The browser gets a single-use token from /api/helix/session (Helix's instructions and tools locked
// server-side), streams the mic to the Gemini Live API, plays Helix's voice, and runs Helix's tools: move between
// chapters, spotlight elements, run the demo actions, and take notes that the team can hand to a background agent.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import { useHelixThread } from '../HelixHost';
import { goViaMenu } from '@/lib/helix-menu';

type Note = { id: string; kind: string; text: string; chapter: string | null; status: string; work?: { title?: string; summary?: string; steps?: string[]; acceptance?: string[]; effort?: string; area?: string; error?: string } | null };
type Phase = 'idle' | 'connecting' | 'live' | 'ended' | 'error';
type Line = { who: 'helix' | 'you'; text: string };

const PATH: Record<string, string> = { map: '/vision', helix: '/vision/briefing' };
const toPath = (slug: string) => PATH[slug] ?? `/vision/${slug}`;
const toSlug = (path: string) => (path === '/vision' ? 'map' : path === '/vision/briefing' ? 'helix' : path.replace('/vision/', '').split('/')[0]);
const KIND_LABEL: Record<string, string> = { idea: 'Idea', action_item: 'Action item', question: 'Question', risk: 'Risk' };
const BARGE_IN = 0.08;
const b64 = (buf: ArrayBuffer) => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };

/** `context`: the vision tour (default), the Studio, or Ask Helix on the Enterprise console or an agency dashboard
 *  (`slug`). `floating`: show the tour's launch pill (otherwise open it with `openEvent`). `embedded`: the voice bar
 *  inside Ask Helix (one Ask Helix: voice and typing in the same panel); `autoStart` begins listening when it opens
 *  unless the person turned voice off on this device. */
export function HelixTour({ context = 'tour', floating = true, focus, slug, openEvent = 'genovus:helix-open', where, page, embedded, autoStart }: { context?: 'tour' | 'bible' | 'studio' | 'enterprise' | 'agency' | 'packages'; floating?: boolean; focus?: { kind: string; code?: string; label?: string }; slug?: string; openEvent?: string; where?: string; page?: string; embedded?: boolean; autoStart?: boolean } = {}) {
  const ask = context === 'enterprise' || context === 'agency';
  // Ask Helix: what the person says by voice joins their typed thread, and Helix can move around their pages.
  const thread = useHelixThread();
  const pageRef = useRef(page);
  useEffect(() => { pageRef.current = page; }, [page]);
  const pages = useRef<{ label: string; href: string }[]>([]);
  const convo = context !== 'tour'; // Studio and Ask Helix: a conversation, not the guided tour
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const router = useRouter();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  useEffect(() => { pathRef.current = pathname; }, [pathname]);

  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [err, setErr] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const [hush, setHush] = useState(false);
  const [micOn, setMicOn] = useState(true);
  // Ask Helix on this device: push-to-talk (hold Space, or hold the button) and hands-free (keeps going past the
  // session cap while the person is talking). Both are per-device choices; neither listens when nothing is open.
  const pref = (k: string, v?: boolean) => { try { if (v !== undefined) localStorage.setItem(k, v ? '1' : '0'); return localStorage.getItem(k) === '1'; } catch { return false; } };
  const [ptt, setPtt] = useState(false);
  const [hands, setHands] = useState(false);
  useEffect(() => { setPtt(pref('helix-ptt')); setHands(pref('helix-hands')); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const pttRef = useRef(false);
  const handsRef = useRef(false);
  useEffect(() => { handsRef.current = hands; }, [hands]);
  useEffect(() => { pttRef.current = ptt; }, [ptt]);
  const heldRef = useRef(false);
  const lastSpoke = useRef(0);
  const [level, setLevel] = useState(0);
  const [caption, setCaption] = useState('');
  const [heard, setHeard] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [tab, setTab] = useState<'live' | 'notes'>('live');
  const [notes, setNotes] = useState<Note[]>([]);
  const [staff, setStaff] = useState(false);
  const [left, setLeft] = useState(0);
  const [spot, setSpot] = useState<{ target?: string; el?: Element; caption?: string } | null>(null);
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
  const diag = useRef({ msgs: 0, audio: 0, live: false, code: 0, reason: '', error: '', mic: false });
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
  // Hushed while the Studio's Finish dialogue recorder is open: Helix neither hears the person reading their line
  // nor talks over the take. The session stays connected and picks up again when the recorder closes.
  const hushRef = useRef(false);
  const loud = useRef(0);
  const tokens = useRef(0);
  useEffect(() => { speakingRef.current = speaking; }, [speaking]);
  // Ask Helix: when the person moves to another page themselves, tell voice Helix quietly (no reply), so "this page"
  // means the page they're on. Skipped when Helix did the moving (its tool result says so); held while it's speaking.
  const selfNav = useRef(false);
  const pendingPage = useRef<string | null>(null);
  const lastToldPage = useRef<string | undefined>(page);
  useEffect(() => {
    if (!ask || !page || page === lastToldPage.current) return;
    if (selfNav.current) { selfNav.current = false; lastToldPage.current = page; return; }
    pendingPage.current = page;
  }, [ask, page]);
  useEffect(() => {
    const p = pendingPage.current;
    if (!p || speaking || ws.current?.readyState !== WebSocket.OPEN) return;
    pendingPage.current = null; lastToldPage.current = p;
    ws.current.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text: `(Context, not a request: the person just opened the ${p} page themselves.)` }] }], turnComplete: false } }));
  }); // eslint-disable-line react-hooks/exhaustive-deps
  // A tap on the confirmation card or Undo while voice is live: tell Helix, so it says what happened.
  useEffect(() => {
    const onSaid = (e: Event) => { const t = String((e as CustomEvent).detail?.text ?? ''); if (t && ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify({ realtimeInput: { text: t } })); };
    window.addEventListener('genovus:helix-said', onSaid);
    return () => window.removeEventListener('genovus:helix-said', onSaid);
  }, []);
  useEffect(() => {
    const onHush = (e: Event) => { const on = Boolean((e as CustomEvent).detail?.on); hushRef.current = on; setHush(on); if (on) stopPlayback(); };
    window.addEventListener('genovus:helix-hush', onHush);
    return () => window.removeEventListener('genovus:helix-hush', onHush);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const send = (msg: unknown) => { if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(msg)); };

  // ---------- audio out ----------
  const play = (data: string, mime: string) => {
    const ctx = outCtx.current; if (!ctx || hushRef.current) return;
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

  // Point at something for the person: minimize Ask Helix so the page is visible (it keeps listening), then spotlight.
  const point = (el: Element, caption?: string) => {
    window.dispatchEvent(new CustomEvent('genovus:helix-dock', { detail: { state: 'min' } }));
    setSpot({ el, caption });
  };
  const runTool = async (name: string, args: Record<string, string>): Promise<Record<string, unknown>> => {
    if (name === 'go_to_chapter') {
      const path = toPath(args.chapter);
      if (pathRef.current !== path) router.push(path);
      setSpot(null);
      await waitFor(() => pathRef.current === path && document.querySelectorAll('[data-tour]').length > 0);
      await new Promise((r) => setTimeout(r, 120));
      return { ok: true, chapter: args.chapter, title: document.querySelector('.topbar h1')?.textContent ?? '', targets: targetsHere() };
    }
    if (!ask && name === 'highlight') { // the vision tour's chapters (Ask Helix points with its own highlight below)
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
    // Ask Helix moving around the screen (the "auto" lane: opening and pointing, never changing anything).
    if (ask && name === 'go_to') {
      const p = pages.current.find((x) => x.label.toLowerCase() === String(args.page ?? '').toLowerCase());
      if (!p) return { ok: false, error: 'not one of this person’s pages', pages: pages.current.map((x) => x.label) };
      setSpot(null);
      if (pathRef.current !== p.href) { selfNav.current = true; await goViaMenu(p.href, () => router.push(p.href), p.label); }
      const landed = await waitFor(() => pathRef.current === p.href, 8000);
      return landed ? { ok: true, page: p.label } : { ok: false, error: 'the page is still loading' };
    }
    if (ask && name === 'open_lead') {
      const want = String(args.name ?? '').trim().toLowerCase();
      if (want.length < 2) return { ok: false, error: 'say the lead’s name' };
      const matches = () => [...document.querySelectorAll<HTMLElement>('[data-helix-item]')].filter((e) => e.dataset.helixItem!.toLowerCase().includes(want));
      if (!matches().length) {
        const leads = pages.current.find((x) => /\/leads$/.test(x.href));
        if (leads && pathRef.current !== leads.href) { selfNav.current = true; await goViaMenu(leads.href, () => router.push(leads.href), leads.label); await waitFor(() => pathRef.current === leads.href && matches().length > 0, 8000); }
      }
      const found = matches();
      if (!found.length) return { ok: false, error: `no lead named ${args.name} on ${pageRef.current ?? 'this page'}` };
      point(found[0], found[0].dataset.helixItem);
      return { ok: true, matches: found.length, names: [...new Set(found.map((e) => e.dataset.helixItem))].slice(0, 5), page: pageRef.current };
    }
    if (ask && name === 'highlight') {
      const want = String(args.text ?? '').trim().toLowerCase();
      if (want.length < 2) return { ok: false, error: 'say what to point at' };
      const items = [...document.querySelectorAll<HTMLElement>('[data-helix-item]')].filter((e) => e.dataset.helixItem!.toLowerCase().includes(want));
      const labels = [...document.querySelectorAll<HTMLElement>('main h1, main h2, main h3, main header b, main th, main button, main a, main label, main b')].filter((e) => !e.closest('.helix-drawer') && (e.textContent ?? '').trim().toLowerCase().includes(want));
      const el = items[0] ?? labels[0];
      if (!el) return { ok: false, error: `nothing called “${args.text}” on ${pageRef.current ?? 'this page'}` };
      point(el.closest('.lead, .board-card, li, section, tr') ?? el);
      return { ok: true, page: pageRef.current };
    }
    // The confirm lane (agency): a card on screen waits for the person's yes; Helix confirms only after hearing it.
    if (ask && thread.act && name === 'propose_action') {
      const p = await thread.act.propose(String(args.action ?? ''), args);
      window.dispatchEvent(new CustomEvent('genovus:helix-dock', { detail: { state: 'open' } }));
      return p.ok ? { ok: true, summary: p.summary, next: 'Read the summary out and ask “Shall I?”. Call confirm_action only after a clear yes.' } : { ok: false, error: p.error, choices: p.choices };
    }
    if (ask && thread.act && name === 'confirm_action') return thread.act.confirm(pageRef.current);
    if (ask && thread.act && name === 'undo_last') return thread.act.undo(pageRef.current);
    if (name === 'take_note') {
      const r = await saveNote(args.kind ?? 'idea', args.text ?? '', args.chapter ?? toSlug(pathRef.current), 'helix');
      if (r.ok) setTab((t) => t);
      return r;
    }
    // Production board tools (Studio, on an episode): the server does the work with this person's session.
    if (['production_status', 'direct_shot', 'plan_production', 'approve_production', 'review_shot', 'lock_cast', 'pause_production', 'retry_blocked', 'retry_shot', 'cancel_shot', 'raise_ceiling', 'attach_screen', 'finish_dialogue', 'verify_sync', 'use_gen45', 'finish_episode', 'publish_episode'].includes(name)) {
      const tool = ({ production_status: 'status', plan_production: 'plan', approve_production: 'approve', review_shot: 'review', pause_production: 'pause', retry_blocked: 'retry', finish_episode: 'finish', publish_episode: 'publish' } as Record<string, string>)[name] ?? name;
      const r = await fetch('/api/studio/direct', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ episode: (typeof args.episode === 'string' && args.episode) || focus?.code, tool, args: { ...args, via: 'voice' } }) }).then((x) => x.json()).catch(() => ({ ok: false, error: 'The Studio didn’t answer.' }));
      router.refresh();
      if (name === 'finish_dialogue' && r?.needs_recording) window.dispatchEvent(new CustomEvent('genovus:finish-dialogue', { detail: { shot: Number(args.shot) } }));
      return r;
    }
    // The package tour (genovus.io/tour): the page shows the step or switches package.
    if (name === 'show_step' || name === 'switch_package') {
      window.dispatchEvent(new CustomEvent('genovus:package-tour', { detail: { tool: name, args } }));
      await new Promise((r) => setTimeout(r, 150));
      return { ok: true };
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
    diag.current.msgs++;
    if (m.serverContent?.modelTurn?.parts?.some((p: { inlineData?: unknown }) => p.inlineData)) diag.current.audio++;
    if (m.error) { diag.current.error = String(m.error.message ?? JSON.stringify(m.error)).slice(0, 300); setErr(`Helix had a problem: ${diag.current.error}`); }
    if (m.setupComplete) {
      setPhase('live');
      diag.current.live = true;
      // If Helix says nothing within 12 seconds, say so instead of sitting silently.
      setTimeout(() => { if (session.current && diag.current.audio === 0) setErr('Helix hasn’t answered yet. Say hello, or tap Voice off and Talk to reconnect.'); }, 12000);
      send({ realtimeInput: { text: context === 'packages' ? `The visitor just opened ${focus?.label ?? 'a package tour'} on genovus.io. Welcome them in one sentence and begin the tour.` : ask ? `The person just opened voice Ask Helix${where ? ` on ${where}` : ''}. Greet them in one short sentence and ask what they need. Don't summarize the brief unless asked.` : context !== 'tour' ? `The Studio team just opened Ask Helix${focus?.label ? ` on ${focus.label}` : ' on the Character Bible'}. Greet them in one sentence, mention what is on screen, and ask what they want to work on.` : `The tour is starting now. The listener is on the chapter "${toSlug(pathRef.current)}". Begin.` } });
      return;
    }
    const sc = m.serverContent;
    if (sc) {
      if (sc.interrupted) { stopPlayback(); }
      for (const p of sc.modelTurn?.parts ?? []) if (p.inlineData?.data) play(p.inlineData.data, p.inlineData.mimeType ?? 'audio/pcm;rate=24000');
      if (sc.outputTranscription?.text) { turnText.current += sc.outputTranscription.text; setCaption(turnText.current); }
      if (sc.inputTranscription?.text) { heardText.current += sc.inputTranscription.text; setHeard(heardText.current); lastSpoke.current = Date.now(); }
      if (sc.turnComplete) {
        const said = turnText.current.trim(), you = heardText.current.trim();
        setLines((l) => [...l, ...(you ? [{ who: 'you' as const, text: you }] : []), ...(said ? [{ who: 'helix' as const, text: said }] : [])].slice(-40));
        // Ask Helix: a spoken exchange joins the person's thread (only when they actually spoke, never the greeting).
        if (ask && you) thread.saveVoice?.([{ role: 'user', text: you }, ...(said ? [{ role: 'helix' as const, text: said }] : [])], pageRef.current);
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
          if (!micOnRef.current || hushRef.current) return;
          // The mic always streams (the browser's echo cancellation removes Helix's own voice), so the Live API
          // hears an interruption from its first syllable. Locally, sustained speech while Helix talks (~120 ms)
          // silences the queued audio at once instead of waiting for the server to notice.
          if (speakingRef.current && e.data.level >= BARGE_IN) {
            if (++loud.current >= 3) { loud.current = 0; stopPlayback(); }
          } else loud.current = 0;
          send({ realtimeInput: { audio: { data: b64(e.data.pcm), mimeType: 'audio/pcm;rate=16000' } } });
        };
        // Push-to-talk: the mic stays closed until Space (or the button) is held.
        setMicOn(!pttRef.current); micOnRef.current = !pttRef.current;
      } catch {
        setMicOn(false); micOnRef.current = false;
        setErr('Microphone is off: type your questions below.');
      }
      const r = await fetch('/api/helix/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ voice: new URLSearchParams(location.search).get('voice') ?? undefined, context, focus, slug, threadId: ask ? thread.threadId : undefined }) });
      const s = await r.json();
      if (!r.ok) throw new Error(s.error ?? 'Helix could not start.');
      session.current = { id: s.sessionId, started: Date.now(), max: s.maxSeconds };
      diag.current = { msgs: 0, audio: 0, live: false, code: 0, reason: '', error: '', mic: micOnRef.current };
      tokens.current = 0;
      setStaff(Boolean(s.staff));
      setVoice(s.voice ?? '');
      pages.current = Array.isArray(s.pages) ? s.pages : [];
      const sock = new WebSocket(`${s.wsUrl}?access_token=${encodeURIComponent(s.token)}`);
      ws.current = sock;
      sock.onopen = () => send({ setup: s.setup });
      sock.onmessage = onMessage;
      sock.onerror = () => setErr('The voice connection had a problem.');
      sock.onclose = (e) => { diag.current.code = e.code; diag.current.reason = e.reason; if (session.current) end(e.code === 1000 && diag.current.audio ? (convo ? 'Conversation ended.' : 'Tour ended.') : `Voice connection closed (${e.code}${e.reason ? `: ${e.reason}` : ''}). Tap Talk to try again.`); };
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
    if (s) fetch('/api/helix/session', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: s.id, seconds: (Date.now() - s.started) / 1000, tokens: tokens.current, diag: { ...diag.current, why: why ?? '' } }) }).catch(() => {});
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
      // Hands-free (Ask Helix): no wrap-up line, and if the person spoke in the last three minutes, a fresh session picks
      // up quietly (it starts with the conversation so far). Otherwise it ends and waits for a tap.
      const carryOn = ask && handsRef.current && Date.now() - lastSpoke.current < 180_000;
      if (remaining <= 0 && carryOn) { end(); void start(); return; }
      if (remaining <= 30 && !wrapSent.current && !(ask && handsRef.current)) { wrapSent.current = true; send({ realtimeInput: { text: 'We have 30 seconds left in this session. Wrap up warmly in one or two sentences.' } }); }
      if (remaining <= 0) end(convo ? 'Session time is up. Tap Talk to start again.' : 'Session time is up. Thanks for taking the tour.');
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
  // Push-to-talk: hold to open the mic; letting go closes it and tells Helix the person finished speaking.
  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  const hold = () => { if (heldRef.current || phaseRef.current !== 'live') return; heldRef.current = true; stopPlayback(); micOnRef.current = true; setMicOn(true); };
  const release = () => { if (!heldRef.current) return; heldRef.current = false; micOnRef.current = false; setMicOn(false); send({ realtimeInput: { audioStreamEnd: true } }); };
  const holdRef = useRef(hold), releaseRef = useRef(release);
  holdRef.current = hold; releaseRef.current = release;
  // Registered once per push-to-talk switch, not per render: a re-render (holding Space re-renders) must not let go.
  useEffect(() => {
    if (!(embedded && ask && ptt)) return;
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName));
    const down = (e: KeyboardEvent) => { if (e.code !== 'Space' || e.repeat || typing(e.target)) return; e.preventDefault(); holdRef.current(); };
    const up = (e: KeyboardEvent) => { if (e.code !== 'Space') return; releaseRef.current(); };
    const away = () => releaseRef.current();
    const hidden = () => { if (document.hidden) releaseRef.current(); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', away); document.addEventListener('visibilitychange', hidden);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', away); document.removeEventListener('visibilitychange', hidden); releaseRef.current(); };
  }, [embedded, ask, ptt]);
  const setPttPref = (v: boolean) => { pref('helix-ptt', v); setPtt(v); heldRef.current = false; micOnRef.current = !v; setMicOn(!v); };
  const setHandsPref = (v: boolean) => { pref('helix-hands', v); setHands(v); };
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
    const el = spot.el ?? (spot.target ? document.querySelector(`[data-tour="${CSS.escape(spot.target)}"]`) : null);
    if (!el || !el.isConnected) { setBox(null); return; }
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
    window.addEventListener(openEvent, open);
    return () => window.removeEventListener(openEvent, open);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // Embedded in Ask Helix: start listening when Ask Helix opens (unless voice was turned off on this device).
  const voicePref = (v?: 'on' | 'off') => { try { if (v) localStorage.setItem('helix-voice', v); return localStorage.getItem('helix-voice') ?? 'on'; } catch { return 'on'; } };
  // Once per opening (a ref, so React's development double-mount can't start two sessions).
  const autoStarted = useRef(false);
  useEffect(() => { if (embedded && autoStart && !autoStarted.current && voicePref() !== 'off') { autoStarted.current = true; void start(); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (embedded) {
    const heardLine = heard || [...lines].reverse().find((l) => l.who === 'you')?.text || '';
    const saidLine = caption || [...lines].reverse().find((l) => l.who === 'helix')?.text || '';
    // Pointing at something on the page (Ask Helix's highlight / open_lead): drawn over the page, outside the drawer.
    const spotlight = box && mounted ? createPortal(
      <div className="hx-spot" style={{ top: box.top - 8, left: box.left - 8, width: box.width + 16, height: box.height + 16 }} aria-hidden="true">
        {spot?.caption ? <span className="hx-spot-cap">{spot.caption}</span> : null}
      </div>, document.body) : null;
    return (
      <>{spotlight}
      <div className={'hx-bar' + (live ? ' live' : '') + (speaking ? ' speaking' : '')} aria-live="polite">
        <div className="hx-bar-row">
          <span className={'hx-orb' + (speaking || phase === 'connecting' ? ' on' : '')} aria-hidden="true"><i /><i /><i /></span>
          <span className="hx-bar-status">
            <b>{phase === 'connecting' ? 'Connecting…' : phase === 'live' ? (hush ? 'Quiet while you record' : speaking ? 'Helix is speaking' : micOn ? 'Listening' : 'Muted') : 'Voice is off'}</b>
            <small>{phase === 'live' ? (hush ? 'Helix picks up again when the recorder closes' : speaking ? 'Interrupt any time, or type below' : micOn ? 'Speak, or type below' : 'Type below, or unmute') : phase === 'connecting' ? 'Allow the microphone if your browser asks' : 'Type below, or tap Talk'}</small>
          </span>
          {phase === 'live' ? <span className="hx-timer" title="Session time left">{mm}</span> : null}
          {phase === 'live' ? <button type="button" className={'hx-ic' + (micOn ? '' : ' off')} onClick={toggleMic} aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'}><span className="hx-level" style={{ transform: `scaleY(${micOn ? Math.min(1, 0.15 + level * 3) : 0.1})` }} />{micOn ? 'Mute' : 'Unmute'}</button> : null}
          {live
            ? <button type="button" className="hx-ic" onClick={() => { voicePref('off'); end(); }}>Voice off</button>
            : <button type="button" className="btn small primary" onClick={() => { voicePref('on'); void start(); }}>Talk</button>}
        </div>
        {ask ? (
          <div className="hx-bar-modes">
            <button type="button" className="hx-chip" aria-pressed={ptt} onClick={() => setPttPref(!ptt)} title="Hold Space (or the Hold to talk button) to speak; the mic is closed otherwise">Push-to-talk</button>
            <button type="button" className="hx-chip" aria-pressed={hands} onClick={() => setHandsPref(!hands)} title="Keep the conversation going past the 10-minute session while you're talking">Hands-free</button>
            {ptt && phase === 'live' ? <button type="button" className={'btn small' + (micOn ? ' primary' : '')} onPointerDown={(e) => { e.preventDefault(); hold(); }} onPointerUp={release} onPointerLeave={release} onPointerCancel={release} onContextMenu={(e) => e.preventDefault()}>{micOn ? 'Listening… let go to send' : 'Hold to talk (or Space)'}</button> : null}
          </div>
        ) : null}
        {live && (heardLine || saidLine) ? (
          <div className="hx-bar-lines">
            {heardLine ? <p className="hx-line you"><span>You</span>{heardLine}</p> : null}
            {saidLine ? <p className="hx-line helix"><span>Helix</span>{saidLine}</p> : null}
          </div>
        ) : null}
        {notes.length ? <p className="hx-bar-note">{notes.length === 1 ? 'Sent 1 note' : `Sent ${notes.length} notes`} to the team (Helix notes).</p> : null}
        {err && (phase !== 'ended' || !/^(Conversation|Tour) ended\.$/.test(err)) ? <p className="hx-err">{err}</p> : null}
      </div>
      </>
    );
  }
  // Rendered on <body>, above everything: a header or panel with a blur or transform would otherwise trap the
  // fixed-position dock inside itself.
  if (!mounted) return null;
  return createPortal(
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
        <aside className={'hx-dock' + (mini ? ' mini' : box ? ' spotting' : '')} aria-label={convo ? 'Talk to Helix' : 'Helix Live tour'}>
          <header className="hx-dock-head">
            <span className={'hx-orb' + (speaking ? ' on' : '')} aria-hidden="true"><i /><i /><i /></span>
            <span style={{ minWidth: 0, flex: 1, cursor: mini ? 'pointer' : undefined }} onClick={mini ? () => setMiniPref(false) : undefined}>
              <b>Helix Live{voice ? <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}> · {voice}</span> : null}</b>
              <small>{phase === 'connecting' ? 'Connecting…' : phase === 'live' ? (hush ? 'Quiet while you record' : speaking ? 'Speaking · interrupt any time' : micOn ? 'Listening' : 'Mic off · type below') : phase === 'ended' ? (convo ? 'Conversation ended' : 'Tour ended') : 'Not connected'}</small>
            </span>
            {phase === 'live' ? <span className="hx-timer" title="Session time left">{mm}</span> : null}
            {phase === 'live' ? <button className={'hx-ic' + (micOn ? '' : ' off')} onClick={toggleMic} aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'} title={micOn ? 'Mute' : 'Unmute'}><span className="hx-level" style={{ transform: `scaleY(${micOn ? Math.min(1, 0.15 + level * 3) : 0.1})` }} />{micOn ? 'Mic' : 'Muted'}</button> : null}
            {live ? <button className="hx-ic" onClick={() => end(convo ? 'Conversation ended.' : 'Tour ended.')}>End</button> : <button className="hx-ic" onClick={() => { setOpen(false); setPhase('idle'); setErr(''); }}>Close</button>}
            <button className="hx-ic hx-min" onClick={() => setMiniPref(!mini)} aria-label={mini ? 'Expand Helix' : 'Minimize Helix'} title={mini ? 'Expand' : 'Minimize'} aria-expanded={!mini}>{mini ? '▴' : '▾'}</button>
          </header>
          {!convo && (cta || phase === 'ended') ? (
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
              )) : <p className="muted" style={{ fontSize: 13 }}>Ideas, action items, questions and risks Helix notes {convo ? 'in this conversation' : 'during the tour'} land here{staff ? '. Hand any of them to an agent and it drafts a plan while you keep going.' : ' and go to the Genovus team.'}</p>}
            </div>
          )}
          {err ? <p className="hx-err">{err}</p> : null}
          <form className="hx-input" onSubmit={sendTyped}>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={phase === 'live' ? 'Type to Helix…' : 'Add a note…'} aria-label={phase === 'live' ? 'Message Helix' : 'Add a note'} maxLength={500} />
            {phase === 'live' || phase === 'connecting' ? <button className="btn small primary" type="submit">Send</button> : <button className="btn small primary" type="button" onClick={start}>{phase === 'ended' ? (convo ? 'Talk again' : 'Tour again') : 'Start'}</button>}
          </form>
        </aside>
      )}
    </>,
    document.body,
  );
}
