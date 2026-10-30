// The client's proposal (lib/proposal.ts): one private page from their record and the Genovus offer: the package,
// what we build, the price (70% deposit now, 30% at launch, care after), the steps to going live, and the deposit's
// pay link once it's open in Mercury. Signed link only; never indexed.
import { notFound } from 'next/navigation';
import { adminDb } from '@/lib/supabase/admin';
import { packageOf, planFor, proposalTenant, depositCents } from '@/lib/proposal';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your Genovus proposal', robots: { index: false, follow: false } };

const usd = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const DAYS = { launch: 7, growth: 10, premium: 14 } as const;

export default async function Proposal({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const id = proposalTenant(token);
  if (!id) notFound();
  const db = adminDb();
  const [{ data: t }, { data: rec }, { data: dep }] = await Promise.all([
    db.from('tenants').select('name, stage').eq('id', id).maybeSingle(),
    db.from('agent_records').select('data').eq('tenant_id', id).eq('is_current', true).maybeSingle(),
    db.from('invoices').select('status, pay_url, amount_cents, due_date').eq('tenant_id', id).eq('kind', 'deposit').neq('status', 'void').order('created_at').limit(1).maybeSingle(),
  ]);
  if (!t) notFound();
  const r = (rec?.data ?? {}) as Record<string, unknown>;
  const pkg = packageOf(r.package);
  const plan = planFor(pkg);
  const setup = plan.setupCents ?? 0, deposit = dep?.amount_cents ?? depositCents(pkg), balance = setup - deposit;
  const first = String(r.contactName ?? '').split(/\s+/)[0];
  const paid = dep?.status === 'paid';
  const days = DAYS[pkg];
  const steps: [string, string][] = [
    ['Today', 'Your welcome email brings your Welcome page: your form, your kickoff call and Ask Helix. Pay the deposit by its due date.'],
    ['Before the kickoff', 'Fill in your welcome form as best you can (about 15 minutes); the kickoff closes the rest.'],
    [`Days 2–${days - 4}`, `We build your site from your record${plan.id === 'launch' ? '' : `: up to ${plan.id === 'growth' ? 5 : 8} pages`}. You see a live preview as it fills in.`],
    [`Days ${days - 3}–${days - 1}`, 'Your carrier reviews the copy; you approve the site and your first month of posts.'],
    [`Day ${days}`, `You go live. ${plan.careName} starts.`],
  ];
  return (
    <main className="proposal">
      <style>{CSS}</style>
      <header className="pp-top">
        <img src="/brand/genovus/genovus-egg.svg" alt="" width={34} height={42} />
        <span>Genovus</span>
      </header>
      <section className="pp-hero">
        <p className="pp-eye">Proposal for {t.name}</p>
        <h1>{first ? `${first}, here’s your ` : 'Your '}<em>{plan.name}</em> package</h1>
        <p className="pp-sum">{plan.summary}</p>
        {r.trial === 'growth' && pkg === 'launch' ? <p className="pp-trial"><b>Includes a 30-day Growth trial:</b> Ask Helix, your pipeline, calendar, partner map, Competitor Radar, Visibility and monthly content, from day one. Keep Growth after the trial, or stay on Launch.</p> : null}
      </section>
      <section className="pp-grid">
        <div className="pp-card">
          <h2>What we build</h2>
          <ul>{plan.includes.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
        <div className="pp-card pp-price">
          <h2>Your investment</h2>
          <dl>
            <dt>Setup</dt><dd>{usd(setup)}</dd>
            <dt className="pp-strong">Deposit today (70%)</dt><dd className="pp-strong">{usd(deposit)}</dd>
            <dt>Balance at launch (30%)</dt><dd>{usd(balance)}</dd>
            <dt>{plan.careName}, from launch</dt><dd>{usd(plan.careCents ?? 0)}/mo</dd>
          </dl>
          {paid ? <p className="pp-paid">Deposit received. Thank you: your checklist is on its way.</p>
            : dep?.status === 'open' && dep.pay_url && /^https:\/\/([a-z0-9-]+\.)*mercury\.com\//.test(dep.pay_url)
              ? <a className="pp-pay" href={dep.pay_url} rel="noreferrer">Pay the {usd(deposit)} deposit</a>
              : <p className="pp-note">Your deposit invoice arrives by email from Genovus.</p>}
        </div>
      </section>
      <section className="pp-card">
        <h2>From today to live in about {days} days</h2>
        <ol className="pp-steps">{steps.map(([d, s]) => <li key={d}><b>{d}</b><span>{s}</span></li>)}</ol>
      </section>
      <footer className="pp-foot">
        <p>Questions? Reply to the email this came in, or call us. Nothing goes live in your name until you and your carrier approve it.</p>
        <p className="pp-fine">Genovus, a Genesis Secure Solutions brand. <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a></p>
      </footer>
    </main>
  );
}

const CSS = `
.proposal{max-width:920px;margin:0 auto;padding:28px max(16px,env(safe-area-inset-left,0px)) 64px max(16px,env(safe-area-inset-right,0px));display:grid;gap:22px;color:var(--ink)}
.pp-top{display:flex;align-items:center;gap:10px;font:800 18px var(--display);letter-spacing:.04em}
.pp-hero{display:grid;gap:10px;padding:8px 0}
.pp-eye{font:500 11px var(--mono);letter-spacing:.2em;text-transform:uppercase;color:var(--link)}
.pp-hero h1{font:800 clamp(32px,5.5vw,54px)/1.04 var(--display);margin:0}
.pp-hero h1 em{font-style:normal;background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.pp-sum{color:var(--soft);font-size:17px;max-width:60ch}
.pp-trial{border:1px solid color-mix(in srgb,var(--accent) 45%,transparent);background:color-mix(in srgb,var(--accent) 10%,transparent);border-radius:12px;padding:12px 14px;color:var(--ink);max-width:68ch}
.pp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:16px}
.pp-card{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:20px;display:grid;gap:12px;align-content:start}
.pp-card h2{font:800 19px var(--display);margin:0}
.pp-card ul{margin:0;padding-left:20px;display:grid;gap:6px;color:var(--soft)}
.pp-price dl{display:grid;grid-template-columns:1fr auto;gap:8px 16px;margin:0;font-variant-numeric:tabular-nums}
.pp-price dt{color:var(--soft)}
.pp-price dd{margin:0;text-align:right}
.pp-strong{color:var(--ink)!important;font-weight:700;font-size:17px}
.pp-pay{display:inline-block;justify-self:start;background:var(--grad);color:var(--on-accent);font:700 15px var(--body);text-decoration:none;padding:13px 22px;border-radius:999px}
.pp-paid{color:var(--done);font-weight:600}
.pp-note{color:var(--muted);font-size:14px}
.pp-steps{margin:0;padding:0;list-style:none;display:grid;gap:10px}
.pp-steps li{display:grid;grid-template-columns:110px minmax(0,1fr);gap:12px;padding:10px 0;border-top:1px solid var(--line)}
.pp-steps b{font:500 12px var(--mono);color:var(--accent-2);letter-spacing:.06em}
.pp-steps span{color:var(--soft)}
.pp-foot{display:grid;gap:6px;color:var(--soft);font-size:14px}
.pp-fine{color:var(--muted);font-size:12px}
.pp-fine a{color:var(--muted)}
@media (max-width:520px){.pp-steps li{grid-template-columns:1fr;gap:2px}}
`;
