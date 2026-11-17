'use client';
// The posting calendar on Recordings: every approved post from today on, by day (New York). A post waiting for its
// time can be moved or taken off; once it has gone to Metricool it is locked here (change it in Metricool).
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { dayLabel, fromNyInput, nyInput } from '@/lib/unedit-plan';

export type CalPost = { id: string; vlog: string; episode: string; clip: number | null; platform: string; kind: string; status: string; at: string; url: string | null };
const NETS: Record<string, string> = { instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', tiktok: 'TikTok', twitter: 'X', linkedin: 'LinkedIn' };
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
const toast = (r: { ok?: string; err?: string }) => window.dispatchEvent(new CustomEvent('genovus:toast', { detail: { ...r, at: Date.now() } }));

export function PostCalendar({ posts }: { posts: CalPost[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const send = async (p: CalPost, body: Record<string, unknown>) => {
    setBusy(p.id);
    try {
      const r = await fetch('/api/studio/unedit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: p.vlog, post: p.id, ...body }) });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; say?: string; error?: string };
      toast(r.ok && j.ok ? { ok: j.say ?? 'Done.' } : { err: j.error ?? 'That didn’t work.' });
      if (r.ok && j.ok) setOpen(null);
    } finally { setBusy(null); router.refresh(); }
  };
  const days = new Map<string, CalPost[]>();
  for (const p of posts) days.set(dayLabel(p.at), [...(days.get(dayLabel(p.at)) ?? []), p]);
  if (!posts.length) return <p className="muted">Nothing on the calendar. Approve a recording with Helix’s plan or your own times and its posts show up here.</p>;
  return (
    <ol className="ue-calendar">
      {[...days.entries()].map(([d, list]) => (
        <li key={d}>
          <b>{d}</b>
          <ul>
            {list.map((p) => (
              <li key={p.id} className={p.status === 'queued' || p.status === 'awaiting_owner' ? '' : 'locked'}>
                <span className="t">{time(p.at)}</span>
                <span className="w"><Link href={`/console/studio/unedit/${p.vlog}`}>{p.episode}</Link> · {p.clip ? `clip ${p.clip}` : 'full video'} · {NETS[p.platform] ?? p.platform}{p.kind === 'video' ? '' : p.kind === 'short' ? ' Short' : ' Reel'}</span>
                <span className="s">
                  {p.status === 'queued' || p.status === 'awaiting_owner' ? (open === p.id ? (
                    <span className="ue-cal-edit">
                      <input type="datetime-local" className="input" aria-label="New day and time (New York)" value={when} onChange={(e) => setWhen(e.target.value)} />
                      <button type="button" className="btn small primary" disabled={busy === p.id || !fromNyInput(when)} onClick={() => send(p, { tool: 'move_post', at: fromNyInput(when) })}>Save</button>
                      <button type="button" className="btn small" onClick={() => setOpen(null)}>Close</button>
                    </span>
                  ) : (<>
                    {p.status === 'awaiting_owner' ? <span className="chip pending">Waiting for owner</span> : null}
                    <button type="button" className="btn small" onClick={() => { setOpen(p.id); setWhen(nyInput(p.at)); }}>Move</button>
                    <button type="button" className="btn small" disabled={busy === p.id} onClick={() => send(p, { tool: 'cancel_post' })}>Cancel</button>
                  </>)) : p.status === 'posted' ? (p.url ? <a href={p.url} target="_blank" rel="noreferrer">Live ↗</a> : <span className="muted">Live</span>) : p.status === 'error' ? <span className="ue-err">Failed</span> : <span className="muted">Sent to Metricool</span>}
                </span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
