// StudioNext production board helpers: which episodes belong to the current cast (V2) and which are archived
// development work, the default performance direction written with each shot (data/studio-season1.json), and the
// estimate at Runway's published prices. Pure functions over repo data; safe to import from server components.
import season from '@/data/studio-season1.json';
import castFile from '@/data/studio-cast.json';

type SeasonShot = { n: number; cast_codes?: string[]; tool: string; tier?: string; timing?: string; direction?: { acting: string; read: string } };
type SeasonEpisode = { code: string; shots: SeasonShot[] };
type Cast = { code: string; status?: string };

const EPISODES = (season as unknown as { episodes: SeasonEpisode[] }).episodes;
const CAST = (castFile as unknown as { characters: Cast[] }).characters;
export const ACTIVE_CAST = new Set(CAST.filter((c) => c.status !== 'retired').map((c) => c.code));

const castOf = (e: SeasonEpisode) => new Set(e.shots.flatMap((s) => s.cast_codes ?? []));
/** Episodes made with the current cast. Episodes with only the retired development cast are archived. */
export const V2_EPISODES = new Set(EPISODES.filter((e) => [...castOf(e)].some((c) => ACTIVE_CAST.has(c))).map((e) => e.code));
// Everything made before the V2 canon (the development cast era) is archived, whether or not its shots list a cast.
export const ARCHIVED_EPISODES = new Set(EPISODES.filter((e) => !V2_EPISODES.has(e.code)).map((e) => e.code));

/** Default direction for a shot, as written in the season file (the board shows edits saved on the shot first). */
export function defaultDirection(code: string, n: number) {
  return EPISODES.find((e) => e.code === code)?.shots.find((s) => s.n === n)?.direction ?? null;
}
/** Cast codes for a shot, from the season file. */
export function shotCast(code: string, n: number) {
  return EPISODES.find((e) => e.code === code)?.shots.find((s) => s.n === n)?.cast_codes ?? [];
}

/** Seconds a shot runs, from its timing ("0:04–0:06" or "0:51–1:02"). */
export function shotSeconds(timing: string | null | undefined): number {
  const m = String(timing ?? '').match(/(\d+):(\d{2})\s*[–-]\s*(\d+):(\d{2})/);
  if (!m) return 0;
  return Math.max(0, (Number(m[3]) * 60 + Number(m[4])) - (Number(m[1]) * 60 + Number(m[2])));
}

/** Seconds a take is generated (and billed) for: the shot inside each engine's range (Seedance 4–15 s, Gen-4.5 2–10 s). */
export function billedSeconds(tier: string | null | undefined, timing: string | null | undefined) {
  const s = Math.max(1, Math.ceil(shotSeconds(timing)));
  return tier === 'hero' ? Math.min(15, Math.max(4, s)) : Math.min(10, Math.max(2, s));
}

// Runway's published "from" prices (docs.dev.runwayml.com/guides/models, Oct 2026), in cents.
// Gen-4 Image at 1080p is 8 credits; line reads are estimated at 3 credits and replaced by Runway's final cost.
export const PRICE = { seedancePerSec: 20, gen45PerSec: 12, actTwoPerSec: 5, keyframe: 8, lineRead: 3, soundEffect: 5 };
export type Engine = { model: string; label: string; perSec: number; takes: number };
/** Which engine a shot uses: hero shots on Seedance 2.5 (2 takes), production shots on Gen-4.5 (2 takes). */
export function engineFor(tool: string, tier: string | null | undefined): Engine | null {
  if (tool !== 'runway') return null;
  return tier === 'hero' ? { model: 'seedance2_5', label: 'Seedance 2.5 · hero', perSec: PRICE.seedancePerSec, takes: 2 } : { model: 'gen4.5', label: 'Gen-4.5', perSec: PRICE.gen45PerSec, takes: 2 };
}
export type ShotCost = { video: number; keyframes: number; voice: number; total: number };
export function shotCost(s: { tool: string; tier?: string | null; timing?: string | null; dialogue?: string | null }, lines: number): ShotCost {
  const eng = engineFor(s.tool, s.tier);
  const video = eng ? Math.round(billedSeconds(s.tier, s.timing) * eng.perSec * eng.takes) : 0;
  const keyframes = eng ? 2 * PRICE.keyframe : 0;
  const voice = eng ? lines * 2 * PRICE.lineRead : 0;
  return { video, keyframes, voice, total: video + keyframes + voice };
}
