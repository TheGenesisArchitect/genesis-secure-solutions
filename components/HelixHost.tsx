'use client';
// Helix travels with you. The host is mounted once by the agency and console layouts, so it survives every page
// change: one thread (the typed and spoken conversation so far), one dock (open, or minimized to a pill showing
// Helix's last line), one voice session. Pages and "Ask Helix" buttons add to the thread instead of resetting it.
import { createContext, useContext, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type ReactNode, type SetStateAction } from 'react';
import Link from 'next/link';

const HELIX_EVT = 'genovus:helix'; // the event helixAsk() sends (components/HelixDrawer.tsx)

/** One turn of the conversation; `page` is where it was asked, so the thread shows "→ Pipeline" when it moves. */
export type HelixTurn = {
  role: 'user' | 'helix';
  text: string;
  page?: string;
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
};
const ThreadCtx = createContext<Thread | null>(null);

type Saved = { role: 'user' | 'helix'; text: string; page?: string; meta?: Partial<HelixTurn> };
const DISCLOSURE: Record<'agency' | 'enterprise', string> = {
  agency: 'Saved to your agency’s Genovus account. Visible to you, your agency owner and the Genovus support team.',
  enterprise: 'Saved to Genovus. Visible to you and the Genovus team.',
};

/** The thread every Helix chat on these pages shares (drawer and full page alike), restored from the account. */
export function HelixThreadProvider({ children, surface, slug }: { children: ReactNode; surface?: 'agency' | 'enterprise'; slug?: string }) {
  const [turns, setTurns] = useState<HelixTurn[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const asked = useRef(0);
  useEffect(() => {
    if (!surface) return;
    const q = new URLSearchParams({ surface, ...(slug ? { slug } : {}) });
    fetch(`/api/helix/thread?${q}`).then((r) => (r.ok ? r.json() : null)).then((j: { threadId: string | null; turns: Saved[] } | null) => {
      if (!j?.threadId) return;
      setThreadId((id) => id ?? j.threadId);
      // A question asked before the thread arrived wins; otherwise pick up where they left off.
      setTurns((t) => {
        if (t.length || !j.turns.length) return t;
        setRestored(true);
        return j.turns.map((s) => ({ ...(s.meta ?? {}), role: s.role, text: s.text, page: s.page }));
      });
    }).catch(() => {});
  }, [surface, slug]);
  return <ThreadCtx.Provider value={{ turns, setTurns, asked, threadId, setThreadId, restored, disclosure: surface ? DISCLOSURE[surface] : undefined }}>{children}</ThreadCtx.Provider>;
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
export function HelixDock({ path, pageName, fullHref, hidden, voice, chat }: {
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
    window.addEventListener(HELIX_EVT, onAsk);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener(HELIX_EVT, onAsk); window.removeEventListener('keydown', onKey); };
  }, []);
  // What the drawer is about: the item a button asked about, until you move to another page; then the page.
  const askHere = ask.path === path ? ask : { ...ask, context: undefined };
  const last = [...turns].reverse().find((t) => t.role === 'helix');
  const unread = dock === 'min' && turns.length > seen;
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
          <span className="helix-pill-text"><b>Helix</b><span>{last ? last.text : 'Ask anything. Helix keeps this conversation as you move.'}</span></span>
          {unread ? <span className="helix-pill-dot" aria-label="New reply" /> : null}
        </button>
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
