'use client';
// The finished short in a phone frame: the episode's frames play in sequence (slow push-in), with burned-in
// captions, the progress bar Shorts/Reels show, the AI disclosure and the tracked end card.
import { useEffect, useState } from 'react';
import { SceneArt, SHOT_SCENES } from './SceneArt';

const CAPTIONS = ['She opened her office on Main Street.', 'Nobody could find it.', 'Across town, a neighbor searched.', 'This time, she showed up.', 'And the phone rang.', 'Be found. Genovus.'];

export function PhoneShort() {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => setI((x) => (x + 1) % SHOT_SCENES.length), 3200);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="phone" aria-label="Preview of the finished short">
      {SHOT_SCENES.map((s, k) => <div key={k} className={'frame' + (k === i ? ' on' : '')}><SceneArt scene={s} label={CAPTIONS[k]} /></div>)}
      <span className="bar">{SHOT_SCENES.map((_, k) => <i key={k + '-' + (k === i ? i : 'x')} className={k < i ? 'done' : k === i ? 'on' : ''} style={{ ['--d' as string]: '3.2s' }}><b /></i>)}</span>
      <span className="ai" style={{ top: 18 }}>AI-generated · disclosed</span>
      <span className="sub">{CAPTIONS[i]}</span>
      <span className="cta">genovus.io · Book 15 minutes</span>
    </div>
  );
}
