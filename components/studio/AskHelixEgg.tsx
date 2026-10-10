'use client';
// The Ask Helix egg: the golden egg as a button that opens Helix Live on the page (Helix listens for the
// genovus:helix-open event).
export function AskHelixEgg({ label = 'Ask Helix', hint }: { label?: string; hint?: string }) {
  return (
    <button type="button" className="ask-egg" onClick={() => window.dispatchEvent(new Event('genovus:helix-open'))} aria-label={`${label}${hint ? `: ${hint}` : ''}`}>
      <span className="ask-egg-shell" aria-hidden="true"><img src="/brand/genovus/genovus-egg.svg" alt="" /><span className="ask-egg-ring" /></span>
      <b>{label}</b>
      {hint ? <small>{hint}</small> : null}
    </button>
  );
}
