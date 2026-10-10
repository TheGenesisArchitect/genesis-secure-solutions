// SWIS™ autopilot: runs an episode from Shot Contracts to picked takes with people deciding only the look of the
// hero shots. Every minute, for each episode a staff member started (with a spending ceiling), it advances each
// cast shot one stage: paint first-frame candidates → choose (production shots: a quick judge picks; hero shots:
// a person picks) → start the tier's takes inside the rate limits → the Creative Court scores → pick the best take
// without a hard fail. All spend goes through studio_reserve_auto (ceiling + monthly cap, under the budget lock).
import 'server-only';
import { adminDb } from '@/lib/supabase/admin';
import { blobBase64, generateFrame, scheduleTake, shotAspect, shotBudget, videoFor, recordExpense, IMAGE_MODEL, IMAGE_CENTS } from '@/lib/studio-gen';
import { compileFrame, type ShotContract, type CastMember } from '@/lib/studio-direct';
import { castFor } from '@/lib/studio-castrefs';
import season from '@/data/studio-season1.json';
import castData from '@/data/studio-cast.json';

const JUDGE_MODEL = () => (process.env.STUDIO_FRAME_JUDGE_MODEL || 'gemini-3-flash-preview').trim();
const BASE = () => (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
const KEY = () => (process.env.GEMINI_API_KEY || '').trim();
export const FRAME_CANDIDATES = 4;
const COURT_CENTS_EST = 8;
const genome = () => (season.series as { genome?: unknown }).genome as Parameters<typeof compileFrame>[1];

type Shot = { id: string; n: number; shot_code: string | null; tool: string; tier: string; prompt: string | null; contract: ShotContract | null; status: string };
type FrameRow = { id: string; shot_id: string; role: string; status: string; chosen: boolean; cost_cents: number };
type TakeRow = { id: string; shot_id: string; status: string; chosen: boolean; court_status: string | null; court_score: number | null; court: { hard_fails?: string[] } | null };

export type Stage = 'frames' | 'painting' | 'your-look' | 'choosing' | 'rendering' | 'court' | 'picked' | 'needs-you';
export const STAGE_LABEL: Record<Stage, string> = { frames: 'Frames next', painting: 'Painting frames', 'your-look': 'Your look decision', choosing: 'Choosing a frame', rendering: 'Rendering takes', court: 'Court reviewing', picked: 'Take picked', 'needs-you': 'Needs you' };

const takesNeeded = (s: Shot) => (s.tier === 'hero' ? Math.max(1, s.contract?.takes ?? 3) : 1);

/** Where a shot is in the autopilot's flow (also shown on the episode page). */
export function stageOf(s: Shot, frames: FrameRow[], takes: TakeRow[]): Stage {
  const f = frames.filter((x) => x.shot_id === s.id && x.role === 'start');
  const t = takes.filter((x) => x.shot_id === s.id && x.status !== 'failed');
  if (t.some((x) => x.chosen)) return 'picked';
  if (t.length) {
    if (t.some((x) => x.status !== 'ready')) return 'rendering';
    if (t.some((x) => x.court_status === null || x.court_status === 'running')) return 'court';
    return t.some((x) => x.court_status === 'scored' && !x.court?.hard_fails?.length) ? 'court' : 'needs-you';
  }
  if (f.some((x) => x.chosen)) return 'rendering';
  if (f.some((x) => x.status === 'running' || x.status === 'queued')) return 'painting';
  if (f.some((x) => x.status === 'ready')) return s.tier === 'hero' ? 'your-look' : 'choosing';
  return 'frames';
}

/** What running an episode through the autopilot should cost: frames, takes and Court reviews for every cast shot. */
export async function estimateEpisode(episodeId: string): Promise<{ cents: number; shots: number; heroShots: number; takes: number }> {
  const { data } = await adminDb().from('studio_shots').select('id, tier, tool, contract').eq('episode_id', episodeId);
  const shots = ((data ?? []) as Shot[]).filter((s) => s.tool === 'veo' && s.contract?.timeline?.length);
  const { budget } = await shotBudget(episodeId);
  const run = shots.slice(0, budget);
  let cents = 0, takes = 0;
  for (const s of run) { const n = takesNeeded(s); takes += n; cents += FRAME_CANDIDATES * IMAGE_CENTS + n * (videoFor(s.tier).cents + COURT_CENTS_EST); }
  return { cents, shots: run.length, heroShots: run.filter((s) => s.tier === 'hero').length, takes };
}

/** A quick judge (Gemini Flash) picks the frame that best fits the contract and the cast sheets. */
async function judgeFrames(shot: Shot, candidates: FrameRow[], refIds: string[]): Promise<string | null> {
  const db = adminDb();
  const parts: Record<string, unknown>[] = [{ text: `You are the first-frame judge for a film shot. Pick the candidate that best matches this Shot Contract: composition, the right people (faces, hair, wardrobe must match the reference sheets), the starting moment, continuity, natural film look, and NO legible text or extra people.\n\nSHOT: ${shot.contract!.function}\nFRAME: ${shot.contract!.composition}\nCONTINUITY: ${shot.contract!.continuity.join('; ')}\nSTART: ${Object.values(shot.contract!.states.start).join('; ')}` }];
  if (refIds.length) {
    const { data: rows } = await db.from('studio_refs').select('character, blob_path').in('id', refIds).eq('status', 'ready');
    for (const r of (rows ?? []).slice(0, 3)) { const img = r.blob_path ? await blobBase64(r.blob_path) : null; if (img) parts.push({ text: `Reference sheet: ${r.character}` }, { inlineData: img }); }
  }
  const usable: FrameRow[] = [];
  for (const c of candidates) {
    const { data: a } = await db.from('studio_art').select('blob_path').eq('id', c.id).single();
    const img = a?.blob_path ? await blobBase64(a.blob_path) : null;
    if (img) { parts.push({ text: `Candidate ${usable.length}:` }, { inlineData: img }); usable.push(c); }
  }
  if (!usable.length) return null;
  if (usable.length === 1) return usable[0].id;
  const res = await fetch(`${BASE()}/models/${encodeURIComponent(JUDGE_MODEL())}:generateContent`, {
    method: 'POST', headers: { 'x-goog-api-key': KEY(), 'content-type': 'application/json' }, signal: AbortSignal.timeout(90_000),
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', responseSchema: { type: 'OBJECT', properties: { best: { type: 'INTEGER' }, reason: { type: 'STRING' } }, required: ['best'] } } }),
  });
  const j = (await res.json().catch(() => ({}))) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
  if (!res.ok) throw new Error(`frame judge: HTTP ${res.status}`);
  const best = Number(JSON.parse(j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') || '{}').best);
  // Flash pricing ($0.50 in / $3.00 out per 1M): a fraction of a cent, recorded on the chosen frame.
  const cents = Math.max(1, Math.ceil(((j.usageMetadata?.promptTokenCount ?? 0) * 0.5 + (j.usageMetadata?.candidatesTokenCount ?? 0) * 3) / 10_000));
  const pick = usable[Number.isInteger(best) && best >= 0 && best < usable.length ? best : 0];
  await db.from('studio_art').update({ cost_cents: pick.cost_cents + cents }).eq('id', pick.id);
  await recordExpense(cents, `Studio: autopilot frame judge (${JUDGE_MODEL()})`, null);
  return pick.id;
}

/** Advance one episode. Bounded work per run: one frame batch, a few take starts, any number of picks. */
async function advance(ep: { id: string; code: string; series_id: string }): Promise<string[]> {
  const db = adminDb();
  const log: string[] = [];
  const [{ data: shotRows }, { data: frameRows }, { data: takeRows }] = await Promise.all([
    db.from('studio_shots').select('id, n, shot_code, tool, tier, prompt, contract, status').eq('episode_id', ep.id).order('n'),
    db.from('studio_art').select('id, shot_id, role, status, chosen, cost_cents').eq('episode_id', ep.id).eq('kind', 'frame'),
    db.from('studio_takes').select('id, shot_id, status, chosen, court_status, court_score, court, studio_shots!inner(episode_id)').eq('kind', 'video').eq('studio_shots.episode_id', ep.id),
  ]);
  const frames = (frameRows ?? []) as FrameRow[];
  const takes = (takeRows ?? []) as unknown as TakeRow[];
  const sb = await shotBudget(ep.id);
  const shots = ((shotRows ?? []) as Shot[]).filter((s) => s.tool === 'veo' && s.contract?.timeline?.length);
  let paintedThisRun = false;
  let startsLeft = 4;
  for (const s of shots) {
    const stage = stageOf(s, frames, takes);
    const label = s.shot_code ?? `Shot ${s.n}`;
    if (stage === 'frames' && !paintedThisRun) {
      if (!sb.used.includes(s.id) && sb.used.length >= sb.budget) continue; // outside the shot budget
      paintedThisRun = true;
      const prompt = compileFrame(s.contract!, genome(), castData.characters as unknown as CastMember[], shotAspect(s.prompt), 'start');
      const cast = await castFor(db, ep.series_id, ep.id, prompt);
      if (cast.missing?.length) { log.push(`${label}: approve a face for ${cast.missing.join(', ')}`); continue; }
      for (let i = 0; i < FRAME_CANDIDATES; i++) {
        const { data: id, error } = await db.rpc('studio_reserve_auto', { p_kind: 'frame', p_shot: s.id, p_role: 'start', p_prompt: cast.prompt, p_model: IMAGE_MODEL(), p_cents: IMAGE_CENTS, p_params: {}, p_refs: cast.refs });
        if (error) throw new Error(error.message);
        const r = await generateFrame(id as string);
        if (!r.ok) { log.push(`${label}: frame failed (${r.error})`); break; }
      }
      log.push(`${label}: painted frame candidates`);
    } else if (stage === 'choosing') {
      const cands = frames.filter((f) => f.shot_id === s.id && f.role === 'start' && f.status === 'ready');
      const refs = (await castFor(db, ep.series_id, ep.id, s.prompt ?? '')).refs;
      const pick = await judgeFrames(s, cands, refs);
      if (pick) { await db.rpc('studio_auto_choose_frame', { p_id: pick }); frames.forEach((f) => { if (f.shot_id === s.id && f.role === 'start') f.chosen = f.id === pick; }); log.push(`${label}: frame chosen`); }
    }
    // Start the tier's takes once a first frame is chosen (re-read the stage after a pick above).
    if (stageOf(s, frames, takes) === 'rendering' && startsLeft > 0) {
      const live = takes.filter((t) => t.shot_id === s.id && t.status !== 'failed');
      const failedCount = takes.filter((t) => t.shot_id === s.id && t.status === 'failed').length;
      const need = takesNeeded(s) - live.length;
      if (need > 0 && failedCount >= 3) log.push(`${label}: 3 takes failed at the provider; needs you`);
      else if (need > 0) {
        const start = frames.find((f) => f.shot_id === s.id && f.role === 'start' && f.chosen)?.id;
        const end = frames.find((f) => f.shot_id === s.id && f.role === 'end' && f.chosen)?.id;
        const cast = await castFor(db, ep.series_id, ep.id, s.prompt ?? '');
        const render = videoFor(s.tier);
        for (let i = 0; i < need && startsLeft > 0; i++, startsLeft--) {
          const { data: id, error } = await db.rpc('studio_reserve_auto', { p_kind: 'video', p_shot: s.id, p_role: null, p_prompt: cast.prompt, p_model: render.model, p_cents: render.cents, p_params: { aspectRatio: shotAspect(s.prompt), resolution: '1080p', tier: s.tier, start_frame: start, end_frame: end }, p_refs: cast.refs });
          if (error) throw new Error(error.message);
          await scheduleTake(id as string);
          takes.push({ id: id as string, shot_id: s.id, status: 'queued', chosen: false, court_status: null, court_score: null, court: null });
          log.push(`${label}: take queued`);
        }
      }
    }
    // Pick: every take for the shot is finished and reviewed; the best one without a hard fail goes in the edit.
    const mine = takes.filter((t) => t.shot_id === s.id && t.status !== 'failed');
    if (!mine.some((t) => t.chosen) && mine.length >= takesNeeded(s) && mine.every((t) => t.status === 'ready' && t.court_status && t.court_status !== 'running')) {
      const best = mine.filter((t) => t.court_status === 'scored' && !t.court?.hard_fails?.length).sort((a, b) => (b.court_score ?? 0) - (a.court_score ?? 0))[0];
      if (best) { await db.rpc('studio_auto_choose_take', { p_id: best.id }); best.chosen = true; log.push(`${label}: picked take (${best.court_score})`); }
    }
  }
  if (shots.length && shots.slice(0, sb.budget).every((s) => stageOf(s, frames, takes) === 'picked')) log.push('all shots picked: ready for the cut');
  return log;
}

/** Every minute (the autopilot cron): advance every episode whose autopilot is on. A spend refusal pauses it. */
export async function runAutopilot(): Promise<Record<string, string[]>> {
  const db = adminDb();
  const { data } = await db.from('studio_episodes').select('id, code, series_id, autopilot').eq('autopilot->>on', 'true');
  const out: Record<string, string[]> = {};
  for (const ep of (data ?? []) as { id: string; code: string; series_id: string; autopilot: Record<string, unknown> }[]) {
    try {
      out[ep.code] = await advance(ep);
      if (out[ep.code].includes('all shots picked: ready for the cut') && !ep.autopilot.done_at) await db.from('studio_episodes').update({ autopilot: { ...ep.autopilot, done_at: new Date().toISOString() } }).eq('id', ep.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'autopilot error';
      // A spend refusal (ceiling or monthly cap) pauses the run with the reason until a person resumes it; anything
      // else (a provider hiccup) is logged and retried next minute.
      if (/ceiling|budget|autopilot is off/i.test(msg)) {
        out[ep.code] = [`paused: ${msg}`];
        await db.from('studio_episodes').update({ autopilot: { ...ep.autopilot, on: false, paused_at: new Date().toISOString(), paused_reason: msg.slice(0, 300) } }).eq('id', ep.id);
      } else {
        out[ep.code] = [`retrying next minute: ${msg}`];
        console.error(`[autopilot] ${ep.code}: ${msg}`);
      }
    }
  }
  return out;
}
