// UnEdit Studio's one navigation: every part of the studio is one tap away, on every page and on a phone (the bar
// scrolls sideways and sticks under the console header). A recording adds its own two tabs: Review and Studio Live.
import Link from 'next/link';

const TABS = [
  { id: 'newsroom', href: '/console/studio/unedit/newsroom', label: 'Newsroom' },
  { id: 'record', href: '/console/studio/unedit/record', label: 'Record' },
  { id: 'recordings', href: '/console/studio/unedit', label: 'Recordings' },
  { id: 'music', href: '/console/studio/unedit/music', label: 'Music' },
] as const;
export type UneditTab = (typeof TABS)[number]['id'];

export function UneditNav({ active, recording, desk }: { active: UneditTab; recording?: { id: string; view: 'review' | 'live'; title: string }; desk?: { slug: string; name: string } | null }) {
  const q = desk ? `?desk=${desk.slug}` : '';
  return (
    <div className="ued-nav">
      <nav aria-label="UnEdit Studio" className="ued-tabs">
        <span className="ued-brand" aria-hidden="true"><i />UnEdit Studio</span>
        {TABS.map((t) => <Link key={t.id} href={`${t.href}${t.id === 'music' ? '' : q}`} className={active === t.id ? 'on' : ''} aria-current={active === t.id ? 'page' : undefined}>{t.label}</Link>)}
        {desk ? <span className="ued-desk" title="An agency desk: its own stories, recordings and calendar; posts wait for the owner">{desk.name}</span> : null}
      </nav>
      {recording ? (
        <nav aria-label={`Recording: ${recording.title}`} className="ued-sub">
          <span className="ued-sub-title">{recording.title}</span>
          <Link href={`/console/studio/unedit/${recording.id}`} className={recording.view === 'review' ? 'on' : ''} aria-current={recording.view === 'review' ? 'page' : undefined}>Review</Link>
          <Link href={`/console/studio/unedit/${recording.id}/live`} className={recording.view === 'live' ? 'on' : ''} aria-current={recording.view === 'live' ? 'page' : undefined}>Studio Live</Link>
        </nav>
      ) : null}
    </div>
  );
}
