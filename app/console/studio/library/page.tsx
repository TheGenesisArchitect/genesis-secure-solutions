// The Screen Library: every real Genovus screen, desktop and phone, captured automatically with fictional data and
// ready to drop into any episode (no screen recording or uploads). Grouped by the chapter of the Genovus world it
// shows; press play on any screen. Staff only.
import Link from 'next/link';
import { ConsoleShell } from '@/components/ConsoleShell';
import { requireStaff } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { PlayButton, ScenePlayer } from '@/components/studio/ScenePlayer';
import catalog from '@/data/screen-library.json';

export const dynamic = 'force-dynamic';

type Row = { code: string; device: string; title: string; side: string; chapter: string; route: string; clip_path: string | null; still_path: string | null; secs: number | null; captured_at: string | null; captured_on: string | null; pending: string | null };

export default async function Library({ searchParams }: { searchParams: Promise<{ device?: string; side?: string }> }) {
  await requireStaff();
  const sp = await searchParams;
  const supabase = await db();
  const { data } = await supabase.from('studio_screens').select('*').order('code');
  const rows = ((data ?? []) as Row[]).filter((r) => (!sp.device || r.device === sp.device) && (!sp.side || r.side === sp.side));
  const chapters = (catalog as { chapters: Record<string, string> }).chapters;
  const ready = rows.filter((r) => r.clip_path);
  const pending = rows.filter((r) => !r.clip_path);
  const latest = ready.map((r) => r.captured_at).filter(Boolean).sort().at(-1);
  const tab = (label: string, q: Record<string, string>) => {
    const href = `/console/studio/library${Object.keys(q).length ? `?${new URLSearchParams(q)}` : ''}`;
    const on = (q.device ?? '') === (sp.device ?? '') && (q.side ?? '') === (sp.side ?? '');
    return <Link key={label} href={href} className={'sl-tab' + (on ? ' on' : '')}>{label}</Link>;
  };
  return (
    <ConsoleShell title="Screen Library" crumbs={[{ href: '/console', label: 'Enterprise' }, { href: '/console/studio', label: 'Studio' }, { label: 'Screen Library' }]}>
      <ScenePlayer />
      <section className="sl-head">
        <div>
          <span className="pb-eyebrow"><img src="/brand/genovus/genovus-egg.svg" alt="" />Genovus Studio · Screen Library</span>
          <h2>The software is the star.</h2>
          <p className="soft">Real Genovus screens, desktop and phone, captured automatically with fictional agencies and callers. Drop any of them into an episode; nobody records or uploads screens by hand.</p>
          <span className="sl-meta"><b>{ready.length}</b> screens ready{latest ? ` · captured ${new Date(latest).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}{pending.length ? ` · ${pending.length} waiting` : ''}</span>
        </div>
        <nav className="sl-tabs" aria-label="Filter">{[tab('All', {}), tab('Desktop', { device: 'desktop' }), tab('Phone', { device: 'phone' }), tab('Agency', { side: 'agency' }), tab('Enterprise', { side: 'enterprise' })]}</nav>
      </section>
      {Object.entries(chapters).map(([key, label]) => {
        const items = ready.filter((r) => r.chapter === key);
        if (!items.length) return null;
        return (
          <section key={key} className="sl-row" aria-label={label}>
            <div className="sx-row-head"><h3>{label}</h3><span>{items.length} screen{items.length === 1 ? '' : 's'}</span></div>
            <div className="sl-grid">
              {items.map((r) => (
                <figure key={`${r.code}:${r.device}`} className={'sl-card ' + r.device}>
                  <div className="sl-frame">
                    <img src={`/api/studio/library/${r.code}/${r.device}?still=1`} alt="" loading="lazy" />
                    <PlayButton big clips={[{ src: `/api/studio/library/${r.code}/${r.device}`, title: r.title, poster: `/api/studio/library/${r.code}/${r.device}?still=1` }]} />
                    <span className="sl-device">{r.device === 'phone' ? '📱 Phone' : '🖥 Desktop'}{r.secs ? ` · ${Math.round(Number(r.secs))}s` : ''}</span>
                  </div>
                  <figcaption><b>{r.title}</b><small>{r.side === 'agency' ? 'Agency' : 'Enterprise'} · <code>{r.code}:{r.device}</code></small></figcaption>
                </figure>
              ))}
            </div>
          </section>
        );
      })}
      {pending.length ? (
        <section className="pb-panel">
          <div className="pb-lab"><b>Waiting to be captured</b><span>{pending.length}</span></div>
          <ul className="pb-acc">{pending.map((r) => <li key={`${r.code}:${r.device}`}><span>{r.title} · {r.device}</span><span className="need">{r.pending ?? 'Not captured yet'}</span></li>)}</ul>
        </section>
      ) : null}
    </ConsoleShell>
  );
}
