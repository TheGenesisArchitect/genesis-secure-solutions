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

export type StyleCtx = { landscape: boolean; cutout: boolean; face: Zone | null };

/** Why a style can't run here, or null when it can. */
function blocked(s: StyleDef, ctx: StyleCtx): string | null {
  if (s.landscape && !ctx.landscape) return 'portrait episode';
  if (s.layer === 'behind' && !ctx.cutout) return 'no cut-out';
  if (s.layer === 'front' && !s.cover && ctx.face && overlap(s.zone, ctx.face) / (ctx.face.w * ctx.face.h) > RULES.faceCover) return 'would cover the face';
  return null;
}

/** The style a slot gets in a package here: the package's pick, down its fallback chain to the first that can run. */
export function resolveStyle(slot: Slot, pkg: string, ctx: StyleCtx): { id: string | null; skipped: string[] } {
  const skipped: string[] = [];
  let id: string | null = PACKAGES[pkg]?.slots[slot] ?? null;
  for (let hops = 0; id && hops < 6; hops++) {
    const s = STYLES[id];
    const why = s ? blocked(s, ctx) : 'unknown style';
    if (!why) return { id, skipped };
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
  const rank = (k: EpGraphic['kind']) => (['title', 'lower', 'chapter', 'end'].includes(k) ? 0 : k === 'kinetic' ? 1 : k === 'emphasis' ? 2 : 3);
  const out: EpGraphic[] = [];
  const busy: [number, number][] = [];
  let kinetic = 0, emphasis = 0;
  for (const g of [...base].sort((a, b) => rank(a.kind) - rank(b.kind) || a.T - b.T)) {
    let item: EpGraphic = { ...g };
    if (g.kind !== 'cue') {
      const { id, skipped } = resolveStyle(g.kind as Slot, pkg, ctx);
      if (skipped.length) notes.push(`${g.kind} at ${g.T.toFixed(1)}s: ${skipped.join('; ')}`);
      if (!id) { if (g.kind === 'title' || g.kind === 'lower' || g.kind === 'chapter' || g.kind === 'end') item = { ...item, style: undefined }; else continue; }
      else {
        const s = STYLES[id];
        item = { ...item, style: id, layer: s.layer, D: s.dur, sound: s.sound };
        // Left-anchored type stops short of the speaker's head (the head runs wider than the eyes-to-mouth core).
        if (s.layer === 'front' && !s.cover && ctx.face && s.zone.x < 0.3 && s.zone.y < ctx.face.y + ctx.face.h * 1.6) {
          const headLeft = ctx.face.x - ctx.face.w / 3;
          const room = headLeft - RULES.safe - s.zone.x;
          if (room < s.zone.w) item.maxW = Math.max(0.22, Math.round(room * 1000) / 1000);
        }
      }
      if (g.kind === 'end') item.T = Math.max(0, secs - item.D);
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
