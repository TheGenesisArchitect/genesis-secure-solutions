// The frame of every agency site (app/s/[slug]): header with the agency and a call button, the pages its package
// includes, the footer with the office, hours, licensed states and the carrier line; a "preview" ribbon until launch.
import type { ReactNode } from 'react';
import type { SiteData } from '@/lib/site';

export const siteHref = (d: SiteData, path: string, k?: string) => `/s/${d.slug}${path ? `/${path}` : ''}${k ? `?k=${encodeURIComponent(k)}` : ''}`;

export function SiteShell({ d, k, children }: { d: SiteData; k?: string; children: ReactNode }) {
  const brand = d.logoId ? <img className="ag-logo" src={siteHref(d, `photo/${d.logoId}`, k)} alt={d.agency} /> : <span className="ag-word">{d.agency}</span>;
  return (
    <div className="agsite">
      {!d.live ? <div className="ag-ribbon" role="note">Private preview: not public yet. Nothing here is indexed until you and your carrier approve it.</div> : null}
      <header className="ag-head">
        <a className="ag-brand" href={siteHref(d, '', k)}>{brand}</a>
        <nav className="ag-nav" aria-label="Pages">
          {d.pages.map((p) => <a key={p.id} href={siteHref(d, p.path, k)}>{p.label}</a>)}
        </nav>
        {d.phoneE164 ? <a className="ag-call" href={`tel:${d.phoneE164}`}>Call {d.phone}</a> : null}
      </header>
      <main>{children}</main>
      <footer className="ag-foot">
        <div>
          <b>{d.legalName ?? d.agency}</b>
          {d.street ? <p>{d.street}<br />{[d.city, d.state].filter(Boolean).join(', ')} {d.zip ?? ''}</p> : d.city ? <p>{d.city}{d.state ? `, ${d.state}` : ''}</p> : null}
          {d.phone ? <p><a href={`tel:${d.phoneE164 ?? ''}`}>{d.phone}</a></p> : null}
        </div>
        <div>
          {d.hours ? <><b>Office hours</b><p className="ag-pre">{d.hours}</p></> : null}
          {d.licensed.length ? <p>Licensed in {d.licensed.join(', ')}</p> : null}
          {d.languages ? <p>We speak {d.languages}</p> : null}
        </div>
        <div>
          {d.carrierLine ? <p>{d.carrierLine}</p> : null}
          {d.officialUrl ? <p><a href={d.officialUrl} rel="noreferrer">Official agent page</a></p> : null}
          {d.placeId ? <p><a href={siteHref(d, 'review', k)}>Leave us a Google review</a></p> : null}
          <p className="ag-fine">Coverage is subject to the policy’s terms and the carrier’s approval. We never share your information.</p>
        </div>
      </footer>
    </div>
  );
}
