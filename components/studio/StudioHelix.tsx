'use client';
// Ask Helix in a Studio suite: the golden-egg button in the page header opens the same Ask Helix drawer as the button
// at the bottom right (type, or Talk). Talk on a Studio page starts Helix Live with the page's focus (the episode, the
// character…) so Helix knows what is on screen as well as the whole bible.
import { HelixTour } from '@/components/vision/HelixTour';
import { HELIX_VOICE_EVT, helixAsk } from '@/components/HelixDrawer';

export function StudioHelix({ focus }: { focus: { kind: 'home' | 'bible' | 'cast' | 'episode' | 'character'; code?: string; label?: string } }) {
  return (
    <>
      <button type="button" className="ask-egg-pill" onClick={() => helixAsk({ context: `the Studio: ${focus.label ?? 'the Studio'}` })} aria-label={`Ask Helix about ${focus.label ?? 'the Studio'}`} title={`Ask Helix about ${focus.label ?? 'the Studio'}`}>
        <img src="/brand/genovus/genovus-egg.svg" alt="" aria-hidden="true" />
        <span>Ask Helix</span>
      </button>
      <HelixTour context="studio" floating={false} focus={focus} openEvent={HELIX_VOICE_EVT} />
    </>
  );
}
