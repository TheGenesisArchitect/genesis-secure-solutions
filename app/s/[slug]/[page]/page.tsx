// One line-of-business page on an agency site (Growth: up to 4, Premium: up to 7, beside the home page). Only the
// lines the agency sells; plain local copy, no prices or promises; a way to reach the office on every page.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { siteFor } from '@/lib/site-access';
import { SiteShell, siteHref } from '@/components/site/SiteShell';
import { SiteContact } from '@/components/site/SiteContact';

export const dynamic = 'force-dynamic';

type P = { params: Promise<{ slug: string; page: string }>; searchParams: Promise<{ k?: string }> };

export async function generateMetadata({ params, searchParams }: P): Promise<Metadata> {
  const { slug, page } = await params;
  const site = await siteFor(slug, (await searchParams).k);
  const line = site?.d.pages.find((p) => p.path === page);
  if (!site || !line) return { title: 'Not found', robots: { index: false, follow: false } };
  return { title: { absolute: `${line.title} | ${site.d.agency}` }, openGraph: { siteName: site.d.agency, title: `${line.title} | ${site.d.agency}` }, description: `${line.blurb}${site.d.city ? ` ${site.d.agency} in ${site.d.city}.` : ''}`, robots: { index: false, follow: false } };
}

export default async function LinePage({ params, searchParams }: P) {
  const { slug, page } = await params;
  const site = await siteFor(slug, (await searchParams).k);
  if (!site) notFound();
  const { d, k } = site;
  const line = d.pages.find((p) => p.path === page);
  if (!line) notFound();
  return (
    <SiteShell d={d} k={k}>
      <section className="ag-hero" style={{ gridTemplateColumns: 'minmax(0,1fr)' }}>
        <div>
          <p style={{ fontWeight: 600, color: 'var(--ag-accent)' }}><a href={siteHref(d, '', k)} style={{ color: 'inherit', textDecoration: 'none' }}>{d.agency}</a></p>
          <h1>{line.title}</h1>
          <p>{line.blurb}</p>
          <div className="ag-ctas">
            {d.phoneE164 ? <a className="ag-btn" href={`tel:${d.phoneE164}`}>Call {d.phone}</a> : null}
            <a className="ag-btn alt" href="#contact">{d.booking ? 'Book a time' : 'Ask for a callback'}</a>
          </div>
        </div>
      </section>
      {line.points.length ? (
        <section className="ag-card">
          <h2>When people call us about {line.label.toLowerCase()} insurance</h2>
          <ul className="ag-points">{line.points.map((x) => <li key={x}>{x}</li>)}</ul>
          <p style={{ color: 'var(--ag-soft)' }}>Every situation is different. We’ll talk through yours and what your options are; coverage depends on the policy’s terms.</p>
        </section>
      ) : null}
      <section id="contact" className="ag-section">
        <SiteContact slug={d.slug} agency={d.agency} booking={d.booking} lines={d.lines.map((l) => l.label)} k={k} topic={line.label} />
      </section>
    </SiteShell>
  );
}
