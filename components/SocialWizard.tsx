'use client';
// The Social setup wizard (data from lib/social-wizard.ts, saves in lib/social-wizard-actions.ts). One card per
// channel; open one and it walks the whole job: have it or build it, the link, access for Genovus, Metricool.
// Staff helping on a call see the same screen plus the Genovus-side confirmations.
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { WizardData, WizChannel, WizStep } from '@/lib/social-wizard';
import { socialChoose, socialConfirm, socialConnectUrl, socialCopy, socialLink, socialSent, socialStep, type SocialResult } from '@/lib/social-wizard-actions';

const STATUS: Record<WizChannel['status'], [string, string]> = {
  new: ['Not started', ''], progress: ['In progress', 'info'], waiting: ['Waiting on Genovus', 'pending'], connected: ['Connected', 'done'], skipped: ['Not now', ''], carrier: ['Run by your carrier', ''],
};
/** Steps that make something public: they wait for the approved wording. */
const PUBLIC = new Set(['fb-page', 'fb-details', 'ig-profile', 'g-match']);

function stepDone(c: WizChannel, s: WizStep) {
  const r = c.row;
  return s.kind === 'copy' ? !!r.copy_ok_at : s.kind === 'link' ? !!r.link : s.kind === 'access' ? r.access !== 'none' : s.kind === 'metricool' ? r.metricool !== 'none' : r.steps.includes(s.id);
}

export function SocialWizard({ slug, data, staff, open }: { slug: string; data: WizardData; staff: boolean; open?: string }) {
  const [cur, setCur] = useState<string | null>(open && data.channels.some((c) => c.id === open) ? open : null);
  const [msg, setMsg] = useState<SocialResult>({});
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (p: Promise<SocialResult>) => start(async () => { const r = await p; setMsg(r); if (r.ok) router.refresh(); });
  const core = data.channels.filter((c) => c.core), more = data.channels.filter((c) => !c.core);
  const active = data.channels.find((c) => c.id === cur);
  return (
    <div className="social-wiz">
      {staff ? <StaffLink slug={slug} url={data.connectUrl} run={run} pending={pending} /> : null}
      {msg.err ? <div className="notice err">{msg.err}</div> : msg.ok ? <div className="notice ok">{msg.ok}</div> : null}
      {active ? (
        <ChannelFlow key={active.id} slug={slug} c={active} data={data} staff={staff} run={run} pending={pending} close={() => { setCur(null); setMsg({}); }} />
      ) : (
        <>
          <div className="social-cards">{core.map((c) => <Card key={c.id} c={c} onOpen={() => { setCur(c.id); setMsg({}); }} />)}</div>
          <h3 className="social-more">More channels <span className="muted">(optional)</span></h3>
          <div className="social-cards small">{more.map((c) => <Card key={c.id} c={c} onOpen={() => { setCur(c.id); setMsg({}); }} />)}</div>
        </>
      )}
    </div>
  );
}

function Card({ c, onOpen }: { c: WizChannel; onOpen: () => void }) {
  const [label, kind] = STATUS[c.status];
  return (
    <button type="button" className={`social-card ${c.status}`} onClick={onOpen}>
      <span className="social-card-top"><b>{c.name}</b><span className={`chip ${kind}`}>{label}</span></span>
      <span className="soft">{c.summary}</span>
      <span className="social-card-go">{c.status === 'new' ? 'Start' : c.status === 'connected' ? 'Review' : 'Continue'} →</span>
    </button>
  );
}

type Run = (p: Promise<SocialResult>) => void;

function ChannelFlow({ slug, c, data, staff, run, pending, close }: { slug: string; c: WizChannel; data: WizardData; staff: boolean; run: Run; pending: boolean; close: () => void }) {
  const r = c.row;
  const steps = useMemo(() => (r.path === 'create' ? [...c.createSteps, ...c.tailSteps] : c.tailSteps), [r.path, c.createSteps, c.tailSteps]);
  const firstOpen = Math.max(0, steps.findIndex((s) => !stepDone(c, s)));
  const [i, setI] = useState(firstOpen === -1 ? 0 : firstOpen);
  const step = steps[Math.min(i, steps.length - 1)];
  const isGoogle = c.id === 'google';
  const header = (
    <div className="social-flow-head">
      <button type="button" className="btn small ghost" onClick={close}>← All channels</button>
      <div><h2>{c.name}</h2><span className="soft">{c.access}</span></div>
    </div>
  );
  // Google: who runs the listing comes first.
  if (isGoogle && !r.google_owner) {
    return (
      <div className="panel social-flow">{header}
        <h3>Who looks after your Google listing today?</h3>
        <p className="soft">Some carriers run their offices’ listings, so we check before touching anything. Search your office on Google Maps if you’re not sure one exists.</p>
        <div className="social-choices">
          <Choice title="I do" text="I set it up or can sign in to it." onClick={() => run(socialChoose(slug, 'google', 'have', 'me'))} disabled={pending} />
          <Choice title="My carrier does" text="We leave it alone and point your site to it." onClick={() => run(socialChoose(slug, 'google', null, 'carrier'))} disabled={pending} />
          <Choice title="Nobody, there isn’t one" text="We create and verify it with you." onClick={() => run(socialChoose(slug, 'google', 'create', 'none'))} disabled={pending} />
          <Choice title="Not sure" text="We check it together on a short call." onClick={() => run(socialChoose(slug, 'google', null, 'unsure'))} disabled={pending} />
        </div>
      </div>
    );
  }
  if (isGoogle && (r.google_owner === 'carrier' || r.google_owner === 'unsure')) {
    return (
      <div className="panel social-flow">{header}
        {r.google_owner === 'carrier'
          ? <p><b>Your carrier runs your listing, so we leave it alone.</b> If you have its link, paste it below and we point your website and posts to it.</p>
          : <p><b>We’ll check who runs your listing with you on a short call.</b> Ask Helix to book it, or reply to any Genovus email.</p>}
        <LinkBox slug={slug} c={c} run={run} pending={pending} />
        <div className="row" style={{ gap: 8 }}>
          {r.google_owner === 'unsure' ? <a className="btn small primary" href={`/app/${slug}/helix`}>Ask Helix to book a call</a> : null}
          <button type="button" className="btn small ghost" disabled={pending} onClick={() => run(socialChoose(slug, 'google', null, 'me'))}>Change my answer</button>
        </div>
      </div>
    );
  }
  // Everyone else: "Do you already have it?"
  if (!r.path || r.path === 'skip') {
    return (
      <div className="panel social-flow">{header}
        <h3>Do you already have a {c.name}?</h3>
        <div className="social-choices">
          <Choice title="Yes, I have one" text="Paste the link, give us access, connect it to Metricool. About 5 minutes." onClick={() => run(socialChoose(slug, c.id, 'have'))} disabled={pending} />
          {c.canCreate
            ? <Choice title="No, set it up with Genovus" text="We walk you through it step by step, with wording ready to approve." onClick={() => run(socialChoose(slug, c.id, 'create'))} disabled={pending} />
            : <Choice title="No, help me set it up" text="We build it with you on a short call." href={`/app/${slug}/helix`} />}
          <Choice title="Not now" text="Skip it. Come back any time." onClick={() => run(socialChoose(slug, c.id, 'skip'))} disabled={pending} />
        </div>
        {r.path === 'skip' ? <p className="muted" style={{ fontSize: 13 }}>You skipped this one. Pick an option above to start.</p> : null}
      </div>
    );
  }
  const copyOk = !!r.copy_ok_at || !c.createSteps.some((s) => s.kind === 'copy');
  return (
    <div className="panel social-flow">{header}
      <ol className="social-stepper">
        {steps.map((s, n) => (
          <li key={s.id} className={(n === i ? 'on ' : '') + (stepDone(c, s) ? 'done' : '')}>
            <button type="button" onClick={() => setI(n)}><span className="dot">{stepDone(c, s) ? '✓' : n + 1}</span><span>{s.title}</span></button>
          </li>
        ))}
      </ol>
      <div className="social-step">
        <h3>{step.title}</h3>
        {step.why ? <p className="soft">{step.why}</p> : null}
        {step.how.length ? <ol className="social-how">{step.how.map((h, n) => <li key={n}>{h}</li>)}</ol> : null}
        {step.facts?.length ? <Facts facts={step.facts} /> : null}
        {step.link ? <p><a href={step.link.url} target="_blank" rel="noreferrer">{step.link.label} ↗</a></p> : null}
        {step.kind === 'copy' ? <CopyBox slug={slug} c={c} step={step} staff={staff} run={run} pending={pending} /> : null}
        {step.kind === 'link' ? <LinkBox slug={slug} c={c} run={run} pending={pending} /> : null}
        {step.kind === 'access' ? (
          <Sent label={r.access === 'granted' ? 'Genovus confirmed access ✓' : r.access === 'sent' ? 'Sent. Genovus is confirming it.' : 'I’ve done this'} disabled={pending || r.access !== 'none'} onClick={() => run(socialSent(slug, c.id, 'access'))} />
        ) : null}
        {step.kind === 'metricool' ? (
          <div className="social-mc">
            {data.connectUrl ? <a className="btn small primary" href={data.connectUrl} target="_blank" rel="noreferrer">Open your Metricool connection link ↗</a>
              : <p className="notice">Your Metricool connection link is on its way. Genovus sets up your brand and adds the link here; we’ll let you know.</p>}
            <Sent label={r.metricool === 'connected' ? 'Connected in Metricool ✓' : r.metricool === 'sent' ? 'Thanks. Genovus is checking your brand.' : r.metricool === 'na' ? 'Not needed' : 'I’ve connected it'} disabled={pending || r.metricool !== 'none' || !data.connectUrl} onClick={() => run(socialSent(slug, c.id, 'metricool'))} />
          </div>
        ) : null}
        {step.kind === 'guide' ? (
          PUBLIC.has(step.id) && !copyOk ? <p className="notice">Approve your profile wording first (step 1). Nothing public is created before you do.</p>
            : <label className="social-tick"><input type="checkbox" checked={r.steps.includes(step.id)} disabled={pending} onChange={(e) => run(socialStep(slug, c.id, step.id, e.target.checked))} /> Done</label>
        ) : null}
        <div className="row social-nav">
          <button type="button" className="btn small" disabled={i === 0} onClick={() => setI(i - 1)}>Back</button>
          {i < steps.length - 1 ? <button type="button" className="btn small primary" onClick={() => setI(i + 1)}>Next</button>
            : <button type="button" className="btn small primary" onClick={close}>Finish</button>}
          <a className="btn small ghost" href={`/app/${slug}/helix`}>Do this with us on a call</a>
          <button type="button" className="btn small ghost" disabled={pending} onClick={() => run(socialChoose(slug, c.id, null))}>Start over</button>
        </div>
      </div>
      {staff ? <StaffConfirm slug={slug} c={c} run={run} pending={pending} /> : null}
    </div>
  );
}

function Choice({ title, text, onClick, href, disabled }: { title: string; text: string; onClick?: () => void; href?: string; disabled?: boolean }) {
  const body = <><b>{title}</b><span className="soft">{text}</span></>;
  return href ? <a className="social-choice" href={href}>{body}</a> : <button type="button" className="social-choice" onClick={onClick} disabled={disabled}>{body}</button>;
}
function Sent({ label, onClick, disabled }: { label: string; onClick: () => void; disabled: boolean }) {
  return <button type="button" className="btn small primary" disabled={disabled} onClick={onClick}>{label}</button>;
}
function Facts({ facts }: { facts: [string, string][] }) {
  return (
    <div className="social-facts">
      {facts.map(([k, v]) => <div key={k}><span className="muted">{k}</span><span>{v}</span><button type="button" className="btn small ghost" onClick={() => navigator.clipboard?.writeText(v)}>Copy</button></div>)}
    </div>
  );
}
function LinkBox({ slug, c, run, pending }: { slug: string; c: WizChannel; run: Run; pending: boolean }) {
  const [v, setV] = useState(c.row.link ?? '');
  return (
    <form className="social-link" onSubmit={(e) => { e.preventDefault(); run(socialLink(slug, c.id, v)); }}>
      <label><span className="muted">{c.linkLabel}</span><input value={v} onChange={(e) => setV(e.target.value)} placeholder={c.linkPlaceholder} inputMode="url" /></label>
      <button className="btn small primary" disabled={pending || !v.trim()}>{c.row.link ? 'Update link' : 'Save link'}</button>
      {c.row.link ? <a href={c.row.link} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>Open it ↗</a> : null}
    </form>
  );
}
function CopyBox({ slug, c, step, staff, run, pending }: { slug: string; c: WizChannel; step: WizStep; staff: boolean; run: Run; pending: boolean }) {
  const [vals, setVals] = useState<Record<string, string>>(Object.fromEntries((step.copy ?? []).map((f) => [f.key, f.value])));
  return (
    <div className="social-copy">
      {(step.copy ?? []).map((f) => {
        const n = (vals[f.key] ?? '').length;
        return (
          <label key={f.key}>
            <span className="spread"><span className="muted">{f.label}</span>{f.limit ? <span className={n > f.limit ? 'bad' : 'muted'} style={{ fontSize: 12 }}>{n} / {f.limit}</span> : null}</span>
            {f.key === 'category' || f.key === 'igName' ? <input value={vals[f.key] ?? ''} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} />
              : <textarea rows={f.key === 'gDescription' ? 5 : 3} value={vals[f.key] ?? ''} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} />}
            {f.note ? <span className="muted" style={{ fontSize: 12 }}>{f.note}</span> : null}
          </label>
        );
      })}
      {c.row.copy_ok_at ? <p className="soft" style={{ fontSize: 13 }}>Approved by {c.row.copy_ok_by}. Editing it asks for approval again.</p> : null}
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn small" disabled={pending} onClick={() => run(socialCopy(slug, c.id, vals, false))}>Save</button>
        {!staff ? <button type="button" className="btn small primary" disabled={pending} onClick={() => run(socialCopy(slug, c.id, vals, true))}>Approve this wording</button> : <span className="muted" style={{ fontSize: 13 }}>The agency approves its own wording.</span>}
      </div>
    </div>
  );
}
function StaffConfirm({ slug, c, run, pending }: { slug: string; c: WizChannel; run: Run; pending: boolean }) {
  const r = c.row;
  return (
    <div className="social-staff">
      <b>Genovus side</b>
      <label>Access <select value={r.access} disabled={pending} onChange={(e) => run(socialConfirm(slug, c.id, 'access', e.target.value))}>
        <option value="none">Not sent</option><option value="sent">Sent by agency</option><option value="granted">Granted (we see it)</option>
      </select></label>
      {c.metricool ? <label>Metricool <select value={r.metricool} disabled={pending} onChange={(e) => run(socialConfirm(slug, c.id, 'metricool', e.target.value))}>
        <option value="none">Not connected</option><option value="sent">Agency says connected</option><option value="connected">Connected (in the brand)</option><option value="na">Not needed</option>
      </select></label> : null}
    </div>
  );
}
function StaffLink({ slug, url, run, pending }: { slug: string; url: string | null; run: Run; pending: boolean }) {
  const [v, setV] = useState(url ?? '');
  return (
    <form className="social-staff" onSubmit={(e) => { e.preventDefault(); run(socialConnectUrl(slug, v)); }}>
      <b>Genovus side</b>
      <label style={{ flex: 1 }}>Metricool connection link for this agency’s brand <input value={v} onChange={(e) => setV(e.target.value)} placeholder="https://app.metricool.com/…" /></label>
      <button className="btn small" disabled={pending}>Save</button>
    </form>
  );
}
