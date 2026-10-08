'use client';
// The rail's collapse toggle ("[" too) and the Ctrl/⌘K jump box. The rail state lives in a cookie the server
// reads, so a reload renders the same layout with no flash.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from './icons';

export type JumpItem = { label: string; href: string; group: string; icon: string };

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function RailToggle({ collapsed }: { collapsed: boolean }) {
  const [c, setC] = useState(collapsed);
  const flip = useCallback(() => {
    setC((prev) => {
      const next = !prev;
      document.querySelector('.dash')?.setAttribute('data-rail', next ? 'collapsed' : 'open');
      document.cookie = `rail=${next ? 'collapsed' : 'open'}; path=/; max-age=31536000; samesite=lax`;
      return next;
    });
  }, []);
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === '[' && !e.metaKey && !e.ctrlKey && !e.altKey && !typing(e.target)) { e.preventDefault(); flip(); } };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [flip]);
  return (
    <button type="button" className="rail-toggle" onClick={flip} aria-label={c ? 'Expand menu ( [ )' : 'Collapse menu ( [ )'} title={c ? 'Expand menu  [' : 'Collapse menu  ['}>
      <Icon name={c ? 'expand' : 'collapse'} />
    </button>
  );
}

export function CommandBar({ items, searchClients }: { items: JumpItem[]; searchClients: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<JumpItem[]>([]);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); }
      else if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
  useEffect(() => { if (open) { setQ(''); setSel(0); setTimeout(() => input.current?.focus(), 0); } }, [open]);

  // Clients and agencies come from the server, filtered by what the signed-in person may see.
  useEffect(() => {
    if (!open || !searchClients || q.trim().length < 2) { setFound([]); return; }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`, { signal: ctl.signal });
        if (r.ok) setFound(((await r.json()) as { results: JumpItem[] }).results);
      } catch {}
    }, 160);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q, open, searchClients]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const local = s ? items.filter((i) => i.label.toLowerCase().includes(s) || i.group.toLowerCase().includes(s)) : items;
    return [...local, ...found].slice(0, 12);
  }, [q, items, found]);

  const go = (i: JumpItem | undefined) => { if (!i) return; setOpen(false); router.push(i.href); };

  return (
    <>
      <button type="button" className="btn small ghost jump-open" onClick={() => setOpen(true)} aria-label="Jump to (Ctrl K)">
        <Icon name="search" size={16} /><span className="jump-hint">Jump to</span><kbd>Ctrl K</kbd>
      </button>
      {open ? (
        <div className="jump-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="jump" role="dialog" aria-modal="true" aria-label="Jump to">
            <div className="jump-input">
              <Icon name="search" />
              <input ref={input} value={q} placeholder={searchClients ? 'Search tools, clients and agencies…' : 'Search tools…'} aria-label="Search"
                onChange={(e) => { setQ(e.target.value); setSel(0); }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, list.length - 1)); }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
                  else if (e.key === 'Enter') { e.preventDefault(); go(list[sel]); }
                }} />
              <kbd>Esc</kbd>
            </div>
            <ul className="jump-list" role="listbox">
              {list.length ? list.map((i, n) => (
                <li key={i.group + i.href} role="option" aria-selected={n === sel} onMouseEnter={() => setSel(n)} onClick={() => go(i)}>
                  <Icon name={i.icon} /><span>{i.label}</span><small>{i.group}</small>
                </li>
              )) : <li className="muted" aria-disabled="true">Nothing matches “{q}”</li>}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}
