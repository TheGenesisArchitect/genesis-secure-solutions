'use client';
// Series music on the Unedit page: the bed every polished episode lays under the voice, and drafts to choose from.
// Composing takes a minute or two (two drafts side by side); nothing becomes the bed until a person picks it.
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const toast = (r: { ok?: string; err?: string }) => window.dispatchEvent(new CustomEvent('genovus:toast', { detail: { ...r, at: Date.now() } }));
const when = (s: string) => new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });

export function UneditMusic({ bed, drafts, styles }: { bed: string | null; drafts: { path: string; src: string; style: string; at: string }[]; styles: { id: string; label: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [style, setStyle] = useState(styles[0]?.id ?? 'signal');
  const send = async (body: Record<string, unknown>, key: string) => {
    setBusy(key);
    try {
      const r = await fetch('/api/studio/unedit/music', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; say?: string; error?: string };
      toast(r.ok && j.ok ? { ok: j.say ?? 'Done.' } : { err: j.error ?? 'That didn’t work.' });
    } finally { setBusy(null); router.refresh(); }
  };
  const label = (id: string) => styles.find((s) => s.id === id)?.label ?? id;
  return (
    <div className="ue-music" style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <b>Music bed</b>
        {bed ? (
          <>
            <audio controls preload="none" src={bed} />
            <button type="button" className="btn small" disabled={busy !== null} onClick={() => send({ tool: 'off' }, 'off')}>Turn off</button>
          </>
        ) : <span className="muted">None yet: episodes have sound effects only.</span>}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <label htmlFor="ue-music-style" className="muted">Compose two drafts in</label>
        <select id="ue-music-style" value={style} onChange={(e) => setStyle(e.target.value)} disabled={busy !== null}>
          {styles.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <button type="button" className="btn small primary" disabled={busy !== null} onClick={() => send({ tool: 'compose', style }, 'compose')}>{busy === 'compose' ? 'Composing… about two minutes' : 'Compose'}</button>
      </div>
      {drafts.length ? (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
          {drafts.map((d) => (
            <li key={d.path} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
              <span className="muted">{label(d.style)} · {when(d.at)}</span>
              <audio controls preload="none" src={d.src} />
              <button type="button" className="btn small" disabled={busy !== null} onClick={() => send({ tool: 'use', path: d.path }, d.path)}>Use this one</button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="muted ue-small">Original scores composed by Runway (Seed Audio). Runway claims no ownership of what it generates and doesn’t restrict commercial use. The bed sits under your voice and drops lower while you speak.</p>
    </div>
  );
}
