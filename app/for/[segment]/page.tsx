// Segment landing pages for our own campaigns: captive/exclusive agents, independent agencies, and carriers.
// Outreach links add ?c=<campaign>&src=<channel>&p=<prospect> (credited by RefCapture) and may add
// ?carrier=<slug> to name the agent's carrier in the headline. The name comes from our carrier catalog only,
// never free text, there are no carrier logos, and the page says Genovus is independent of every carrier.
import { notFound } from 'next/navigation';
import { SiteChrome } from '@/components/SiteChrome';
import { IntakeForm } from '@/components/IntakeForm';
import { PLANS } from '@/data/offers';
import { adminDb } from '@/lib/supabase/admin';

type Seg = { eyebrow: string; title: (carrier: string | null) => string; lede: string; points: [string, string][]; form: 'agency' | 'carrier' };

const SEGMENTS: Record<string, Seg> = {
  'captive-agents': {
    eyebrow: 'For exclusive and captive agents',
    title: (c) => (c ? `A local web presence built for ${c} agents.` : 'A local web presence built for exclusive agents.'),
    lede: 'Your own site, Facebook and Instagram, set up live with you in days, written to your carrier’s marketing rules and approved by you before anything goes out.',
    points: [
      ['Your carrier’s rules, built in', 'Approved wording, required disclosures and quote links go to your carrier’s official pages. Nothing is quoted or bound on our side.'],
      ['Live with you, not for you', 'We set up your profiles together on a short call. You own every account; we never ask for passwords.'],
      ['Care that keeps it working', 'Monthly posts, updates and a report with one clear next step, all approved by you.'],
    ],
    form: 'agency',
  },
  'independent-agencies': {
    eyebrow: 'For independent agencies',
    title: () => 'Be the agency people find, trust and choose.',
    lede: 'A carrier-aware website, social profiles and tracked callbacks for agencies that write with many carriers. Live in days, approved by you, cared for every month.',
    points: [
      ['Every carrier, one voice', 'Pages for the lines you write, with each carrier’s wording rules respected.'],
      ['Leads you can see', 'Tracked callbacks and quote requests land where your team works, with consent kept.'],
      ['One owner, many offices', 'Multi-location agencies run every office from one record and one dashboard.'],
    ],
    form: 'agency',
  },
  carriers: {
    eyebrow: 'For carriers and agency networks',
    title: () => 'Launch every agent’s local presence, on brand and on record.',
    lede: 'Genovus gives a carrier’s agent network compliant local sites and social profiles at scale, with approvals, an audit trail and network-wide performance in one view.',
    points: [
      ['Your rules, enforced', 'Brand and compliance wording is built into every agent’s record; required approvals route to your team.'],
      ['Network performance', 'Offices live, approval turnaround and leads by state, for the whole network or one region.'],
      ['A pilot first', 'Start with a region, measure it, then expand. Agents pay their own plans or you sponsor them.'],
    ],
    form: 'carrier',
  },
};

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ segment: string }> }) {
  const seg = SEGMENTS[(await params).segment];
  return { title: seg ? seg.eyebrow : 'Genovus', robots: { index: false, follow: false } };
}

async function carrierName(slug: string | undefined): Promise<string | null> {
  if (!slug || !/^[a-z0-9-]{2,40}$/.test(slug)) return null;
  try {
    const { data, error } = await adminDb().from('carriers').select('name').eq('slug', slug).maybeSingle();
    return error ? null : data?.name ?? null;
  } catch { return null; }
}

export default async function Segment({ params, searchParams }: { params: Promise<{ segment: string }>; searchParams: Promise<{ carrier?: string; err?: string }> }) {
  const [{ segment }, sp] = await Promise.all([params, searchParams]);
  const seg = SEGMENTS[segment];
  if (!seg) notFound();
  const carrier = seg.form === 'agency' ? await carrierName(sp.carrier) : null;
  const plans = PLANS.filter((p) => p.setupCents);
  return (
    <SiteChrome>
      <main className="wrapx sec" style={{ paddingTop: 48 }}>
        <div className="eyebrow">{seg.eyebrow}</div>
        <h1 style={{ font: '800 clamp(30px,4.6vw,54px)/1.05 var(--display)', letterSpacing: '-.02em', maxWidth: '20ch' }}>{seg.title(carrier)}</h1>
        <p className="lede">{seg.lede}</p>
        <div className="grid g3" style={{ marginTop: 8 }}>
          {seg.points.map(([t, d], i) => (
            <article className="feature" key={t}>
              <span className="ic">{String(i + 1).padStart(2, '0')}</span>
              <h3>{t}</h3>
              <p>{d}</p>
            </article>
          ))}
        </div>

        {seg.form === 'agency' ? (
          <section className="sec" style={{ paddingInline: 0 }}>
            <div className="eyebrow">Plans</div>
            <div className="grid g3">
              {plans.map((p) => (
                <article className="price" key={p.id}>
                  <h3>{p.name}</h3>
                  <p className="muted" style={{ margin: 0 }}>{p.forWho}</p>
                  <p style={{ font: '800 30px/1.1 var(--display)', margin: '10px 0 0' }}>${(p.setupCents! / 100).toLocaleString('en-US')}<span className="muted" style={{ font: '500 14px var(--body)' }}> setup</span></p>
                  {p.careCents ? <p className="muted" style={{ margin: 0 }}>then ${(p.careCents / 100).toLocaleString('en-US')}/month {p.careName}</p> : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}

        <section id="consult" className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))', alignItems: 'start', marginTop: 12 }}>
          <div style={{ display: 'grid', gap: 14 }}>
            <h2 className="big" style={{ margin: 0 }}>{seg.form === 'carrier' ? 'Talk about a pilot.' : 'Book a short consult.'}</h2>
            {sp.err ? <div className="notice err" role="alert">{sp.err}</div> : null}
            <IntakeForm kind={seg.form} defaults={carrier ? { carrier } : undefined} back={`/for/${segment}`} />
          </div>
          <div className="soft" style={{ fontSize: 14, display: 'grid', gap: 10 }}>
            <p style={{ margin: 0 }}>A real person replies within one business day. No obligation, and no passwords, ever.</p>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              Genovus is an independent marketing technology company{carrier ? `, not affiliated with or endorsed by ${carrier}` : ', not affiliated with or endorsed by any insurance carrier'}.
              Insurance quotes, policies and advice come only from licensed representatives through approved carrier channels.
            </p>
          </div>
        </section>
      </main>
    </SiteChrome>
  );
}
