'use client';
// The Ask Helix egg: the golden egg as a button that opens the same Ask Helix drawer as every other Ask Helix button
// (type, or Talk for voice).
import { helixAsk } from '@/components/HelixDrawer';
export function AskHelixEgg({ label = 'Ask Helix', hint }: { label?: string; hint?: string }) {
  return (
    <button type="button" className="ask-egg" onClick={() => helixAsk({ context: hint ? `${label}: ${hint}` : label })} aria-label={`${label}${hint ? `: ${hint}` : ''}`}>
      <span className="ask-egg-shell" aria-hidden="true"><img src="/brand/genovus/genovus-egg.svg" alt="" /><span className="ask-egg-ring" /></span>
      <b>{label}</b>
      {hint ? <small>{hint}</small> : null}
    </button>
  );
}
