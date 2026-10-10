// Director OS, the Performance Compiler: turns a Shot Contract, the Series Genome and each character's Performance
// DNA into direction a model can follow. A timed performance, not adjectives. The same contract compiles the
// Veo prompt (the whole take, second by second) and the Frame Forge prompts (the exact first and last frames).
// Pure: no I/O, no path aliases, so the content sync (and plain Node) can run it.

export type Beat = { t: [number, number]; do: string; who?: string };
export type ShotContract = {
  function: string;
  duration_s: number;
  cast: string[];
  states: { start: Record<string, string>; end: Record<string, string> };
  composition: string;
  camera: string;
  lighting?: string;
  continuity: string[];
  timeline: Beat[];
  negative: string[];
  sound: string;
  takes?: number;
};
export type Genome = { lenses: string; camera: string; depth: string; lighting: string; skin: string; color: string; texture: string; reactions?: string; forbidden: string[] };
export type PerformanceDna = { pace: string; reaction_order: string[]; smile: string; gesture: string; fourth_wall: string; never: string[]; vocal_range?: string; signature_timing?: string };
export type CastMember = { code: string; name: string; performance_dna?: PerformanceDna };

/** The length Veo renders (1080p takes are 8 seconds); the edit trims to the contract's duration. */
export const TAKE_SECONDS = 8;

const sec = (n: number) => (Number.isInteger(n) ? `${n}.0` : String(n));
const shape = (aspect: '9:16' | '16:9') => (aspect === '16:9' ? 'Widescreen 16:9' : 'Vertical 9:16 for the phone');
// Lens, camera and depth come from each contract's composition; the look carries what every shot shares.
const look = (g: Genome) => `35mm film look, photoreal. Light: ${g.lighting}. Skin: ${g.skin}. Color: ${g.color}. Texture: ${g.texture}.`;
const nameOf = (cast: CastMember[], code: string) => cast.find((c) => c.code === code)?.name.split(' ')[0] ?? code;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** How each featured performer plays, from their Performance DNA. Featured = has a start state in the contract;
 * people only in the background get no DNA, which keeps the prompt focused (and short enough for Veo). */
function playedBy(contract: ShotContract, cast: CastMember[]): string {
  return Object.keys(contract.states.start).map((code) => {
    const d = cast.find((c) => c.code === code)?.performance_dna;
    if (!d) return `@${code}`;
    const order = d.reaction_order.map((s) => s.replace(/^then\s+/i, '')).join(', then ');
    // Timing-bearing traits only; smiles and lens rules are already in the contract's beats and negatives.
    return `@${code} (${nameOf(cast, code)}): ${d.pace}. Reacts: ${order}.${d.vocal_range ? ` ${cap(d.vocal_range)}.` : ''}${d.signature_timing && contract.timeline.some((b) => b.who === code) ? ` ${d.signature_timing}.` : ''} Never ${d.never.join(', ')}.`;
  }).join(' ');
}

const states = (contract: ShotContract, cast: CastMember[], which: 'start' | 'end') =>
  Object.entries(contract.states[which]).map(([code, s]) => `@${code} (${nameOf(cast, code)}) ${s}`).join('; ');

/** The Veo prompt: genome, composition, continuity, the timed performance over the full take, DNA, negatives, sound. */
export function compileVideo(contract: ShotContract, genome: Genome, cast: CastMember[], aspect: '9:16' | '16:9'): string {
  const timeline = contract.timeline.map((b) => `${sec(b.t[0])}–${sec(b.t[1])}s: ${b.who ? `@${b.who} ` : ''}${b.do}`).join(' ');
  return [
    `${shape(aspect)}, ${look(genome)}`,
    `THE SHOT: ${contract.function}`,
    `FRAME: ${contract.composition}. ${contract.camera} ${contract.lighting ? `Light: ${contract.lighting}.` : ''}`.trim(),
    `CONTINUITY: ${contract.continuity.join('; ')}.`,
    `STARTS: ${states(contract, cast, 'start')}. ENDS: ${states(contract, cast, 'end')}.`,
    `PERFORMANCE, timed over ${TAKE_SECONDS} seconds (speak the dialogue exactly as written, at these times): ${timeline}`,
    `HOW THEY PLAY: ${playedBy(contract, cast)}`,
    `AVOID: ${[...contract.negative, ...genome.forbidden].join('; ')}.`,
    `SOUND: ${contract.sound}`,
  ].join('\n\n');
}

/** A Frame Forge prompt: the exact first (or last) frame of the shot, from the same contract. */
export function compileFrame(contract: ShotContract, genome: Genome, cast: CastMember[], aspect: '9:16' | '16:9', role: 'start' | 'end'): string {
  const beat = role === 'start' ? contract.timeline[0] : contract.timeline[contract.timeline.length - 1];
  return [
    `The ${role === 'start' ? 'FIRST' : 'LAST'} FRAME of a film shot. ${shape(aspect)}, ${look(genome)}`,
    `THE SHOT: ${contract.function}`,
    `FRAME: ${contract.composition}. ${contract.camera}`,
    `CONTINUITY: ${contract.continuity.join('; ')}.`,
    `THE MOMENT: ${states(contract, cast, role)}.${beat ? ` (${beat.do.replace(/"[^"]*"/g, '').trim()})` : ''}`,
    'The people must be the characters from the reference sheets provided: identical faces, hair, skin tone, build and wardrobe. A real moment between takes, not a posed photo. No text, logos or watermarks anywhere.',
    `AVOID: ${[...contract.negative, ...genome.forbidden].join('; ')}.`,
  ].join('\n\n');
}
