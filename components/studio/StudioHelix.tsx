'use client';
// Ask Helix in a Studio suite: the golden-egg button in the page header opens Ask Helix (the same panel as the button at
// the bottom right): Helix starts listening, with the Studio voice that knows the bible and what's on screen.
import { helixAsk } from '@/components/HelixDrawer';

export function StudioHelix({ focus }: { focus: { kind: 'home' | 'bible' | 'cast' | 'episode' | 'character'; code?: string; label?: string } }) {
  return (
    <button type="button" className="ask-egg-pill" onClick={() => helixAsk({ context: `the Studio: ${focus.label ?? 'the Studio'}` })} aria-label={`Ask Helix about ${focus.label ?? 'the Studio'}`} title={`Ask Helix about ${focus.label ?? 'the Studio'}`}>
      <img src="/brand/genovus/genovus-egg.svg" alt="" aria-hidden="true" />
      <span>Ask Helix</span>
    </button>
  );
}
