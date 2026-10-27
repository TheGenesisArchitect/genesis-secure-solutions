// An agency's home page (lib/site.ts): who they are, what they help with, the person behind it, and a way to reach
// them now: call, ask for a callback, or (Growth and Premium) pick a time.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { siteFor } from '@/lib/site-access';
import { SiteShell, siteHref } from '@/components/site/SiteShell';
import { SiteContact } from '@/components/site/SiteContact';

export const dynamic = 'force-dynamic';

type P = { params: Promise<{ slug: string }>; searchParams: Promise<{ k?: string }> };

export async function generateMetadata({ params, searchParams }: P): Promise<Metadata> {
  const site = await siteFor((await params).slug, (await searchParams).k);
  if (!site) return { title: 'Not found', robots: { index: false, follow: false } };
  const d = site.d;
  return {
    title: { absolute: `${d.agency}${d.city ? ` | Insurance in ${d.city}${d.state ? `, ${d.state}` : ''}` : ''}` },
    openGraph: { siteName: d.agency, title: d.agency, description: `Local insurance help${d.city ? ` in ${d.city}` : ''}.` },
    description: `${d.agency}: local help with ${d.lines.map((l) => (l.label === 'RV' ? 'RV' : l.label.toLowerCase())).join(', ') || 'insurance'}${d.city ? ` in ${d.city}` : ''}. Call or ask for a callback.`,
    robots: { index: false, follow: false }, // indexing opens only at launch, after the carrier and the client approve
  };
}

export default async function SiteHome({ params, searchParams }: P) {
  const { slug } = await params;
  const site = await siteFor(slug, (await searchParams).k);
  if (!site) notFound();
  const { d, k } = site;
  const where = d.city ? `${d.city}${d.state ? `, ${d.state}` : ''}` : null;
  const initials = d.agency.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <SiteShell d={d} k={k}>
      <section className="ag-hero">
        <div>
          <h1>{where ? `Insurance help in ${where}, from people you can call.` : 'Insurance help from people you can call.'}</h1>
          <p>{d.agent ? `${d.agent} and the team at ${d.agency}` : d.agency} help with {d.lines.length ? d.lines.map((l) => (l.label === 'RV' ? 'RV' : l.label.toLowerCase())).join(', ').replace(/, ([^,]*)$/, ' and $1') : 'your insurance'}{where ? ` across ${d.city} and nearby` : ''}. Ask a question, review your coverage, or get a quote started.</p>
          <div className="ag-ctas">
            {d.phoneE164 ? <a className="ag-btn" href={`tel:${d.phoneE164}`}>Call {d.phone}</a> : null}
            <a className="ag-btn alt" href="#contact">{d.booking ? 'Book a time' : 'Ask for a callback'}</a>
          </div>
        </div>
        {d.headshotId ? <img className="ag-portrait" src={siteHref(d, `photo/${d.headshotId}`, k)} alt={d.agent ? `${d.agent}, ${d.agency}` : d.agency} /> : <div className="ag-mono" aria-hidden="true">{initials || 'A'}</div>}
      </section>

      {d.lines.length ? (
        <section className="ag-section" aria-label="What we help with">
          <h2>What we help with</h2>
          <div className="ag-lines">
            {d.lines.map((l) => {
              const page = d.pages.find((p) => p.id === l.id);
              const body = <><h3>{l.label} insurance</h3><p>{l.blurb}</p></>;
              return page ? <a key={l.id} className="ag-line" href={siteHref(d, page.path, k)}>{body}</a> : <div key={l.id} className="ag-line">{body}</div>;
            })}
          </div>
        </section>
      ) : null}

      <section className="ag-about">
        <div className="ag-card">
          <h2>{d.agent ? `Meet ${d.firstName}` : `About ${d.agency}`}</h2>
          <p>{d.agent ? `${d.agent} runs ${d.agency}${where ? ` in ${where}` : ''}.` : `${d.agency} is a local insurance office${where ? ` in ${where}` : ''}.`} You get a real person who knows the area, answers the phone, and helps you understand your options before you decide.</p>
          {d.languages ? <p>We speak {d.languages}.</p> : null}
        </div>
        <div className="ag-card">
          <h2>Visit or call</h2>
          {d.street ? <p>{d.street}<br />{where} {d.zip ?? ''}</p> : where ? <p>{where}</p> : null}
          {d.phone ? <p><a href={`tel:${d.phoneE164 ?? ''}`}>{d.phone}</a></p> : null}
          {d.hours ? <p className="ag-pre">{d.hours}</p> : null}
        </div>
      </section>

      <section id="contact" className="ag-section">
        <SiteContact slug={d.slug} agency={d.agency} booking={d.booking} lines={d.lines.map((l) => l.label)} k={k} />
      </section>
    </SiteShell>
  );
}
