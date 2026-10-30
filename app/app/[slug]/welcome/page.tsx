// Welcome: the new client's first page in their dashboard, from the consult to the kickoff. Their package and its
// terms, the welcome form (the setup checklist, by section, filled as far as they can; the kickoff closes the rest),
// Ask Helix up front to help with any of it, their kickoff to confirm or move, the site preview built from their
// answers, and the carrier-approved promo library they start from. lib/welcome.ts gathers it.
import { Fragment } from 'react';
import Link from 'next/link';
import { AgencyShell, agencyContext } from '@/components/AgencyShell';
import { Bar } from '@/components/ui';
import { welcomeData, etWhen } from '@/lib/welcome';
import { SECTIONS, LINE_OPTIONS, LINE_PAGES } from '@/lib/checklist';
import { accessFor } from '@/lib/access';
import { WelcomeSection, KickoffCard, HelixWelcome } from '@/components/Welcome';

export const metadata = { title: 'Welcome' };
export const dynamic = 'force-dynamic';

const usd = (c: number) => `$${(c / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const dueLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

export default async function Welcome({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await agencyContext(slug);
  const [w, access] = await Promise.all([welcomeData(ctx.tenant.tenantId, slug), accessFor(ctx.tenant.tenantId, ctx.tenant.plan)]);
  const values = Object.fromEntries(Object.entries(w.status.intake).map(([k, v]) => [k, typeof v === 'string' ? v : v ? 'saved' : '']));
  const lines = Array.isArray(w.record.lines) ? (w.record.lines as string[]) : [];
  // The office's own lines first (what they told us on the consult); the rest stay available.
  const lineOptions = [...LINE_OPTIONS].sort((a, b) => Number(lines.includes(b[0])) - Number(lines.includes(a[0])));
  const most = LINE_PAGES[w.plan.id] ?? 0;
  const firstOpen = SECTIONS.find(([k]) => w.status.items.some((i) => i.section === k && !i.done))?.[0];
  const onFile: [string, unknown][] = [['Agency', w.record.agencyName ?? w.name], ['Address', w.record.address], ['Phone', w.record.phone], ['Email', w.record.email], ['Carrier', w.record.carrier], ['Website', w.record.website]];
  const kickMinutes = w.kickoff ? Math.round((Date.parse(w.kickoff.ends) - Date.parse(w.kickoff.starts)) / 60_000) : 30;
  return (
    <AgencyShell ctx={ctx} title="Welcome">
      <div className="wl">
        <div className="wl-main">
          <section className="wl-hero">
            <p className="eyebrow">{w.name} · {w.plan.name} plan</p>
            <h2>{w.first ? `${w.first}, let’s build your ${w.plan.name} platform` : `Let’s build your ${w.plan.name} platform`}</h2>
            <p className="soft">Fill in what you can before your kickoff. Leave anything you’re unsure of; we close it together on the call. Each section saves on its own, and you can come back any time.</p>
            <Bar value={w.progress.filled} total={w.progress.total} done={w.status.done} />
            <p className="muted" style={{ fontSize: 13 }}>{w.progress.filled} of {w.progress.total} answered{w.status.missing.length ? ` · still needed to build: ${w.status.missing.map((m) => m.label.replace(/^Your /, '').toLowerCase()).join(', ')}` : ' · everything we need to build is in'}</p>
            {access.has('helix') ? <HelixWelcome first={w.first} /> : null}
          </section>

          <details className="wl-sec">
            <summary><span className="wl-dot done">✓</span><b>On file from your consult</b><span className="wl-count">check it</span></summary>
            <div className="wl-form">
              <p className="muted wl-sub">Your site uses these exactly, so they must match your carrier agent profile. Something wrong? Note it under “Questions for your kickoff call” or tell Helix.</p>
              <dl className="wl-terms">{onFile.filter(([, v]) => typeof v === 'string' && v).map(([k, v]) => <Fragment key={String(k)}><dt>{String(k)}</dt><dd>{String(v)}</dd></Fragment>)}</dl>
            </div>
          </details>

          {SECTIONS.map(([key, title, sub]) => (
            <WelcomeSection key={key} slug={slug} title={title} sub={key === 'story' && most ? `${sub} Your ${w.plan.name} site has a page for up to ${most} lines.` : sub} open={key === firstOpen}
              values={values}
              items={w.status.items.filter((i) => i.section === key && !(i.kind === 'lines' && !most)).map(({ key: k, label, help, kind, required, options, done }) => ({ key: k, label, help, kind, required, options: kind === 'lines' ? lineOptions : options, done }))} />
          ))}
        </div>

        <aside className="wl-side">
          {w.kickoff ? <KickoffCard slug={slug} when={etWhen(w.kickoff.starts)} minutes={kickMinutes} confirmed={w.kickoff.confirmed} location={w.kickoff.location} />
            : <div className="wl-kick"><p className="eyebrow">Your kickoff call</p><p className="soft" style={{ fontSize: 14 }}>We’re setting the time with you. It shows here as soon as it’s on the calendar.</p></div>}

          <div className="wl-card">
            <p className="eyebrow">Your plan</p>
            <h3>{w.plan.name}</h3>
            <dl className="wl-terms">
              <dt>Setup</dt><dd>{usd(w.plan.setupCents ?? 0)}</dd>
              <dt>Deposit (70%)</dt><dd>{usd(w.deposit.cents)}{w.deposit.paid ? ' · paid ✓' : w.deposit.due ? ` · due ${dueLabel(w.deposit.due)}` : ''}</dd>
              <dt>At launch (30%)</dt><dd>{usd(w.balanceCents)}</dd>
              {w.plan.careName ? <><dt>After launch</dt><dd>{w.plan.careName} · {usd(w.plan.careCents ?? 0)}/mo</dd></> : null}
            </dl>
            <ul className="wl-inc">{w.plan.includes.map((x) => <li key={x}>{x}</li>)}{access.has('helix') ? <li>Ask Helix and Helix notes in your dashboard</li> : null}</ul>
            <p className="muted" style={{ fontSize: 13 }}><b>Support:</b> ask Helix any time, or reply to any Genovus email to reach a person on our team. Nothing goes public without your approval and your carrier’s.</p>
          </div>

          <div className="wl-card">
            <p className="eyebrow">Your site preview</p>
            {w.live ? <p className="soft" style={{ fontSize: 14 }}>Your site is live.</p>
              : <p className="soft" style={{ fontSize: 14 }}>We build it from your answers, so it fills in as you save. It’s ready to walk through on your kickoff; private until you and your carrier approve it.</p>}
            {w.previewUrl ? <a className="btn small" href={w.previewUrl} target="_blank" rel="noreferrer">{w.live ? 'Open your site ↗' : 'Open your preview ↗'}</a> : null}
          </div>

          <div className="wl-card">
            <p className="eyebrow">Your promo library</p>
            {w.library ? <p className="soft" style={{ fontSize: 14 }}><b>{w.library} carrier-approved promo{w.library === 1 ? '' : 's'}</b> to start from. Keep, change or drop any of them; we plan your first posts from them on the kickoff.</p>
              : <p className="soft" style={{ fontSize: 14 }}>Your carrier-approved starter promos land here before your kickoff.</p>}
            <Link className="btn small" href={`/app/${slug}/assets`}>Open your library</Link>
          </div>
        </aside>
      </div>
    </AgencyShell>
  );
}
