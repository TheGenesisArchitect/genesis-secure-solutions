'use client';
// Helix travels with you. The host is mounted once by the agency and console layouts, so it survives every page
// change: one thread (the typed and spoken conversation so far), one dock (open, or minimized to a pill showing
// Helix's last line), one voice session. Pages and "Ask Helix" buttons add to the thread instead of resetting it.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type ReactNode, type SetStateAction } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const HELIX_EVT = 'genovus:helix'; // the event helixAsk() sends (components/HelixDrawer.tsx)

/** One turn of the conversation; `page` is where it was asked, so the thread shows "→ Pipeline" when it moves. */
export type HelixTurn = {
  role: 'user' | 'helix';
  text: string;
  page?: string;
  /** Spoken in voice Ask Helix (saved from the transcript) rather than typed. */
  channel?: 'text' | 'voice';
  noted?: boolean;
  followUps?: { who: string; reason: string; due: string; at: string }[];
  drafts?: { to: string; channel: string; body: string }[];
  remember?: { department: string; kind: string; text: string }[];
};
/**
 * `asked`: the last "Ask Helix" button press already answered, so a chat that remounts never asks it twice.
 * `threadId`: the saved thread (server), which every question continues; `restored`: turns came back from an earlier
 * visit or another device; `disclosure`: who can read the saved conversation.
 */
type Thread = {
  turns: HelixTurn[];
  setTurns: Dispatch<SetStateAction<HelixTurn[]>>;
  asked: MutableRefObject<number>;
  threadId: string | null;
  setThreadId: (id: string | null) => void;
  restored: boolean;
  disclosure?: string;
  /** The restored thread, for "Pick up where you left off" (its title, last page and when). */
  resume?: { title: string; lastPage: string | null; lastAt: string } | null;
  /** Save a spoken exchange (voice Ask Helix) to the thread and show it in the chat. */
  saveVoice?: (turns: { role: 'user' | 'helix'; text: string }[], page?: string) => void;
  /** The confirm lane (agency): one change waiting for a yes, and the last change, undoable for a short while. */
  act?: HelixAct;
};
export type HelixProposal = { ok: true; summary: string; token: string } | { ok: false; error: string; choices?: string[] };
export type HelixAct = {
  pending: HelixProposal | null;
  last: { done: string; undo?: string; at: number } | null;
  propose: (action: string, args: Record<string, unknown>) => Promise<HelixProposal>;
  confirm: (page?: string) => Promise<{ ok: boolean; done?: string; error?: string }>;
  dismiss: () => void;
  undo: (page?: string) => Promise<{ ok: boolean; done?: string; error?: string }>;
  show: (p: HelixProposal) => void;
};
const ThreadCtx = createContext<Thread | null>(null);

type Saved = { role: 'user' | 'helix'; text: string; page?: string; channel?: 'text' | 'voice'; meta?: Partial<HelixTurn> };
const DISCLOSURE: Record<'agency' | 'enterprise', string> = {
  agency: 'Saved to your agency’s Genovus account. Visible to you, your agency owner and the Genovus support team.',
  enterprise: 'Saved to Genovus. Visible to you and the Genovus team.',
};

/** The thread every Helix chat on these pages shares (drawer and full page alike), restored from the account. */
export function HelixThreadProvider({ children, surface, slug }: { children: ReactNode; surface?: 'agency' | 'enterprise'; slug?: string }) {
  const [turns, setTurns] = useState<HelixTurn[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const [resume, setResume] = useState<Thread['resume']>(null);
  const router = useRouter();
  // The confirm lane: a proposal waits for a yes (spoken or tapped); a done change can be undone for ten seconds here.
  const [pending, setPending] = useState<HelixProposal | null>(null);
  const [last, setLast] = useState<HelixAct['last']>(null);
  const pendingRef = useRef<HelixProposal | null>(null);
  const lastRef = useRef<HelixAct['last']>(null);
  useEffect(() => { pendingRef.current = pending; }, [pending]);
  useEffect(() => { lastRef.current = last; }, [last]);
  const actCall = useCallback(async (body: Record<string, unknown>) => fetch('/api/helix/act', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug, ...body }) })
    .then((r) => r.json()).catch(() => ({ ok: false, error: 'Helix couldn’t reach Genovus.' })), [slug]);
  const act: HelixAct | undefined = surface === 'agency' ? {
    pending, last,
    show: (p) => setPending(p),
    dismiss: () => setPending(null),
    propose: async (action, args) => { const p = (await actCall({ step: 'propose', action, args })) as HelixProposal; setPending(p); return p; },
    confirm: async (page) => {
      const p = pendingRef.current;
      if (!p || !p.ok) return { ok: false, error: 'Nothing is waiting for a yes.' };
      setPending(null);
      const r = await actCall({ step: 'confirm', token: p.token, threadId: idRefAct.current, page });
      if (r.ok) { setLast({ done: r.done, undo: r.undo, at: Date.now() }); setTurns((t) => [...t, { role: 'helix', text: `Done: ${r.done}`, page }]); router.refresh(); }
      return r;
    },
    undo: async (page) => {
      const l = lastRef.current;
      if (!l?.undo) return { ok: false, error: 'Nothing to undo.' };
      setLast(null);
      const r = await actCall({ step: 'undo', token: l.undo, threadId: idRefAct.current, page });
      if (r.ok) { setTurns((t) => [...t, { role: 'helix', text: r.done, page }]); router.refresh(); }
      return r;
    },
  } : undefined;
  const idRefAct = useRef<string | null>(null);
  useEffect(() => { idRefAct.current = threadId; }, [threadId]);
  const asked = useRef(0);
  // Spoken exchanges save one at a time, each continuing the thread the last one (or a typed answer) landed in.
  const idRef = useRef<string | null>(null);
  useEffect(() => { idRef.current = threadId; }, [threadId]);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const saveVoice = useCallback((said: { role: 'user' | 'helix'; text: string }[], page?: string) => {
    if (!surface || !said.some((t) => t.role === 'user')) return;
    setTurns((t) => [...t, ...said.map((x) => ({ ...x, page, channel: 'voice' as const }))]);
    queue.current = queue.current.then(() => fetch('/api/helix/thread', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ surface, slug, threadId: idRef.current, page, turns: said }) })
      .then((r) => (r.ok ? r.json() : null)).then((j: { threadId?: string } | null) => { if (j?.threadId) { idRef.current = j.threadId; setThreadId(j.threadId); } }).catch(() => {}));
  }, [surface, slug]);
  useEffect(() => {
    if (!surface) return;
    const q = new URLSearchParams({ surface, ...(slug ? { slug } : {}) });
    fetch(`/api/helix/thread?${q}`).then((r) => (r.ok ? r.json() : null)).then((j: { threadId: string | null; turns: Saved[]; title?: string; lastPage?: string | null; lastAt?: string } | null) => {
      if (!j?.threadId) return;
      if (j.title && j.lastAt) setResume({ title: j.title, lastPage: j.lastPage ?? null, lastAt: j.lastAt });
      setThreadId((id) => id ?? j.threadId);
      // A question asked before the thread arrived wins; otherwise pick up where they left off.
      setTurns((t) => {
        if (t.length || !j.turns.length) return t;
        setRestored(true);
        return j.turns.map((s) => ({ ...(s.meta ?? {}), role: s.role, text: s.text, page: s.page, channel: s.channel }));
      });
    }).catch(() => {});
  }, [surface, slug]);
  return <ThreadCtx.Provider value={{ turns, setTurns, asked, threadId, setThreadId, restored, disclosure: surface ? DISCLOSURE[surface] : undefined, saveVoice, act, resume }}>{children}</ThreadCtx.Provider>;
}

/** The shared thread, or a private one where no host is mounted. */
export function useHelixThread(): Thread {
  const shared = useContext(ThreadCtx);
  const [turns, setTurns] = useState<HelixTurn[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const asked = useRef(0);
  return shared ?? { turns, setTurns, asked, threadId, setThreadId, restored: false };
}

/** An item to ask about; `n` counts asks so the same question can be asked twice. */
export type HelixAsk = { question?: string; context?: string; n: number; path?: string };

type Dock = 'closed' | 'open' | 'min';

/**
 * The egg button, the drawer and the minimized pill. The drawer stays mounted once opened (hidden when minimized),
 * so the conversation and the voice session carry on while you work. Ctrl+J opens or minimizes; Esc minimizes.
 */
export function HelixDock({ path, pageName, fullHref, hidden, voice, chat, slug }: {
  /** The agency (its newest uncalled lead can be nudged beside the button). */
  slug?: string;
  path: string;
  pageName: string;
  fullHref: string;
  hidden?: boolean;
  voice: (autoStart: boolean) => ReactNode;
  chat: (ask: HelixAsk) => ReactNode;
}) {
  const { turns } = useHelixThread();
  const [dock, setDock] = useState<Dock>('closed');
  const [ask, setAsk] = useState<HelixAsk>({ n: 0 });
  const [seen, setSeen] = useState(0);
  // The voice session starts listening when the drawer first opens, unless a button opened it with a question.
  const [autoVoice, setAutoVoice] = useState(true);
  const dockRef = useRef<Dock>('closed');
  useEffect(() => { dockRef.current = dock; }, [dock]);
  useEffect(() => { if (dock === 'open') setSeen(turns.length); }, [dock, turns.length]);
  useEffect(() => {
    const onAsk = (e: Event) => {
      const d = (e as CustomEvent<Omit<HelixAsk, 'n'>>).detail ?? {};
      if (d.question && dockRef.current === 'closed') setAutoVoice(false);
      setAsk((a) => ({ ...d, n: a.n + 1, path: window.location.pathname }));
      setDock('open');
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); setDock((s) => (s === 'open' ? 'min' : 'open')); }
      if (e.key === 'Escape') setDock((s) => (s === 'open' ? 'min' : s));
    };
    // Helix pointing at something on the page minimizes itself so the page shows (voice keeps going).
    const onDock = (e: Event) => { const st = (e as CustomEvent<{ state?: Dock }>).detail?.state; if (st === 'min') setDock((s) => (s === 'open' ? 'min' : s)); if (st === 'open') setDock((s) => (s === 'min' ? 'open' : s)); };
    window.addEventListener(HELIX_EVT, onAsk);
    window.addEventListener('keydown', onKey);
    window.addEventListener('genovus:helix-dock', onDock);
    return () => { window.removeEventListener(HELIX_EVT, onAsk); window.removeEventListener('keydown', onKey); window.removeEventListener('genovus:helix-dock', onDock); };
  }, []);
  // What the drawer is about: the item a button asked about, until you move to another page; then the page.
  const askHere = ask.path === path ? ask : { ...ask, context: undefined };
  const last = [...turns].reverse().find((t) => t.role === 'helix');
  const unread = dock === 'min' && turns.length > seen;
  // One quiet message beside Helix at a time: the newest uncalled lead first, else "pick up where you left off".
  const { nudge, dismissNudge } = useLeadNudge(slug);
  const { resume } = useHelixThread();
  const [resumeShown, setResumeShown] = useState(true);
  useEffect(() => { try { setResumeShown(sessionStorage.getItem('helix-resumed') === '1'); } catch { setResumeShown(true); } }, []);
  const markResumed = () => { setResumeShown(true); try { sessionStorage.setItem('helix-resumed', '1'); } catch {} };
  const router = useRouter();
  const stale = resume && Date.now() - new Date(resume.lastAt).getTime() > 20 * 60_000 && Date.now() - new Date(resume.lastAt).getTime() < 86_400_000;
  const bubble = nudge && slug
    ? { head: 'New lead · call now?', text: `${nudge.name}${nudge.topic ? ` · ${nudge.topic}` : ''} · ${ago(nudge.created_at)}`, go: () => { dismissNudge(nudge.id); router.push(`/app/${slug}/today`); }, dismiss: () => dismissNudge(nudge.id) }
    : stale && !resumeShown && resume
      ? { head: 'Pick up where you left off', text: `${resume.title}${resume.lastPage ? ` · ${resume.lastPage}` : ''}`, go: () => { markResumed(); setDock('open'); }, dismiss: markResumed }
      : null;
  if (hidden) return null; // the full Ask Helix page shows the same thread
  return (
    <>
      {dock === 'closed' ? (
        <button className="helix-fab" type="button" onClick={() => setDock('open')} aria-expanded={false} aria-label="Ask Helix (Ctrl+J)" title="Ask Helix (Ctrl+J)">
          <img src="/brand/genovus/genovus-egg.svg" alt="" aria-hidden="true" /><span>Ask Helix</span>
        </button>
      ) : null}
      {dock === 'min' ? (
        <button className="helix-pill" type="button" onClick={() => setDock('open')} aria-label="Open Ask Helix (Ctrl+J)" title="Open Ask Helix (Ctrl+J)">
          <img src="/brand/genovus/genovus-egg.svg" alt="" aria-hidden="true" />
          <span className="helix-pill-text"><b>{nudge ? 'New lead' : 'Helix'}</b><span>{nudge ? `${nudge.name}${nudge.topic ? ` · ${nudge.topic}` : ''}. Call now?` : last ? last.text : 'Ask anything. Helix keeps this conversation as you move.'}</span></span>
          {unread ? <span className="helix-pill-dot" aria-label="New reply" /> : null}
        </button>
      ) : null}
      <HelixUndoBar page={pageName} />
      {dock === 'closed' && bubble ? (
        <div className="helix-nudge" role="status">
          <button type="button" className="helix-nudge-main" onClick={bubble.go}><b>{bubble.head}</b><span>{bubble.text}</span></button>
          <button type="button" className="helix-nudge-x" aria-label="Dismiss" onClick={bubble.dismiss}>×</button>
        </div>
      ) : null}
      {dock !== 'closed' ? (
        <aside className="helix-drawer" aria-label="Ask Helix" hidden={dock !== 'open'}>
          <header className="row" style={{ justifyContent: 'space-between' }}>
            <span className="row" style={{ gap: 8 }}><img src="/brand/genovus/genovus-egg.svg" alt="" aria-hidden="true" style={{ width: 20 }} /><b>Helix</b><span className="muted" style={{ fontSize: 12 }}>on {pageName}</span></span>
            <span className="row" style={{ gap: 6 }}>
              <Link className="btn small ghost" href={fullHref}>Full view</Link>
              <button className="btn small ghost" type="button" onClick={() => setDock('min')} aria-label="Minimize Helix (Esc)" title="Minimize: Helix keeps the conversation">–</button>
            </span>
          </header>
          {voice(autoVoice)}
          {chat(askHere)}
        </aside>
      ) : null}
    </>
  );
}

/** Tell a live voice session what just happened on screen, so Helix can say it (a tap on Yes or Undo). */
export const tellVoice = (text: string) => window.dispatchEvent(new CustomEvent('genovus:helix-said', { detail: { text } }));

/** A change Helix proposed, waiting for a yes: one tap to do it, or not now. Spoken "yes" does the same. */
export function HelixActCard({ page }: { page?: string }) {
  const { act } = useHelixThread();
  const [busy, setBusy] = useState(false);
  const p = act?.pending;
  if (!act || !p) return null;
  if (!p.ok) return (
    <div className="helix-card act" role="status">
      <span><b>Helix needs a detail</b><br />{p.error}{p.choices?.length ? ` ${p.choices.join(' · ')}` : ''}</span>
      <button className="btn small ghost" type="button" onClick={act.dismiss}>OK</button>
    </div>
  );
  return (
    <div className="helix-card act" role="group" aria-label="Confirm Helix’s change">
      <span><span className="helix-lane">Changes your data · needs your yes</span><br /><b>{p.summary}?</b></span>
      <span className="row" style={{ gap: 6 }}>
        <button className="btn small primary" type="button" disabled={busy} onClick={async () => { setBusy(true); const r = await act.confirm(page); setBusy(false); tellVoice(r.ok ? `(The person tapped Yes. ${r.done})` : `(It didn't go through: ${r.error})`); }}>Yes, do it</button>
        <button className="btn small ghost" type="button" disabled={busy} onClick={() => { act.dismiss(); tellVoice('(The person tapped Not now. Nothing changed.)'); }}>Not now</button>
      </span>
    </div>
  );
}

/** "Done · Undo" for ten seconds after Helix changes something, on any page, open or minimized. */
export function HelixUndoBar({ page }: { page?: string }) {
  const { act } = useHelixThread();
  const [, tick] = useState(0);
  const last = act?.last;
  useEffect(() => { if (!last) return; const t = setTimeout(() => tick((n) => n + 1), 10_200 - (Date.now() - last.at)); return () => clearTimeout(t); }, [last]);
  if (!act || !last || Date.now() - last.at > 10_000) return null;
  return (
    <div className="helix-undo" role="status">
      <span>{last.done}</span>
      {last.undo ? <button className="btn small" type="button" onClick={async () => { const r = await act.undo(page); tellVoice(r.ok ? `(The person tapped Undo. ${r.done})` : `(Undo didn't go through: ${r.error})`); }}>Undo</button> : null}
    </div>
  );
}

const ago = (iso: string) => { const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000)); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };

/** The newest uncalled lead from the last day (checked every minute), unless the person dismissed it on this device. */
function useLeadNudge(slug?: string) {
  const [lead, setLead] = useState<{ id: string; name: string; topic: string | null; created_at: string } | null>(null);
  const [gone, setGone] = useState<string[]>([]);
  useEffect(() => { try { setGone(JSON.parse(localStorage.getItem('helix-nudged') ?? '[]')); } catch {} }, []);
  useEffect(() => {
    if (!slug) return;
    let live = true;
    const check = () => fetch(`/api/helix/nudge?slug=${encodeURIComponent(slug)}`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (live) setLead(j?.lead ?? null); }).catch(() => {});
    void check();
    const t = setInterval(check, 60_000);
    return () => { live = false; clearInterval(t); };
  }, [slug]);
  const dismissNudge = (id: string) => setGone((g) => { const n = [id, ...g.filter((x) => x !== id)].slice(0, 50); try { localStorage.setItem('helix-nudged', JSON.stringify(n)); } catch {} return n; });
  return { nudge: lead && !gone.includes(lead.id) ? lead : null, dismissNudge };
}
