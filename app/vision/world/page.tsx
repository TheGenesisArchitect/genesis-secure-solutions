// The Genovus World: the whole platform in one live sandbox, across the Enterprise, Agent and Network surfaces,
// with every module placed, its package, and whether it is Live, Building or Vision. The sandbox is sample
// data; the "Real today" strip is the live scanner's own counts (aggregates only, refreshed hourly).
import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { Chip } from '@/components/ui';
import { WorldSandbox } from '@/components/vision/WorldSandbox';
import { CHAPTERS } from '@/data/vision';
import { MODULES, SURFACES, STATUS_LABEL, type Status } from '@/lib/world';
import { worldStats, firstYear, GOAL_AGENCIES } from '@/lib/world-stats';

export const metadata = { title: 'Genovus World · vision', robots: { index: false, follow: false } };
export const revalidate = 3600;

const n = (x: number) => x.toLocaleString('en-US');
const usd = (x: number) => '$' + x.toLocaleString('en-US');

export default async function WorldPage() {
  const count = (s: string, st: Status) => MODULES.filter((m) => m.surface === s && m.status === st).length;
  const stats = await worldStats();
  const radar: [string, string][] | undefined = stats
    ? [['Offices mapped', n(stats.offices)], ['States', String(stats.states)], ['Carriers', String(stats.carriers)], ['Fit 70+', n(stats.highFit)]]
    : undefined;
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
      {stats ? (
        <section className="world-real" data-tour="world-real" aria-label="Real today">
          <div className="spread">
            <span className="v-eyebrow">Real today · the market is already mapped</span>
            <Chip kind="live">Live data · hourly</Chip>
          </div>
          <div className="world-real-tiles">
            <div className="hero"><small>Agency offices mapped</small><b>{n(stats.offices)}</b><span>{n(stats.captive)} captive · {n(stats.independent)} independent</span></div>
            <div><small>States swept</small><b>{stats.states}</b></div>
            <div><small>Carriers represented</small><b>{stats.carriers}</b></div>
            <div><small>Fit score 70+</small><b>{n(stats.highFit)}</b></div>
            <div><small>In conversation</small><b>{n(stats.engaged)}</b></div>
          </div>
          <p className="world-real-grow">
            <b>Room to grow:</b> the goal of {GOAL_AGENCIES} agencies is <b>{(GOAL_AGENCIES / stats.offices * 100).toFixed(1)}%</b> of the offices already mapped.
            At that goal, first-year revenue is <b>{usd(firstYear(1500, 249))}</b> on Launch and <b>{usd(firstYear(2500, 399))}</b> on Growth (setup plus twelve months of the plan).
          </p>
        </section>
      ) : null}
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
      <WorldSandbox radar={radar} />
      <nav className="v-pager" aria-label="Next">
        <span />
        <Link className="btn primary" href="/vision">Tour the Growth Engine →</Link>
      </nav>
    </Shell>
  );
}
