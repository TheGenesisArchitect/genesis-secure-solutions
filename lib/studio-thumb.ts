// The Genovus signature frame for Studio thumbnails, as a plain element tree (no JSX) so the route and a local
// render check share one design. Key art fills the frame; the Fib Circle's orange draws an inset border with a
// gradient spine; the mark and wordmark sit top-left; the episode tag, series line and title sit bottom-left in
// Genovus Display; an AI label sits bottom-right.
import { createElement as h, type ReactElement } from 'react';

export type ThumbProps = { art: string; mark: string; title: string; tag: string; series: string; square?: boolean };

const GRAD_V = 'linear-gradient(180deg, #ffa21f 0%, #f4531b 50%, #e2380f 100%)';
const GRAD_H = 'linear-gradient(90deg, #ffa21f 0%, #f4531b 55%, #e2380f 100%)';

export function thumbSize(square?: boolean) { return { width: 1080, height: square ? 1080 : 1920 }; }

export function thumbElement(p: ThumbProps): ReactElement {
  const { width: W, height: H } = thumbSize(p.square);
  const s = p.square ? 0.78 : 1;
  const titleSize = Math.round((p.title.length > 22 ? 104 : p.title.length > 14 ? 124 : 148) * s);
  const abs = (style: Record<string, unknown>, ...kids: unknown[]) => h('div', { style: { position: 'absolute', display: 'flex', ...style } }, ...(kids as ReactElement[]));
  return h('div', { style: { width: W, height: H, display: 'flex', position: 'relative', background: '#0b0907', fontFamily: 'Inter' } },
    h('img', { src: p.art, width: W, height: H, style: { position: 'absolute', left: 0, top: 0, width: W, height: H, objectFit: 'cover' } }),
    abs({ left: 0, right: 0, bottom: 0, height: H * 0.56, background: 'linear-gradient(180deg, rgba(11,9,7,0) 0%, rgba(11,9,7,0.7) 42%, rgba(11,9,7,0.96) 100%)' }),
    abs({ left: 0, right: 0, top: 0, height: 280 * s, background: 'linear-gradient(180deg, rgba(11,9,7,0.75) 0%, rgba(11,9,7,0) 100%)' }),
    abs({ left: 30, right: 30, top: 30, bottom: 30, borderRadius: 44 * s, border: '4px solid rgba(244,83,27,0.9)' }),
    abs({ left: 28, top: 30 + 170 * s, width: 10, height: H - 60 - 340 * s, borderRadius: 999, backgroundImage: GRAD_V }),
    abs({ left: 72, top: 70 * s, alignItems: 'center', gap: 18 },
      h('img', { src: p.mark, width: 80 * s, height: 80 * s }),
      h('span', { style: { fontFamily: 'Genovus Display', fontSize: 40 * s, color: '#fff', letterSpacing: 5 } }, 'GENOVUS')),
    abs({ left: 72, right: 72, bottom: 96 * s, flexDirection: 'column', gap: 22 * s },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 16 } },
        h('span', { style: { display: 'flex', padding: `${10 * s}px ${22 * s}px`, borderRadius: 999, backgroundImage: GRAD_H, color: '#160a03', fontFamily: 'Genovus Display', fontSize: 28 * s, letterSpacing: 3 } }, p.tag),
        h('span', { style: { fontSize: 30 * s, color: '#ffd7a8', letterSpacing: 6 } }, p.series.toUpperCase())),
      h('span', { style: { fontFamily: 'Genovus Display', fontSize: titleSize, lineHeight: 1.02, color: '#fff', textTransform: 'uppercase', textShadow: '0 6px 30px rgba(0,0,0,0.6)' } }, p.title),
      h('div', { style: { display: 'flex', width: 220 * s, height: 10 * s, borderRadius: 999, backgroundImage: GRAD_H } })),
    abs({ right: 72, bottom: 52 * s, fontSize: 22 * s, color: 'rgba(255,255,255,0.72)' }, 'AI-generated'),
  );
}
