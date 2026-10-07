import { SiteChrome } from '@/components/SiteChrome';
import { IntakeForm } from '@/components/IntakeForm';

export const metadata = { title: 'Carriers and agency networks' };

const PILOT = [
  ['What we deliver', ['Each pilot agency set up live: site, profiles and Google listing', 'Your wording rules built into every agency’s copy', 'Approval before anything goes public', 'A network view of every office', 'A pilot report at day 90']],
  ['What we measure', ['Days from intake to live, per agency', 'Specialist hours per agency', 'Approval turnaround', 'Leads tracked to their source']],
  ['What we ask of you', ['A named contact for brand and compliance', 'Your approved wording and templates', 'An introduction to the pilot agencies']],
] as const;

export default async function Partners({ searchParams }: { searchParams: Promise<{ err?: string; type?: string }> }) {
  const sp = await searchParams;
  return (
    <SiteChrome>
      <main className="wrapx sec" style={{ paddingTop: 48 }}>
        <div className="eyebrow">For carriers and agency networks</div>
        <h1 style={{ font: '800 clamp(30px,4.6vw,52px)/1.05 var(--display)', letterSpacing: '-.02em', maxWidth: '20ch' }}>Every office on brand, approved and growing.</h1>
        <p className="lede">Genovus gives every agency in your network a compliant local presence and gives you one view across all of them. It starts with a paid 90-day pilot with a group of your agencies, on terms set together.</p>
        <div className="grid g3">
          {PILOT.map(([t, items]) => (
            <div className="panel" key={t}>
              <h2>{t}</h2>
              <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--soft)', display: 'grid', gap: 4 }}>{items.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          ))}
        </div>
        {sp.err ? <div className="notice err" role="alert">{sp.err}</div> : null}
        <IntakeForm kind="carrier" defaults={{ type: sp.type === 'network' ? 'network' : 'carrier' }} />
      </main>
    </SiteChrome>
  );
}
