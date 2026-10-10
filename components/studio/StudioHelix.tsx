'use client';
// Ask Helix in a Studio suite: a compact golden-egg button for the page header, plus the Helix Live dock with the
// page's focus (the episode, the character…) so Helix knows what is on screen as well as the whole bible.
import { HelixTour } from '@/components/vision/HelixTour';

export function StudioHelix({ focus }: { focus: { kind: 'home' | 'bible' | 'cast' | 'episode' | 'character'; code?: string; label?: string } }) {
  return (
    <>
      <button type="button" className="ask-egg-pill" onClick={() => window.dispatchEvent(new Event('genovus:helix-open'))} aria-label={`Ask Helix about ${focus.label ?? 'the Studio'}`} title={`Ask Helix about ${focus.label ?? 'the Studio'}`}>
        <img src="/brand/genovus/genovus-egg.svg" alt="" aria-hidden="true" />
        <span>Ask Helix</span>
      </button>
      <HelixTour context="studio" floating={false} focus={focus} />
    </>
  );
}
