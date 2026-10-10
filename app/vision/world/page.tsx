// The Genovus World: the whole platform in one live sandbox, across the Enterprise, Agent and Network surfaces,
// with every module placed, its package, and whether it is Live, Building or Vision. Sample data.
import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { Chip } from '@/components/ui';
import { WorldSandbox } from '@/components/vision/WorldSandbox';
import { CHAPTERS } from '@/data/vision';
import { MODULES, SURFACES, STATUS_LABEL, type Status } from '@/lib/world';

export const metadata = { title: 'Genovus World · vision', robots: { index: false, follow: false } };

export default function WorldPage() {
  const count = (s: string, st: Status) => MODULES.filter((m) => m.surface === s && m.status === st).length;
  return (
    <Shell
      surface="Vision"
      home="/vision"
      title="The Genovus World"
      crumbs={[{ href: '/vision', label: 'Genovus vision' }, { label: 'The whole platform' }]}
      who={{ name: 'Genovus vision', detail: 'Sample data · the platform as it will be', signedOut: true }}
      nav={[
        { title: 'The world', items: [{ href: '/vision/world', label: 'The whole platform', exact: true, icon: 'globe' }] },
        { title: 'The Growth Engine', items: CHAPTERS.map((c) => ({ href: c.slug ? `/vision/${c.slug}` : '/vision', label: `${c.n}. ${c.short}`, exact: true, icon: c.icon })) },
      ]}
      actions={<Chip kind="sample">Sample data</Chip>}
    >
      <div className="v-head">
        <span className="v-eyebrow">The Genovus World · intelliware</span>
        <p className="v-lede">One platform, three surfaces. <b>Enterprise</b> is built to serve the expansion. <b>Agents</b> get premium packaging and stay hands-free, selling and building relationships. <b>Networks and carriers</b> launch whole groups at once. Click anything: every module has one home, and you can see what’s live today.</p>
      </div>
      <div className="world-summary" data-tour="world-summary">
        {SURFACES.map((s) => (
          <div key={s.key} className="world-sum">
            <b>{s.name}</b>
            <small>{s.who}</small>
            <div className="row" style={{ gap: 6 }}>
              {(['live', 'building', 'vision'] as Status[]).map((st) => <span key={st} className={`world-status ${st}`}>{count(s.key, st)} {STATUS_LABEL[st]}</span>)}
            </div>
          </div>
        ))}
      </div>
      <WorldSandbox />
      <nav className="v-pager" aria-label="Next">
        <span />
        <Link className="btn primary" href="/vision">Tour the Growth Engine →</Link>
      </nav>
    </Shell>
  );
}
