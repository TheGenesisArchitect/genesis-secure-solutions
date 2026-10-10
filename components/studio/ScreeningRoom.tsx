'use client';
// The Screening Room: plays an episode's auto rough cut in the browser from its edit decision list. Two video
// elements alternate so cuts land without a reload gap; captions, Maya's voice-over clips and cards (the Helix
// concept, the end card, placeholders for shots not rendered yet) play on the same clock. Click any shot on the
// timeline to jump to it.
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Wordmark } from '@/components/Wordmark';
import type { Cut, CutItem } from '@/lib/studio-cut';

const STATUS_LABEL: Record<CutItem['status'], string> = { picked: 'Picked take', best: 'Court’s best (not picked)', draft: 'Draft take', missing: 'Not rendered yet', card: 'Card' };
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function ScreeningRoom({ cut, episodeHref }: { cut: Cut; episodeHref: string }) {
  const [idx, setIdx] = useState(0);
  const [t, setT] = useState(0); // seconds into the current item
  const [playing, setPlaying] = useState(false);
  const vids = [useRef<HTMLVideoElement>(null), useRef<HTMLVideoElement>(null)];
  const active = useRef(0); // which video element is on screen
  const cardClock = useRef<{ startedAt: number; offset: number } | null>(null);
  const voiceTimers = useRef<number[]>([]);
  const voices = useRef<HTMLAudioElement[]>([]);
  const item = cut.items[idx];

  const stopVoices = () => { voiceTimers.current.forEach(clearTimeout); voiceTimers.current = []; voices.current.forEach((a) => a.pause()); voices.current = []; };
  const scheduleVoices = (it: CutItem, from: number) => {
    stopVoices();
    for (const v of it.voice) {
      if (v.at + 0.05 < from) continue;
      voiceTimers.current.push(window.setTimeout(() => { const a = new Audio(v.src); voices.current.push(a); void a.play().catch(() => {}); }, (v.at - from) * 1000));
    }
  };

  /** Put item j on screen at offset `from` (seconds into the item). */
  const load = useCallback((j: number, from: number, play: boolean) => {
    const it = cut.items[j];
    if (!it) return;
    setIdx(j); setT(from);
    if (it.kind === 'video' && it.src) {
      // Prefer the hidden element if it already holds this source (preloaded), then swap.
      const other = 1 - active.current;
      const pre = vids[other].current;
      if (pre && pre.dataset.src === it.src) active.current = other;
      const v = vids[active.current].current!;
      if (v.dataset.src !== it.src) { v.src = it.src; v.dataset.src = it.src; }
      v.currentTime = it.in + from;
      if (play) void v.play().catch(() => {});
      vids[1 - active.current].current?.pause();
      cardClock.current = null;
    } else {
      vids.forEach((r) => r.current?.pause());
      cardClock.current = { startedAt: performance.now(), offset: from };
    }
    if (play) scheduleVoices(it, from); else stopVoices();
    // Preload the next video item into the hidden element.
    const next = cut.items.slice(j + 1).find((x) => x.kind === 'video' && x.src);
    const hidden = vids[1 - active.current].current;
    if (next && hidden && hidden.dataset.src !== next.src) { hidden.src = next.src!; hidden.dataset.src = next.src!; hidden.currentTime = next.in; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cut]);

  // The clock: video items follow their element's currentTime; cards follow the wall clock.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const it = cut.items[idx];
      if (!it) return;
      let now = t;
      if (it.kind === 'video' && it.src) now = (vids[active.current].current?.currentTime ?? it.in) - it.in;
      else if (cardClock.current) now = cardClock.current.offset + (performance.now() - cardClock.current.startedAt) / 1000;
      if (now >= it.dur) {
        if (idx + 1 < cut.items.length) load(idx + 1, 0, true);
        else { setPlaying(false); stopVoices(); vids.forEach((r) => r.current?.pause()); }
        return;
      }
      setT(now);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, idx, cut, load]);

  useEffect(() => { load(0, 0, false); return stopVoices; }, [load]);

  const toggle = () => {
    if (playing) { setPlaying(false); vids.forEach((r) => r.current?.pause()); stopVoices(); if (cardClock.current) cardClock.current = { startedAt: performance.now(), offset: t }; return; }
    setPlaying(true);
    load(idx, t >= (item?.dur ?? 0) ? 0 : t, true);
  };
  const jump = (j: number) => { load(j, 0, playing); };
  const caption = item?.captions.find((c) => t >= c.t0 && t < c.t1);
  const elapsed = (item?.start ?? 0) + Math.min(t, item?.dur ?? 0);

  return (
    <div className={'screen ' + cut.format}>
      <div className="screen-stage">
        <div className="screen-frame">
          {vids.map((r, i) => <video key={i} ref={r} playsInline muted={false} preload="auto" className={item?.kind === 'video' && active.current === i ? 'on' : ''} />)}
          {item?.kind === 'card' && item.card ? (
            <div className={'screen-card ' + item.card.style}>
              {item.card.style === 'end' ? (
                <div className="grid" style={{ gap: 14, justifyItems: 'center' }}>
                  <Wordmark size={cut.format === 'vertical' ? 44 : 64} />
                  <b>{item.card.body}</b>
                  <small>Made with AI by Genovus Studio · fictional agency</small>
                </div>
              ) : item.card.style === 'helix' ? (
                <div className="screen-helix">
                  <span className="chip pending">In development</span>
                  <b>{item.card.title}</b>
                  <p>{item.card.body}</p>
                  <span className="btn small primary">Send</span>
                </div>
              ) : (
                <div className="grid" style={{ gap: 8, justifyItems: 'center', textAlign: 'center' }}>
                  <span className="chip">{item.status === 'missing' ? 'Not rendered yet' : 'Card'}</span>
                  <b>{item.card.title}</b>
                  {item.card.body ? <p>{item.card.body}</p> : null}
                </div>
              )}
            </div>
          ) : null}
          {caption ? <div className="screen-caption"><b>{caption.who}</b> {caption.text}</div> : null}
          <span className="screen-tag">{item?.label} · {STATUS_LABEL[item?.status ?? 'card']}{item?.score != null ? ` · Court ${item.score}` : ''}</span>
        </div>
      </div>
      <div className="screen-controls">
        <button className="btn primary" type="button" onClick={toggle}>{playing ? 'Pause' : t > 0 || idx > 0 ? 'Play' : 'Play the rough cut'}</button>
        <span className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(elapsed)} / {fmt(cut.total)}</span>
        <span className="muted">{cut.counts.picked} picked · {cut.counts.drafts} drafts · {cut.counts.missing} not rendered · {cut.counts.cards} cards</span>
        <Link className="btn small ghost" href={episodeHref}>Back to the episode</Link>
      </div>
      <ol className="screen-timeline" aria-label="Shots">
        {cut.items.map((it, j) => (
          <li key={it.shotId} style={{ flexGrow: it.dur }}>
            <button type="button" className={'seg ' + it.status + (j === idx ? ' on' : '')} onClick={() => jump(j)} title={`${it.label} · ${STATUS_LABEL[it.status]} · ${it.dur.toFixed(1)}s`}>
              <span>{it.label}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
