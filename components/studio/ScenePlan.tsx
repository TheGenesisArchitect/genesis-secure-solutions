'use client';
// The scene plan panel (lib/unedit-scenes.ts), on a newsroom package (before recording) and on a recording's card
// (after). Helix reads the article and proposes scenes; every number was checked against the article's own words
// before it got here. A person picks the scenes; the picked ones become scene lines on the sources sheet.
import { useEffect, useState } from 'react';
import { SCENES, parseFact, type ScenePlan as Plan } from '@/lib/unedit-scene-kit';

const fmtFact = (s: string) => {
  const f = parseFact(s);
  if (!f) return { label: s, value: '' };
  const n = (x: NonNullable<typeof f.b>) => `${x.prefix}${x.text}${x.suffix}`;
  return { label: f.label, value: f.b ? `${n(f.a)} → ${n(f.b)}` : n(f.a) };
};

export function ScenePlan({ plan, defaultUrl, disabled, busy, before, onDraft, onApprove }: {
  plan: Plan | null; defaultUrl?: string; disabled: boolean; busy: 'draft' | 'approve' | null;
  /** Before recording: spoken words come from the script. After: from the recording. */ before: boolean;
  onDraft: (a: { url?: string; text?: string }) => void; onApprove: (keep: number[]) => void;
}) {
  const [url, setUrl] = useState(defaultUrl ?? '');
  const [text, setText] = useState('');
  const [keep, setKeep] = useState<number[]>([]);
  const [redraft, setRedraft] = useState(false);
  const stamp = plan?.drafted_at ?? '';
  useEffect(() => {
    if (!plan) return;
    setKeep(plan.approved?.keep ?? plan.scenes.map((s, i) => (s.placeable ? i : -1)).filter((i) => i >= 0));
    setRedraft(false);
  }, [stamp]); // eslint-disable-line react-hooks/exhaustive-deps
  const left = plan?.notes.filter((n) => n.startsWith('left out')) ?? [];
  const flags = plan?.notes.filter((n) => !n.startsWith('left out')) ?? [];
  const form = (
    <div className="sp-form">
      <label className="eyebrow" htmlFor="sp-url">Article link</label>
      <input id="sp-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" disabled={disabled} />
      <details>
        <summary className="muted sp-small">Site won’t let servers read it? Paste the article text</summary>
        <label className="sr-only" htmlFor="sp-text">Article text</label>
        <textarea id="sp-text" rows={6} value={text} onChange={(e) => setText(e.target.value)} disabled={disabled} placeholder="Paste the full article text here" />
      </details>
      <div className="sp-row">
        <button type="button" className="btn small primary" disabled={disabled || busy !== null || (!url.trim() && text.trim().length < 400)} onClick={() => onDraft({ url: url.trim() || undefined, text: text.trim() || undefined })}>
          {busy === 'draft' ? 'Helix is reading the article…' : plan ? 'Draft again' : 'Draft the scene plan'}
        </button>
        <span className="muted sp-small">About $0.10. Helix proposes; nothing goes on screen until you add it.</span>
      </div>
    </div>
  );
  return (
    <details className="sp" open>
      <summary className="eyebrow">Scene plan · {plan ? `${plan.scenes.length} proposed${plan.approved ? `, ${plan.approved.keep.length} on the sheet` : ''}` : 'from the article'}</summary>
      <p className="muted sp-small">Purpose-built scenes that show what the article demonstrates: a CAD build, a lab result, a 3D assembly, a benchmark duel, a model card. Every number is checked against the article’s own words, with its source on screen.</p>
      {!plan || redraft ? form : (
        <>
          <p className="sp-small">From <a href={plan.article.url.startsWith('http') ? plan.article.url : undefined} target="_blank" rel="noreferrer">{plan.article.title || plan.article.url}</a> · <button type="button" className="linkish" onClick={() => setRedraft(true)} disabled={disabled}>draft again</button></p>
          <ol className="sp-list">
            {plan.scenes.map((s, i) => {
              const def = SCENES[s.type], on = keep.includes(i);
              return (
                <li key={i} className={`sp-scene${on ? ' on' : ''}`}>
                  <label className="sp-pick">
                    <input type="checkbox" checked={on} disabled={disabled} onChange={() => setKeep((k) => (on ? k.filter((x) => x !== i) : [...k, i]))} />
                    <span className="sp-type">{def?.label ?? s.type}</span>
                  </label>
                  <strong className="sp-title">{s.title}</strong>
                  <ul className="sp-facts">{s.facts.map((f, j) => { const x = fmtFact(f); return <li key={j}><span>{x.label}</span><b>{x.value}</b></li>; })}</ul>
                  <p className="sp-small"><span className="muted">Source on screen:</span> {s.source}{s.why ? <> · <span className="muted">shows</span> {s.why}</> : null}</p>
                  <p className="sp-small">{s.placeable ? <><span className="muted">Appears on:</span> “{s.say}”</> : <span className="sp-warn">Spoken words not found in the {before ? 'script' : 'recording'}{s.say ? ` (“${s.say}”)` : ''}. Add it, then fix its words on the sheet.</span>}</p>
                  <details><summary className="muted sp-small">The article’s words</summary><blockquote className="sp-quote">{s.passage}</blockquote></details>
                </li>
              );
            })}
          </ol>
          {left.length ? <details><summary className="muted sp-small">{left.length} didn’t pass the checks</summary><ul className="sp-small">{left.map((n, i) => <li key={i}>{n.replace(/^left out: /, '')}</li>)}</ul></details> : null}
          {flags.length ? <p className="muted sp-small">{flags.length} {flags.length === 1 ? 'scene needs' : 'scenes need'} spoken words before {flags.length === 1 ? 'it' : 'they'} can be placed.</p> : null}
          <div className="sp-row">
            <button type="button" className="btn small primary" disabled={disabled || busy !== null || !keep.length} onClick={() => onApprove(keep.slice().sort((a, b) => a - b))}>
              {busy === 'approve' ? 'Adding…' : `Add ${keep.length} ${keep.length === 1 ? 'scene' : 'scenes'} to the sheet`}
            </button>
            {plan.approved ? <span className="muted sp-small">Last added {new Date(plan.approved.at).toLocaleString()}</span> : null}
          </div>
          <p className="muted sp-small">Scenes are planned and placed now; drawing them into the episode is the next release.</p>
        </>
      )}
      <style>{`
        .sp-small { font-size: 13px; }
        .sp-form { display: grid; gap: 8px; margin-top: 8px; }
        .sp-form input, .sp-form textarea { width: 100%; font: inherit; }
        .sp-row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 8px; }
        .sp-list { list-style: none; padding: 0; margin: 10px 0; display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
        .sp-scene { border: 1px solid var(--line, rgba(127,127,127,.25)); border-radius: 12px; padding: 12px; display: grid; gap: 6px; opacity: .7; }
        .sp-scene.on { opacity: 1; border-color: var(--accent, #e8590c); }
        .sp-pick { display: flex; align-items: center; gap: 8px; cursor: pointer; }
        .sp-type { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--accent, #e8590c); font-weight: 600; }
        .sp-title { font-size: 15px; line-height: 1.3; }
        .sp-facts { list-style: none; padding: 0; margin: 0; display: grid; gap: 2px; font-size: 13px; }
        .sp-facts li { display: flex; justify-content: space-between; gap: 8px; }
        .sp-facts b { font-variant-numeric: tabular-nums; white-space: nowrap; }
        .sp-warn { color: var(--warn, #b45309); }
        .sp-quote { margin: 6px 0 0; padding-left: 10px; border-left: 2px solid var(--line, rgba(127,127,127,.35)); font-size: 13px; }
        .linkish { background: none; border: 0; padding: 0; color: inherit; text-decoration: underline; cursor: pointer; font: inherit; }
      `}</style>
    </details>
  );
}
