'use client';
// The client's checklist form: each item with its help, photos with a preview, progress at the top, and one Save
// that keeps what's filled and says what's left. Posts to /api/welcome/<token>/checklist.
import { useMemo, useState } from 'react';

type Item = { key: string; label: string; help: string; kind: 'text' | 'textarea' | 'url' | 'states' | 'choice' | 'photo' | 'lines'; required: boolean; options?: [string, string][]; done: boolean };

export function ChecklistForm({ token, items, values }: { token: string; items: Item[]; values: Record<string, string> }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [done, setDone] = useState<Record<string, boolean>>(Object.fromEntries(items.map((i) => [i.key, i.done])));
  const [domainChoice, setDomainChoice] = useState(values.domainChoice ?? '');
  const required = items.filter((i) => i.required);
  const left = useMemo(() => required.filter((i) => !done[i.key]).length, [required, done]);
  return (
    <form className="ck-form" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setMsg(null);
      const f = new FormData(e.currentTarget);
      const r = await fetch(`/api/welcome/${token}/checklist`, { method: 'POST', body: f }).then((x) => x.json()).catch(() => ({ ok: false, error: 'We couldn’t reach Genovus. Check your connection and try again.' }));
      setBusy(false);
      if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
      setDone(Object.fromEntries(items.map((i) => [i.key, !r.missing.includes(i.label)])));
      setMsg({ ok: true, text: r.done ? 'All set. Thank you! We have everything we need to build your site.' : `Saved. Still to go: ${r.missing.join(', ')}.` });
    }}>
      <div className="ck-progress" aria-live="polite">
        <span>{required.length - left} of {required.length} done</span>
        <span className="ck-bar"><span style={{ width: `${((required.length - left) / Math.max(1, required.length)) * 100}%` }} /></span>
      </div>
      {items.filter((i) => i.key !== 'domain' || domainChoice === 'have' || domainChoice === 'register').map((i) => (
        <div key={i.key} className={'ck-item' + (done[i.key] ? ' done' : '')}>
          <div className="ck-head"><b>{i.label}</b>{i.required ? null : <span className="ck-opt">optional</span>}{done[i.key] ? <span className="ck-ok">✓ saved</span> : null}</div>
          <p className="ck-help">{i.help}</p>
          {i.kind === 'textarea' ? <textarea className="textarea" name={i.key} defaultValue={values[i.key] ?? ''} rows={3} />
            : i.kind === 'choice' ? (
              <div className="ck-choices" role="radiogroup" aria-label={i.label}>
                {(i.options ?? []).map(([v, l]) => <label key={v} className="check"><input type="radio" name={i.key} value={v} defaultChecked={values[i.key] === v} onChange={() => i.key === 'domainChoice' && setDomainChoice(v)} /> {l}</label>)}
              </div>
            ) : i.kind === 'lines' ? (
              <div className="ck-choices" aria-label={i.label}>
                <input type="hidden" name={`${i.key}__shown`} value="1" />
                {(i.options ?? []).map(([v, l]) => <label key={v} className="check"><input type="checkbox" name={i.key} value={v} defaultChecked={(values[i.key] ?? '').split(/,\s*/).includes(v)} /> {l}</label>)}
              </div>
            ) : i.kind === 'photo' ? (
              <>
                <input className="input" type="file" name={i.key} accept="image/jpeg,image/png,image/webp" />
                {i.key === 'headshot' ? <label className="check ck-rights"><input type="checkbox" name="rights" value="yes" /> I took this photo or have permission to use it on my website and social pages.</label> : null}
              </>
            ) : <input className="input" name={i.key} type={i.kind === 'url' ? 'url' : 'text'} defaultValue={values[i.key] ?? ''} placeholder={i.kind === 'states' ? 'GA, AL' : i.kind === 'url' ? 'https://' : ''} />}
        </div>
      ))}
      {msg ? <p className={msg.ok ? 'ck-msg ok' : 'ck-msg err'} role="status">{msg.text}</p> : null}
      <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save my answers'}</button>
    </form>
  );
}
