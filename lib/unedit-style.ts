// The style book, enforced (data/unedit-stylebook.ts). The director writes WHAT goes on screen and WHEN; this file
// decides HOW it looks: the episode's show package picks one style per slot, then every graphic is checked against the
// rules as code: portrait episodes keep the landscape-only styles out, a behind-the-speaker style needs the cut-out,
// a front style may not cover the speaker's face, and nothing crowds anything else. A style that fails a check falls
// back down its chain (prism behind → calm in front → classic); a graphic with nowhere to go is left out and logged.
import { DEFAULT_PACKAGE, PACKAGES, RULES, STYLES, STYLEBOOK_VERSION, type Slot, type StyleDef, type Zone } from '@/data/unedit-stylebook';
import { FILL, framing, type Box } from '@/lib/unedit-look';
import type { EpGraphic } from '@/lib/unedit-episode';

export { STYLEBOOK_VERSION };
export const packageOf = (name?: string | null) => (name && PACKAGES[name] ? name : (process.env.UNEDIT_SHOW_PACKAGE && PACKAGES[process.env.UNEDIT_SHOW_PACKAGE] ? process.env.UNEDIT_SHOW_PACKAGE : DEFAULT_PACKAGE));
/** Text behind the speaker needs the production cut-out (UNEDIT_CUTOUT=on). */
export const cutoutOn = () => process.env.UNEDIT_CUTOUT === 'on';

/** Where the speaker's features sit on the finished episode frame (fractions): the eyes-to-mouth core of the head box
 *  (the box runs hat to chin), in the medium framing most shots use. Close-ups are short and the quality check looks
 *  at the real pixels; this is the cheap first pass. */
export function faceOnFrame(face: Box | null, src: { width: number; height: number }, size: { width: number; height: number }): Zone | null {
  if (!face) return null;
  const c = framing(face, src, size, FILL.medium);
  const x0 = (face.x * src.width - c.x) / c.w, y0 = (face.y * src.height - c.y) / c.h;
  const w = (face.w * src.width) / c.w, h = (face.h * src.height) / c.h;
  const core = { x: x0 + w * 0.2, y: y0 + h * 0.3, w: w * 0.6, h: h * 0.5 };
  const cx0 = Math.max(0, core.x), cy0 = Math.max(0, core.y), cx1 = Math.min(1, core.x + core.w), cy1 = Math.min(1, core.y + core.h);
  return cx1 > cx0 && cy1 > cy0 ? { x: cx0, y: cy0, w: cx1 - cx0, h: cy1 - cy0 } : null;
}

const overlap = (a: Zone, b: Zone) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

export type StyleCtx = { landscape: boolean; cutout: boolean; face: Zone | null;
  /** The speaker's head on screen over a window (hat to chin, ear to ear; fractions of the frame), the union over the
   *  camera sizes cut in during it. Unknown (no face found) = null. */
  headAt?: (T: number, D: number) => { top: number; left: number; right: number } | null };

/** Where behind-the-speaker type can go in this window: in the headroom above the head, tucked a little behind it, or
 *  nowhere (the head fills the top of the frame, as in a close-up), so the words are never hidden behind the head.
 *  PrismTitle: a line ~0.14 of the frame tall (plus its kicker); EmphasisWord: as large as the headroom allows. */
export function headroom(s: StyleDef, ctx: StyleCtx, T: number, D: number, text = ''): { y: number; size?: number; x?: number } | 'no room' | null {
  if (!ctx.headAt) return null;
  const head = ctx.headAt(T, D);
  if (head == null) return null;
  // Beside the speaker: the wider open side, the word sized to its width (a serif italic letter is ~0.5 of its size;
  // frame height is 0.5625 of its width), between ~0.09 and 0.3 of the frame tall, centred a little above middle.
  if (s.layer === 'front' && s.slot === 'emphasis' && s.block === 'EmphasisWord') {
    const leftRoom = head.left - 0.05, rightRoom = 1 - head.right - 0.05;
    const side = leftRoom >= rightRoom ? 'left' : 'right';
    const room = Math.max(leftRoom, rightRoom);
    const chars = Math.max(3, text.length);
    const size = Math.min(0.3, (room / 0.5625) / (0.5 * chars));
    if (room < 0.2 || size < 0.09) return 'no room';
    const x = side === 'left' ? 0.03 : head.right + 0.04;
    return { y: 0.42, size: Math.round(size * 1000) / 1000, x: Math.round(x * 1000) / 1000 };
  }
  if (s.layer !== 'behind') return null;
  const top = head.top;
  if (s.block === 'EmphasisWord') {
    // The word's bottom tucks 15 % of its height behind the head; it may not be smaller than ~0.16 of the frame.
    const size = Math.min(0.48, (top - 0.03) / 0.71);
    if (size < 0.16) return 'no room';
    return { y: top + 0.15 * size - (0.86 * size) / 2, size: Math.round(size * 1000) / 1000 };
  }
  const h = 0.14 + (s.slot === 'title' || s.slot === 'chapter' ? 0.05 : 0);
  if (top - 0.03 < h * 0.85) return 'no room';
  return { y: Math.round(Math.max(0.03 + h / 2, top - h / 2 + 0.025) * 1000) / 1000 };
}

/** Why a style can't run here, or null when it can. */
function blocked(s: StyleDef, ctx: StyleCtx): string | null {
  if (s.landscape && !ctx.landscape) return 'portrait episode';
  if (s.layer === 'behind' && !ctx.cutout) return 'no cut-out';
  if (s.layer === 'front' && !s.cover && ctx.face && overlap(s.zone, ctx.face) / (ctx.face.w * ctx.face.h) > RULES.faceCover) return 'would cover the face';
  return null;
}

/** The style a slot gets in a package here: the package's pick, down its fallback chain to the first that can run. */
export function resolveStyle(slot: Slot, pkg: string, ctx: StyleCtx, at?: { T: number; D: number; text?: string }): { id: string | null; skipped: string[]; place?: { y: number; size?: number; x?: number } } {
  const skipped: string[] = [];
  let id: string | null = PACKAGES[pkg]?.slots[slot] ?? null;
  for (let hops = 0; id && hops < 6; hops++) {
    const s = STYLES[id];
    let why = s ? blocked(s, ctx) : 'unknown style';
    const room = !why && s && at ? headroom(s, ctx, at.T, s.dur, at.text) : null;
    if (room === 'no room') why = 'no room above the head in this shot (the words would be hidden)';
    if (!why) return { id, skipped, ...(room && room !== 'no room' ? { place: room } : {}) };
    skipped.push(`${id}: ${why}`);
    id = s?.fallback ?? null;
  }
  return { id: null, skipped };
}

/** A graphic before styling: the director's and the plan's moments (kind = slot, or 'cue'). */
export type BaseGraphic = Omit<EpGraphic, 'style' | 'layer' | 'off'>;

/** Style the base graphics with a package: styles, durations, sounds, layers, then spacing (fixed slots first, then
 *  kinetic and emphasis, then cues; anything that would crowd an earlier graphic is left out). */
export function styleGraphics(base: BaseGraphic[], pkgName: string, ctx: StyleCtx, secs: number): { items: EpGraphic[]; notes: string[]; gl: boolean } {
  const pkg = packageOf(pkgName);
  const notes: string[] = [];
  // Newsroom facts outrank decoration: a quote, timeline or ticker comes right after the anchors, and a source chip is
  // a small overlay that never competes for the screen (it is placed last and never dropped for a clash).
  const rank = (k: EpGraphic['kind']) => (['title', 'lower', 'chapter', 'end'].includes(k) ? 0 : k === 'quote' || k === 'timeline' || k === 'ticker' || k === 'globe' ? 0.5 : k === 'kinetic' ? 1 : k === 'emphasis' ? 2 : k === 'source' ? 4 : 3);
  const news = (k: EpGraphic['kind']) => k === 'source' || k === 'quote' || k === 'timeline' || k === 'ticker' || k === 'globe';
  const out: EpGraphic[] = [];
  const busy: [number, number][] = [];
  let kinetic = 0, emphasis = 0;
  // Full-frame inserts (the figure on the globe) own the screen, so they are settled first: one at a time, and
  // finished before the end card (which takes the last ~4.5 s). Everything else then keeps clear of them.
  const globes: [number, number][] = [];
  for (const g of base.filter((b) => b.kind === 'globe' || b.kind === 'broll').sort((a, b) => a.T - b.T)) {
    const T = Math.max(g.T, globes.length ? globes[globes.length - 1][1] + RULES.gap : 0);
    const D = Math.min(g.D, secs - 5 - T);
    if (D < 2.5) { notes.push(`${g.kind} at ${g.T.toFixed(1)}s left out: no room before the end card`); continue; }
    globes.push([T, T + D]);
    busy.push([T - RULES.gap, T + D + RULES.gap]);
    out.push({ ...g, T, D });
  }
  // Keep an item clear of every globe: trim it to end before one, else move it to just after. Null = no room.
  const clearOfGlobes = (it: EpGraphic): EpGraphic | null => {
    let x = { ...it };
    for (let pass = 0; pass < 4; pass++) {
      const w = globes.find(([a, b]) => x.T < b + RULES.gap && x.T + x.D > a - RULES.gap);
      if (!w) return x.T + x.D <= secs + 0.01 ? x : null;
      if (x.T < w[0] && w[0] - RULES.gap - x.T >= 1.2) x = { ...x, D: w[0] - RULES.gap - x.T };
      else x = { ...x, T: w[1] + RULES.gap };
    }
    return null;
  };
  for (const g of [...base].sort((a, b) => rank(a.kind) - rank(b.kind) || a.T - b.T)) {
    if (g.kind === 'globe' || g.kind === 'broll') continue;
    let item: EpGraphic = { ...g };
    if (g.kind === 'source') {
      const c = clearOfGlobes({ ...item, D: Math.min(item.D, secs - item.T) });
      if (c && c.T < secs - 1) out.push(c); else notes.push(`source at ${g.T.toFixed(1)}s has no room clear of the globe`);
      continue;
    }
    if (news(g.kind)) {
      // Left-anchored panels stop short of the speaker's head, like front titles.
      if (g.kind !== 'ticker' && ctx.face) {
        const room = ctx.face.x - ctx.face.w / 3 - RULES.safe - 0.0625;
        if (room < 0.45) item.maxW = Math.max(0.24, Math.round(room * 1000) / 1000);
      }
      // A fact is never dropped for a clash: it waits for the screen to clear (as long as it still fits before the
      // end), else shares it (noted on the card).
      for (let pass = 0; pass < 4; pass++) {
        const hit = busy.filter(([a, b]) => item.T < b && item.T + item.D > a);
        if (!hit.length) break;
        const free = Math.max(...hit.map(([, b]) => b));
        if (free + item.D <= secs - 4.5) { item.T = free; continue; }
        notes.push(`${g.kind} at ${g.T.toFixed(1)}s shares the screen with another graphic`);
        break;
      }
      busy.push([item.T - RULES.gap, item.T + item.D + RULES.gap]);
      out.push(item);
      continue;
    }
    if (g.kind !== 'cue') {
      const { id, skipped, place } = resolveStyle(g.kind as Slot, pkg, ctx, { T: g.T, D: g.D, text: g.text });
      if (skipped.length) notes.push(`${g.kind} at ${g.T.toFixed(1)}s: ${skipped.join('; ')}`);
      if (!id) { if (g.kind === 'title' || g.kind === 'lower' || g.kind === 'chapter' || g.kind === 'end') item = { ...item, style: undefined }; else continue; }
      else {
        const s = STYLES[id];
        item = { ...item, style: id, layer: s.layer, D: s.dur, sound: s.sound, ...(place ? { place } : {}) };
        // Left-anchored type stops short of the speaker's head (the head runs wider than the eyes-to-mouth core).
        if (s.layer === 'front' && !s.cover && ctx.face && s.zone.x < 0.3 && s.zone.y < ctx.face.y + ctx.face.h * 1.6) {
          const headLeft = ctx.face.x - ctx.face.w / 3;
          const room = headLeft - RULES.safe - s.zone.x;
          if (room < s.zone.w) item.maxW = Math.max(0.22, Math.round(room * 1000) / 1000);
        }
      }
      if (g.kind === 'end') item.T = Math.max(0, secs - item.D);
      if (g.kind !== 'end') { const c = clearOfGlobes(item); if (!c) continue; item = c; }
      if (g.kind === 'kinetic' && kinetic >= RULES.maxKinetic) continue;
      if (g.kind === 'emphasis' && emphasis >= RULES.maxEmphasis) continue;
    }
    if (item.T + item.D > secs + 0.01) { if (rank(g.kind) === 0) item.D = Math.max(1.2, secs - item.T); else continue; }
    const clash = busy.some(([a, b]) => item.T < b && item.T + item.D > a);
    if (clash && rank(g.kind) > 0) continue;
    busy.push([item.T - RULES.gap, item.T + item.D + RULES.gap]);
    if (item.kind === 'kinetic') kinetic++;
    if (item.kind === 'emphasis') emphasis++;
    out.push(item);
  }
  out.sort((a, b) => a.T - b.T);
  return { items: out, notes, gl: out.some((i) => Boolean(i.style && STYLES[i.style]?.gl)) };
}

export { PACKAGES, STYLES, DEFAULT_PACKAGE };
