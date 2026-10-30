'use client';
// The welcome page's moving parts (app/app/[slug]/welcome): one form per section of the setup checklist (each saves
// on its own, and Helix sees, fills and saves each one like any dashboard form), the kickoff card (confirm, or pick
// another open team time), and the Ask Helix banner that opens Helix with a starter question.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { helixAsk } from './HelixDrawer';

export type WelcomeItem = { key: string; label: string; help: string; kind: string; required: boolean; options?: [string, string][]; done: boolean };

export function WelcomeSection({ slug, title, sub, items, values, open }: { slug: string; title: string; sub: string; items: WelcomeItem[]; values: Record<string, string>; open: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [domainChoice, setDomainChoice] = useState(values.domainChoice ?? '');
  const done = items.filter((i) => i.done).length;
  return (
    <details className="wl-sec" open={open}>
      <summary><span className={'wl-dot' + (done === items.length ? ' done' : '')}>{done === items.length ? '✓' : ''}</span><b>{title}</b><span className="wl-count">{done} of {items.length}</span></summary>
      <form className="wl-form" data-helix-form={`welcome: ${title}`} data-helix-lane="internal" aria-label={title} onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setMsg(null);
        const f = new FormData(e.currentTarget);
        f.set('slug', slug);
        const r = await fetch('/api/welcome/save', { method: 'POST', body: f }).then((x) => x.json()).catch(() => ({ ok: false, error: 'We couldn’t reach Genovus. Check your connection and try again.' }));
        setBusy(false);
        if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
        setMsg({ ok: true, text: 'Saved.' });
        router.refresh();
      }}>
        <p className="muted wl-sub">{sub}</p>
        {items.filter((i) => i.key !== 'domain' || domainChoice === 'have' || domainChoice === 'register').map((i) => (
          <div key={i.key} className={'wl-item' + (i.done ? ' done' : '')}>
            <label className="wl-label" htmlFor={`wl-${i.key}`}>{i.label}{i.required ? null : <span className="wl-opt"> optional</span>}{i.done ? <span className="wl-ok"> ✓</span> : null}</label>
            <p className="wl-help">{i.help}</p>
            {i.kind === 'textarea' ? <textarea id={`wl-${i.key}`} className="textarea" name={i.key} defaultValue={values[i.key] ?? ''} rows={3} />
              : i.kind === 'choice' ? (
                <select id={`wl-${i.key}`} className="input" name={i.key} defaultValue={values[i.key] ?? ''} onChange={(e) => i.key === 'domainChoice' && setDomainChoice(e.target.value)}>
                  <option value="">Choose…</option>
                  {(i.options ?? []).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              ) : i.kind === 'lines' ? (
                <div className="wl-chips" id={`wl-${i.key}`}>
                  <input type="hidden" name={`${i.key}__shown`} value="1" />
                  {(i.options ?? []).map(([v, l]) => <label key={v} className="check"><input type="checkbox" name={i.key} value={v} defaultChecked={(values[i.key] ?? '').split(/,\s*/).includes(v)} /> {l}</label>)}
                </div>
              ) : i.kind === 'photo' ? (
                <>
                  {values[i.key] ? <p className="wl-help">Saved. Upload a new one to replace it.</p> : null}
                  <input id={`wl-${i.key}`} className="input" type="file" name={i.key} accept="image/jpeg,image/png,image/webp" />
                  {i.key === 'headshot' ? <label className="check wl-help"><input type="checkbox" name="rights" value="yes" /> I took this photo or have permission to use it on my website and social pages.</label> : null}
                </>
              ) : <input id={`wl-${i.key}`} className="input" name={i.key} type="text" inputMode={i.kind === 'url' ? 'url' : undefined} defaultValue={values[i.key] ?? ''} placeholder={i.kind === 'states' ? 'GA, AL' : i.kind === 'url' ? 'https://' : ''} />}
            {i.kind !== 'photo' ? <button type="button" className="wl-ask" onClick={() => helixAsk({ question: `Help me with “${i.label}” on my welcome form.`, context: `Welcome form, section “${title}”. Field: ${i.label}. ${i.help}` })}>✦ Ask Helix</button> : null}
          </div>
        ))}
        <div className="row" style={{ gap: 10 }}>
          <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save this section'}</button>
          {msg ? <span role="status" className={msg.ok ? 'wl-saved' : 'wl-err'}>{msg.text}</span> : null}
        </div>
      </form>
    </details>
  );
}

export function KickoffCard({ slug, when, minutes, confirmed, location }: { slug: string; when: string; minutes: number; confirmed: boolean; location: string | null }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'busy' | 'pick'>('idle');
  const [slots, setSlots] = useState<{ iso: string; label: string }[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const post = async (body: object) => {
    setState('busy'); setMsg(null);
    const r = await fetch('/api/kickoff', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug, ...body }) }).then((x) => x.json()).catch(() => ({ error: 'We couldn’t reach Genovus. Try again.' }));
    setState('idle');
    if (r.error) { setMsg({ ok: false, text: r.error }); if (slots) setState('pick'); return; }
    setMsg({ ok: true, text: r.message }); setSlots(null); router.refresh();
  };
  const pick = async () => {
    setState('pick'); setMsg(null);
    if (!slots) { const r = await fetch(`/api/kickoff?slug=${encodeURIComponent(slug)}`).then((x) => x.json()).catch(() => ({ slots: [] })); setSlots(r.slots ?? []); }
  };
  const link = location && /^https?:\/\//.test(location) ? location : null;
  return (
    <div className="wl-kick" data-kickoff={confirmed ? 'confirmed' : 'tentative'}>
      <p className="eyebrow">Your kickoff call {confirmed ? <span className="chip done">Confirmed</span> : <span className="chip pending">Please confirm</span>}</p>
      <h3>{when}</h3>
      <p className="soft" style={{ fontSize: 14 }}>{minutes} minutes on video (Eastern time). We answer your questions, close what’s left on your form, go over creative and your carrier-approved promos, and walk you through your dashboard.</p>
      {link ? <a className="btn small" href={link} target="_blank" rel="noreferrer">Join link ↗</a> : null}
      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        {!confirmed ? <button className="btn primary small" type="button" disabled={state === 'busy'} onClick={() => post({ action: 'confirm' })}>Confirm this time</button> : null}
        <button className="btn small" type="button" disabled={state === 'busy'} onClick={pick}>Pick another time</button>
      </div>
      {state === 'pick' ? (
        slots === null ? <p className="muted" style={{ fontSize: 13 }}>Finding open times…</p>
          : slots.length ? <div className="wl-slots">{slots.map((s) => <button key={s.iso} type="button" className="btn small" onClick={() => post({ action: 'move', start: s.iso })}>{s.label}</button>)}</div>
            : <p className="muted" style={{ fontSize: 13 }}>No open times this week. Ask Helix or reply to our email and we’ll find one.</p>
      ) : null}
      {msg ? <p role="status" className={msg.ok ? 'wl-saved' : 'wl-err'}>{msg.text}</p> : null}
    </div>
  );
}

export function HelixWelcome({ first }: { first: string }) {
  const ask = (question: string) => helixAsk({ question, context: 'The client is on their welcome page: their package, the welcome form (by section), their kickoff call and their site preview.' });
  return (
    <div className="wl-helix" data-helix-skip>
      <div className="wl-orb" aria-hidden="true" />
      <div style={{ minWidth: 0, flex: 1 }}>
        <b>{first ? `${first}, meet Helix` : 'Meet Helix'}: the best part of your dashboard.</b>
        <p>Helix knows your plan and can see this page. Ask anything, or say “help me fill in my office details” and Helix fills the form with you. Talk or type; press the egg button any time.</p>
        <div className="row" style={{ gap: 6, marginTop: 8 }}>
          <button className="btn small primary" type="button" onClick={() => ask('Help me fill in what’s missing on my welcome form, one section at a time.')}>Help me fill my form</button>
          <button className="btn small" type="button" onClick={() => ask('What’s included in my plan, and what happens next?')}>What’s in my plan?</button>
          <button className="btn small" type="button" onClick={() => ask('What happens on my kickoff call, and how should I prepare?')}>Prep me for the kickoff</button>
        </div>
      </div>
    </div>
  );
}
