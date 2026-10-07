// The two website intake forms (agency, carrier/network). Plain HTML forms posting to a server action,
// so they work without JavaScript. The hidden "website" field and start time catch bots.
import { submitInquiry } from '@/lib/intake';
import { CONSENT_TEXT } from '@/data/consent';
import { PLANS } from '@/data/offers';

type Field = { name: string; label: string; type?: 'text' | 'email' | 'tel' | 'textarea' | 'select'; required?: boolean; options?: [string, string][]; placeholder?: string; auto?: string };

const AGENCY: Field[] = [
  { name: 'name', label: 'Your name', required: true, auto: 'name' },
  { name: 'org', label: 'Agency name', required: true, auto: 'organization' },
  { name: 'email', label: 'Work email', type: 'email', required: true, auto: 'email' },
  { name: 'phone', label: 'Phone (optional)', type: 'tel', auto: 'tel' },
  { name: 'carrier', label: 'Carrier or carriers you write for', placeholder: 'e.g. GEICO Exclusive Agency, or independent' },
  { name: 'states', label: 'Licensed states', placeholder: 'e.g. GA, AL' },
  { name: 'presence', label: 'What you have today', type: 'select', options: [['', 'Choose one'], ['nothing', 'No website or social yet'], ['social', 'Social profiles only'], ['site', 'A website and some social'], ['carrier-page', 'Only my carrier’s agent page'], ['unsure', 'Not sure']] },
  { name: 'plan', label: 'Plan you’re considering', type: 'select', options: [['', 'Not sure yet'], ...PLANS.slice(0, 3).map((p) => [p.id, p.name] as [string, string])] },
  { name: 'goals', label: 'What should your marketing do for you?', type: 'textarea', placeholder: 'More quote requests, a better first impression, Spanish-speaking customers…' },
];

const CARRIER: Field[] = [
  { name: 'name', label: 'Your name', required: true, auto: 'name' },
  { name: 'org', label: 'Organization', required: true, auto: 'organization' },
  { name: 'role', label: 'Your role', auto: 'organization-title' },
  { name: 'email', label: 'Work email', type: 'email', required: true, auto: 'email' },
  { name: 'phone', label: 'Phone (optional)', type: 'tel', auto: 'tel' },
  { name: 'type', label: 'You are', type: 'select', options: [['carrier', 'A carrier'], ['network', 'An agency network or group'], ['other', 'Something else']] },
  { name: 'agencies', label: 'How many agencies or offices?', placeholder: 'e.g. 12, or about 300' },
  { name: 'regions', label: 'Regions', placeholder: 'e.g. Georgia, Alabama, South Carolina' },
  { name: 'goals', label: 'What would a successful pilot show?', type: 'textarea', placeholder: 'Faster agency launches, consistent approved wording, visibility across offices…' },
];

export function IntakeForm({ kind, defaults }: { kind: 'agency' | 'carrier'; defaults?: Record<string, string> }) {
  const fields = kind === 'agency' ? AGENCY : CARRIER;
  return (
    <form action={submitInquiry} className="form-card">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="t" value={Date.now()} />
      <label className="hp" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
      <div className="form-grid">
        {fields.map((f) => (
          <label key={f.name} className="field" style={f.type === 'textarea' ? { gridColumn: '1 / -1' } : undefined}>
            <span>{f.label}{f.required ? ' *' : ''}</span>
            {f.type === 'textarea' ? (
              <textarea className="textarea" name={f.name} maxLength={2000} placeholder={f.placeholder} />
            ) : f.type === 'select' ? (
              <select className="select" name={f.name} defaultValue={defaults?.[f.name] ?? f.options?.[0][0]}>
                {f.options!.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            ) : (
              <input className="input" name={f.name} type={f.type ?? 'text'} required={f.required} maxLength={f.name === 'email' ? 200 : 160} placeholder={f.placeholder} autoComplete={f.auto} />
            )}
          </label>
        ))}
      </div>
      <label className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap', gap: 10, fontSize: 14, color: 'var(--soft)' }}>
        <input type="checkbox" name="consent" value="yes" required style={{ marginTop: 4 }} />
        <span>{CONSENT_TEXT} See our <a href="/privacy" target="_blank">privacy policy</a>.</span>
      </label>
      <button className="btn primary" type="submit" style={{ justifySelf: 'start' }}>{kind === 'agency' ? 'Request my consult' : 'Start the pilot conversation'}</button>
    </form>
  );
}
