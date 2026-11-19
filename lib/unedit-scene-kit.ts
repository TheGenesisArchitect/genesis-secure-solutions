// The scene plan's closed list of scene types and the checks every proposal must pass, shared by the server
// (lib/unedit-scenes.ts drafts and checks), the sources sheet (lib/unedit-news.ts) and the card (client code).
// Pure: no server imports here.
export type SceneType = 'model' | 'bench' | 'cad' | 'lab' | 'assembly';
export type SceneDef = {
  label: string;
  /** Genovus Motion block that draws it (src/hf/observatory.tsx, src/hf/assembly.tsx). */
  block: string;
  /** three.js: renders in the sandbox through SwiftShader (gl: 'swangle'), slower, on its own worker. */
  gl: boolean;
  /** On-screen seconds. */
  secs: number;
  /** How many facts it draws, and whether each is a before → after pair. */
  facts: { min: number; max: number; pair: boolean };
  /** Rendered in the shipped bundle and checked in the render sandbox. Until then the scene is planned, not drawn. */
  ready: boolean;
  /** When Helix should choose it (goes into the prompt). */
  use: string;
};
export const SCENES: Record<SceneType, SceneDef> = {
  model: { label: 'Model card', block: 'ModelCard', gl: false, secs: 6, facts: { min: 2, max: 4, pair: false }, ready: false,
    use: 'introduces one product or model with 2 to 4 headline numbers (price, context size, a score). Title: the product name, then " — " and a 3 to 6 word tagline.' },
  bench: { label: 'Benchmark duel', block: 'BenchDuel', gl: false, secs: 6, facts: { min: 2, max: 5, pair: true }, ready: false,
    use: 'compares the new version with the previous one on 2 to 5 named benchmarks (before → after). Title: "<new> vs <old>".' },
  cad: { label: 'CAD build', block: 'CadScene', gl: false, secs: 7.5, facts: { min: 0, max: 1, pair: true }, ready: false,
    use: 'the article shows engineering or mechanical design work (CAD, parts, drawings): a part is drafted live with a feature tree and dimensions. Optionally one engineering benchmark before → after.' },
  lab: { label: 'Lab result', block: 'LabScene', gl: false, secs: 8.5, facts: { min: 0, max: 1, pair: true }, ready: false,
    use: 'the article shows scientific or research work (experiments, assays, data analysis): an assay terminal, a fitted curve and a molecule. Optionally one research benchmark before → after.' },
  assembly: { label: '3D assembly', block: 'AssemblyShot', gl: true, secs: 9, facts: { min: 0, max: 1, pair: true }, ready: false,
    use: 'the article shows something physical being designed and put together (assemblies, mechanisms, manufacturing): a real-material exploded assembly seats part by part. Optionally one engineering benchmark before → after.' },
};
export const SCENE_TYPES = Object.keys(SCENES) as SceneType[];

export type Num = { v: number; text: string; prefix: string; suffix: string; decimals: number };
export type Fact = { label: string; a: Num; b: Num | null };

const NUM = /^([$€£]?)\s*(-?\d+(?:,\d{3})*(?:\.\d+)?)\s*(%|[kKmMbB]|x|×|pts?)?$/;
function num(s: string): Num | null {
  const m = s.trim().match(NUM);
  if (!m) return null;
  const digits = m[2].replace(/,/g, '');
  return { v: Number(digits), text: m[2], prefix: m[1] ?? '', suffix: m[3] ?? '', decimals: (digits.split('.')[1] ?? '').length };
}
/** "BenchCAD 2.1 Core: 62.6% → 82.5%" or "Input, per 1M tokens: $8". */
export function parseFact(s: string): Fact | null {
  const m = s.trim().match(/^(.{1,60}?):\s*(.+)$/);
  if (!m) return null;
  const [x, y] = m[2].split(/\s*(?:→|->)\s*/);
  const a = num(x ?? ''), b = y === undefined ? null : num(y);
  if (!a || (y !== undefined && !b)) return null;
  return { label: m[1].trim(), a, b };
}

/** Text compared the way a reader would: case, quote and dash styles, non-breaking spaces and hyphens folded. */
export const fold = (s: string) => s.toLowerCase()
  .replace(/[‐-―−]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/[   ]/g, ' ').replace(/­/g, '').replace(/\s+/g, ' ').trim();
const numbersIn = (s: string) => (s.match(/\d+(?:,\d{3})*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ''));
const hasNumber = (hay: string, n: string) => numbersIn(hay).some((x) => x === n || Number(x) === Number(n));

export type SceneProposal = {
  type: SceneType; say: string; title: string; facts: string[]; source: string; url: string;
  /** The article's own words the numbers come from (checked word for word). */ passage: string;
  /** Which part of the article it shows, in a few words. */ why: string;
  /** The spoken words were found in the script or transcript, so the scene can be placed. */ placeable: boolean;
};
export type ScenePlan = {
  article: { url: string; title: string; chars: number };
  scenes: SceneProposal[]; notes: string[]; cents: number; drafted_at: string; by: string | null;
  /** Indexes of the scenes a person added to the sheet, and when. */ approved?: { keep: number[]; at: string } | null;
};

/** Check one proposal. Returns it cleaned, or the reason it can't be used. */
export function checkScene(raw: Record<string, unknown>, article: string, spoken: string, url: string): SceneProposal | string {
  const type = String(raw.type ?? '') as SceneType;
  const def = SCENES[type];
  const title = String(raw.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!def) return `"${title || raw.type}": "${raw.type}" isn't a scene we make`;
  const facts = (Array.isArray(raw.facts) ? raw.facts : []).map((f) => String(f).replace(/\s+/g, ' ').trim()).filter(Boolean);
  const parsed = facts.map(parseFact);
  const bad = facts.find((_, i) => !parsed[i]);
  if (bad) return `${def.label} "${title}": "${bad}" isn't a "label: number" fact`;
  if (facts.length < def.facts.min || facts.length > def.facts.max) return `${def.label} "${title}" needs ${def.facts.min === def.facts.max ? def.facts.min : `${def.facts.min} to ${def.facts.max}`} facts, not ${facts.length}`;
  if (parsed.some((f) => Boolean(f!.b) !== def.facts.pair)) return `${def.label} "${title}": every fact must be ${def.facts.pair ? 'a before → after pair' : 'a single number'}`;
  const passage = String(raw.passage ?? '').replace(/\s+/g, ' ').trim().slice(0, 600);
  if (passage.length < 20 || !fold(article).includes(fold(passage))) return `${def.label} "${title}": its passage isn't word for word in the article`;
  // Every number on screen must come from the passage (title and labels included: "BenchCAD 2.1" must be there too).
  const missing = numbersIn([title, ...facts].join(' ')).filter((n) => !hasNumber(passage, n));
  if (missing.length) return `${def.label} "${title}": ${[...new Set(missing)].slice(0, 3).join(', ')} isn't in its passage`;
  const say = String(raw.say ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
  const source = String(raw.source ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!source) return `${def.label} "${title}" has no source label`;
  return { type, say, title, facts, source, url, passage, why: String(raw.why ?? '').replace(/\s+/g, ' ').trim().slice(0, 140),
    placeable: say.split(/\s+/).length >= 2 && fold(` ${spoken} `).includes(fold(` ${say} `)) };
}

