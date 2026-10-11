'use client';
// What Helix knows: every memory the team kept, by department. Edit the wording, retire what's no longer true, or
// tell Helix something new. Each change is audited; Helix reads the kept ones every time it answers.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { decideMemory, rememberEnterprise } from '@/lib/helix-memory-actions';

type M = { id: string; department: string; kind: string; text: string; source: string; status: string; created_at: string; last_used_at: string | null };
const toast = (r: { ok?: string; err?: string }) => window.dispatchEvent(new CustomEvent('genovus:toast', { detail: { ...r, at: Date.now() } }));
const day = (s: string) => new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
const SOURCE: Record<string, string> = { conversation: 'from a conversation', person: 'told by the team', weekly: 'from the weekly review' };

export function MemoryItem({ m }: { m: M }) {
  const router = useRouter();
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState(m.text);
  const [busy, setBusy] = useState(false);
  const run = async (p: Promise<{ ok?: string; err?: string }>) => { setBusy(true); const r = await p; setBusy(false); toast(r); if (r.ok) { setEdit(false); router.refresh(); } };
  return (
    <li>
      {edit ? (
        <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); void run(decideMemory(m.id, '', text)); }}>
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} maxLength={400} style={{ flex: 1, minWidth: 0 }} aria-label="Memory" />
          <button className="btn small primary" type="submit" disabled={busy}>Save</button>
          <button className="btn small ghost" type="button" onClick={() => { setEdit(false); setText(m.text); }}>Cancel</button>
        </form>
      ) : <span style={m.status === 'retired' ? { textDecoration: 'line-through', color: 'var(--muted)' } : undefined}>{m.text}</span>}
      <div className="spread" style={{ gap: 8 }}>
        <span className="muted" style={{ fontSize: 12 }}>{m.kind} · {SOURCE[m.source] ?? m.source} · {day(m.created_at)}{m.last_used_at ? ` · last used ${day(m.last_used_at)}` : ' · not used yet'}</span>
        <span className="row" style={{ gap: 6 }}>
          {m.status === 'retired'
            ? <button className="btn small ghost" type="button" disabled={busy} onClick={() => run(decideMemory(m.id, 'kept'))}>Restore</button>
            : <><button className="btn small ghost" type="button" disabled={busy} onClick={() => setEdit(true)}>Edit</button><button className="btn small ghost" type="button" disabled={busy} onClick={() => run(decideMemory(m.id, 'retired'))}>Retire</button></>}
        </span>
      </div>
    </li>
  );
}

export function TeachHelix({ departments }: { departments: [string, string][] }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [dept, setDept] = useState('general');
  const [kind, setKind] = useState('fact');
  const [busy, setBusy] = useState(false);
  return (
    <form className="form" onSubmit={async (e) => { e.preventDefault(); setBusy(true); const r = await rememberEnterprise({ department: dept, kind, text, source: 'person' }); setBusy(false); toast(r); if (r.ok) { setText(''); router.refresh(); } }}>
      <label className="field"><span>What should Helix know?</span><textarea className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={400} required placeholder="e.g. Our goal this quarter is 5 new Growth clients; GEICO agents in Georgia are the priority." /></label>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <label className="field" style={{ flex: 1, minWidth: 140 }}><span>Department</span><select className="select" value={dept} onChange={(e) => setDept(e.target.value)}>{departments.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="field" style={{ flex: 1, minWidth: 140 }}><span>Kind</span><select className="select" value={kind} onChange={(e) => setKind(e.target.value)}><option value="fact">Fact</option><option value="goal">Goal</option><option value="preference">How we like it done</option><option value="outcome">What worked</option></select></label>
      </div>
      <button className="btn primary" type="submit" disabled={busy || text.trim().length < 3} style={{ justifySelf: 'start' }}>Teach Helix</button>
    </form>
  );
}
