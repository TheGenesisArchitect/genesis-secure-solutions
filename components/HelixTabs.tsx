// The Helix area on the Enterprise console: Ask (the full conversation), What Helix knows (the memory the team
// keeps), and Notes (ideas and action items, worked with the build agent).
import Link from 'next/link';

const TABS: [string, string, string][] = [['ask', 'Ask Helix', '/console/helix/ask'], ['knows', 'What Helix knows', '/console/helix/knows'], ['notes', 'Notes', '/console/helix']];

export function HelixTabs({ current }: { current: 'ask' | 'knows' | 'notes' }) {
  return (
    <nav className="helix-tabs" aria-label="Helix">
      {TABS.map(([k, label, href]) => <Link key={k} className={'btn small' + (k === current ? ' primary' : ' ghost')} href={href} aria-current={k === current ? 'page' : undefined}>{label}</Link>)}
    </nav>
  );
}
