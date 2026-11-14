// The Unedit style book: the Intelligent Editor's craft knowledge as data. One file read by three readers:
//   the director prompt   (lib/unedit-moments.ts directEpisode): what each slot is for, when to use it, when not to
//   the code              (lib/unedit-style.ts): it ENFORCES the rules here (zones, face clearance, durations, spacing,
//                          fallbacks), the way the Cue Engine enforces its tags; a prompt can drift, code can't
//   the Claude skill      (~/.claude/skills/genovus-editor/SKILL.md): "edit this like Genovus" points here
// Each style names the Genovus Motion block that draws it (genovus-motion src/UneditEpisodeCues.tsx → src/hf/*), ported
// from HeyGen HyperFrames (Apache-2.0, see genovus-motion/NOTICE).
//
// A SHOW PACKAGE picks one style per slot and stays fixed for a whole series: premium shows look expensive because
// every graphic follows one system. A mix is just a package whose slots come from different directions.
// Bump STYLEBOOK_VERSION whenever a rule changes; every episode records the version it was planned with.

export const STYLEBOOK_VERSION = '2026-11-14.2';

/** Slots a package fills. title/lower/chapter/end exist today; kinetic and emphasis are written by the director. */
export type Slot = 'title' | 'lower' | 'chapter' | 'kinetic' | 'emphasis' | 'end';
/** A rectangle in fractions of a landscape frame. */
export type Zone = { x: number; y: number; w: number; h: number };

export type StyleDef = {
  slot: Slot;
  label: string;
  /** The Genovus Motion block that renders it. */
  block: string;
  /** Behind the speaker (needs the cut-out) or in front. */
  layer: 'front' | 'behind';
  /** Where it draws on the frame; a full-frame card sets cover (it owns the frame, e.g. the close). */
  zone: Zone;
  cover?: boolean;
  /** Seconds on screen. */
  dur: number;
  /** Its sound slot (lib/unedit-cues.ts SOUND_SLOTS). */
  sound: string | null;
  /** The style to use when this one can't run: behind with no cut-out, or its zone would cover the face. */
  fallback: string | null;
  /** Landscape only (portrait episodes use the classic set). */
  landscape?: boolean;
  /** Renders three.js in the sandbox (needs the GL flag). */
  gl?: boolean;
  use: string;
  avoid: string;
};

export const STYLES: Record<string, StyleDef> = {
  // ---- title (the opener, the episode's title) ----------------------------------------------------------------
  'title.classic': { slot: 'title', label: 'Classic kinetic title', block: 'Title', layer: 'front', zone: { x: 0.047, y: 0.6, w: 0.68, h: 0.3 }, dur: 3.4, sound: 'whoosh', fallback: null,
    use: 'Portrait episodes, or any show that wants the original Genovus look.', avoid: 'Premium packages.' },
  'title.calm': { slot: 'title', label: 'Calm editorial title', block: 'TitleCalm', layer: 'front', zone: { x: 0.07, y: 0.55, w: 0.52, h: 0.28 }, dur: 3.4, sound: 'swish', fallback: 'title.classic', landscape: true,
    use: 'Keynote and interview shows: a mono kicker and a quiet headline that respects the speaker.', avoid: 'Very long titles (over 9 words).' },
  'title.prism': { slot: 'title', label: 'Prism title behind the speaker', block: 'PrismTitle', layer: 'behind', zone: { x: 0.08, y: 0.18, w: 0.84, h: 0.26 }, dur: 3.2, sound: 'riser', fallback: 'title.calm', landscape: true,
    use: 'Documentary openers: the title focuses in from a blur behind the speaker\'s head.', avoid: 'Titles over 6 words (they shrink to fit and lose drama).' },

  // ---- lower-third (who is talking) ---------------------------------------------------------------------------
  'lower.classic': { slot: 'lower', label: 'Classic glass bar', block: 'Lower', layer: 'front', zone: { x: 0.043, y: 0.78, w: 0.3, h: 0.14 }, dur: 4, sound: 'swish', fallback: null,
    use: 'Portrait episodes; the original look.', avoid: 'Premium packages.' },
  'lower.mask': { slot: 'lower', label: 'Mask reveal with the egg', block: 'LowerMaskReveal', layer: 'front', zone: { x: 0.06, y: 0.77, w: 0.32, h: 0.14 }, dur: 3, sound: 'swish', fallback: 'lower.classic', landscape: true,
    use: 'Branded shows: an orange sweep wipes the name on beside the egg.', avoid: 'Nothing; the default premium lower-third.' },
  'lower.underline': { slot: 'lower', label: 'Accent underline', block: 'LowerAccentUnderline', layer: 'front', zone: { x: 0.06, y: 0.76, w: 0.3, h: 0.15 }, dur: 3, sound: 'swish', fallback: 'lower.classic', landscape: true,
    use: 'Documentary and quiet shows: no card, just type and one orange rule.', avoid: 'Busy, bright backgrounds behind the bottom left.' },

  // ---- chapter (a topic turn) ---------------------------------------------------------------------------------
  'chapter.classic': { slot: 'chapter', label: 'Classic glass card', block: 'Chapter', layer: 'front', zone: { x: 0.047, y: 0.1, w: 0.41, h: 0.25 }, dur: 3.2, sound: 'whoosh', fallback: null,
    use: 'Portrait episodes; the original look.', avoid: 'Premium packages.' },
  'chapter.calm': { slot: 'chapter', label: 'Calm chapter (kicker + headline)', block: 'TitleCalm', layer: 'front', zone: { x: 0.07, y: 0.55, w: 0.52, h: 0.28 }, dur: 3, sound: 'swish', fallback: 'chapter.classic', landscape: true,
    use: 'Keynote shows: the chapter reads like a slide title, lower left.', avoid: 'Two chapters within 30 s (it starts to feel like a deck).' },
  'chapter.prism-serif': { slot: 'chapter', label: 'Prism serif behind the speaker', block: 'PrismTitle', layer: 'behind', zone: { x: 0.08, y: 0.18, w: 0.84, h: 0.24 }, dur: 2.6, sound: 'riser', fallback: 'chapter.calm', landscape: true,
    use: 'Documentary chapters: an italic serif title focusing in behind the head.', avoid: 'Titles over 6 words.' },
  'chapter.prism-wide': { slot: 'chapter', label: 'Prism wide slam', block: 'PrismTitle', layer: 'front', zone: { x: 0.08, y: 0.17, w: 0.84, h: 0.22 }, dur: 2.4, sound: 'hit', fallback: 'chapter.classic', landscape: true,
    use: 'Agency and energetic shows: an expanded uppercase chapter slams in.', avoid: 'Speakers framed high (it sits above the head).' },

  // ---- kinetic (the director's phrase from the speaker's own words) -------------------------------------------
  'kinetic.center': { slot: 'kinetic', label: 'Kinetic center build', block: 'KineticCenterBuild', layer: 'front', zone: { x: 0.07, y: 0.72, w: 0.86, h: 0.15 }, dur: 2.7, sound: 'pop', fallback: null, landscape: true,
    use: 'The hook line or the thesis: words build and push, the payoff word in orange.', avoid: 'More than twice an episode; quiet, emotional moments.' },

  // ---- emphasis (one big word, typography as texture) ---------------------------------------------------------
  'emphasis.serif': { slot: 'emphasis', label: 'Serif word behind the speaker', block: 'EmphasisWord', layer: 'behind', zone: { x: 0, y: 0.1, w: 1, h: 0.55 }, dur: 3, sound: null, fallback: null, landscape: true,
    use: 'The one word the story is about (coffee, faith, money), drifting behind the head as they say it.', avoid: 'Without the cut-out (it would cover the face, so it is left out).' },

  // ---- end (the close) ----------------------------------------------------------------------------------------
  'end.classic': { slot: 'end', label: 'Classic end card', block: 'End', layer: 'front', zone: { x: 0, y: 0, w: 1, h: 1 }, cover: true, dur: 4.5, sound: 'sting', fallback: null,
    use: 'Portrait episodes; the original look.', avoid: 'Premium packages.' },
  'end.cascade': { slot: 'end', label: 'Brand close (letters cascade, egg drops)', block: 'BrandClose', layer: 'front', zone: { x: 0, y: 0, w: 1, h: 1 }, cover: true, dur: 4, sound: 'sting', fallback: 'end.classic', landscape: true,
    use: 'Every premium package that has no 3D close.', avoid: 'Nothing.' },
  'end.mark3d': { slot: 'end', label: '3D chrome wordmark with the glossy egg', block: 'ExtrudedMark', layer: 'front', zone: { x: 0, y: 0, w: 1, h: 1 }, cover: true, dur: 4, sound: 'sting', fallback: 'end.cascade', landscape: true, gl: true,
    use: 'Keynote and the signature mix: the hero brand moment.', avoid: 'More than once an episode.' },
};

export type PackageDef = { label: string; about: string; slots: Partial<Record<Slot, string>> };

/** The show packages. A package left without a slot simply doesn't use it (Keynote has no emphasis word). */
export const PACKAGES: Record<string, PackageDef> = {
  classic: { label: 'Classic', about: 'The original Genovus graphics (portrait episodes always use it).',
    slots: { title: 'title.classic', lower: 'lower.classic', chapter: 'chapter.classic', end: 'end.classic' } },
  keynote: { label: 'Keynote', about: 'Calm editorial type, the egg mask-reveal, a 3D chrome close.',
    slots: { title: 'title.calm', lower: 'lower.mask', chapter: 'chapter.calm', kinetic: 'kinetic.center', end: 'end.mark3d' } },
  documentary: { label: 'Documentary', about: 'Serif type behind the speaker, a quiet underline, the brand close.',
    slots: { title: 'title.prism', lower: 'lower.underline', chapter: 'chapter.prism-serif', emphasis: 'emphasis.serif', end: 'end.cascade' } },
  kinetic: { label: 'Agency kinetic', about: 'Words that build and push, wide chapter slams, the cascading brand close.',
    slots: { title: 'title.calm', lower: 'lower.mask', chapter: 'chapter.prism-wide', kinetic: 'kinetic.center', end: 'end.cascade' } },
  signature: { label: 'Genovus Signature (mix)', about: 'Calm opener, the egg lower-third, serif chapters behind you, the kinetic hook, the 3D close.',
    slots: { title: 'title.calm', lower: 'lower.mask', chapter: 'chapter.prism-serif', kinetic: 'kinetic.center', emphasis: 'emphasis.serif', end: 'end.mark3d' } },
};
export const DEFAULT_PACKAGE = 'signature';

/** Rules the code enforces on every episode (lib/unedit-style.ts). */
export const RULES = {
  /** A front graphic may cover at most this share of the speaker's features (eyes to mouth); past it, the style falls back. */
  faceCover: 0.2,
  /** Title-safe: front text stays inside this inset (fractions of the frame). */
  safe: 0.035,
  /** Seconds kept clear between any two graphics. */
  gap: 0.5,
  /** At most this many kinetic phrases and emphasis words per episode. */
  maxKinetic: 2,
  maxEmphasis: 3,
  /** A kinetic phrase is 2 to 5 of the speaker's own words; an emphasis word is one, at least 4 letters. */
  kineticWords: [2, 5] as [number, number],
  emphasisMin: 4,
  /** Chapter-change transitions: a zoom-blur punch on the footage at each chapter's first frame. */
  transitionAtChapters: true,
  /** Shots held longer than this (seconds) get a slow push-in, so a face shot never sits static. */
  pushAfter: 6,
  pushAmount: 0.045,
};

/** The style book as the director reads it (prompt text). */
export function stylebookPrompt(pkg: string): string {
  const p = PACKAGES[pkg] ?? PACKAGES[DEFAULT_PACKAGE];
  const lines = Object.entries(p.slots).map(([slot, id]) => { const s = STYLES[id!]; return `- ${slot}: ${s.label}. Use: ${s.use} Avoid: ${s.avoid}`; });
  return [`Show package: ${p.label} (${p.about}). Style book ${STYLEBOOK_VERSION}:`, ...lines].join('\n');
}
