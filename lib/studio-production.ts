// StudioNext production runs, server only: one approval produces many shots. A quote prices the shots (one read per
// line, one keyframe, one take each); once a person approves that exact quote (a tap, or a spoken "yes" to Helix),
// the advancer walks every approved shot through its steps (lines, keyframe, take) and parks it for review. Each
// step is claimed before Runway is called (single-flight), reserved inside the run's ceiling, and picked
// provisionally: the person approves or redoes the finished shot. Capture shots get their voice-over read and then
// wait for a phone capture; code cards are made in the render.
import 'server-only';
import { adminDb } from '@/lib/supabase/admin';
import { parseRead } from '@/lib/studio-read';
import { billedSeconds, defaultDirection, engineFor, PRICE } from '@/lib/studio-board';
import { identityLocked, pollRunwayJobs, startKeyframes, startLines, startRunwayTake } from '@/lib/studio-runway';

type Db = ReturnType<typeof adminDb>;
export type ProdShot = { id: string; n: number; tool: string; tier: string | null; timing: string | null; description: string; log: Record<string, string> | null; cast_codes: string[] | null; produce: Record<string, string | number | null> | null; status: string };
const SEL = 'id, n, tool, tier, timing, description, log, cast_codes, produce, status';

const readOf = (code: string, s: ProdShot) => s.log?.read ?? defaultDirection(code, s.n)?.read ?? '';

/** What producing one shot should cost in a run: one read per line, one keyframe, one take. */
export function shotQuote(code: string, s: ProdShot, cast: { code: string; name: string }[]) {
  const lines = s.tool === 'edit' ? 0 : parseRead(readOf(code, s), cast).length;
  const eng = engineFor(s.tool, s.tier);
  return lines * PRICE.lineRead + (eng ? PRICE.keyframe + billedSeconds(s.tier, s.timing) * eng.perSec : 0);
}

/** Board numbering (1…12 in shot order) ⇄ the shots. "all", "3", "4-9", "2, 5, 11". */
export function pickShots(shots: ProdShot[], which: string | null | undefined): ProdShot[] {
  const w = String(which ?? 'all').trim().toLowerCase();
  if (!w || w === 'all' || w === 'everything') return shots;
  const want = new Set<number>();
  for (const part of w.split(/[,\s]+(?:and\s+)?|\s+and\s+/).filter(Boolean)) {
    const r = part.match(/^(\d+)\s*(?:-|to|through)\s*(\d+)$/); const one = part.match(/^\d+$/);
    if (r) for (let i = Number(r[1]); i <= Number(r[2]); i++) want.add(i); else if (one) want.add(Number(part));
  }
  return shots.filter((_, i) => want.has(i + 1));
}

export async function episodeShots(db: Db, episodeId: string) {
  const { data } = await db.from('studio_shots').select(SEL).eq('episode_id', episodeId).order('n');
  return (data ?? []) as ProdShot[];
}
async function activeCast(db: Db) {
  const { data } = await db.from('studio_characters').select('id, code, name').eq('status', 'active').order('sort');
  return (data ?? []) as { id: string; code: string; name: string }[];
}

/** Price a set of shots (only those with something to make). */
export async function quote(db: Db, episode: { id: string; code: string }, which: string | null | undefined) {
  const shots = await episodeShots(db, episode.id);
  const cast = await activeCast(db);
  // "All" means what isn't made yet; a named shot is re-produced unless it's approved.
  const named = !!which && !/^(all|everything)?$/i.test(String(which).trim());
  const made = ['approved', 'review', 'capture', 'queued', 'reading', 'drawing', 'rendering'];
  const chosen = pickShots(shots, which).filter((s) => s.produce?.stage !== 'approved' && (named || !made.includes(String(s.produce?.stage ?? ''))));
  const items = chosen.map((s) => ({ board: shots.indexOf(s) + 1, id: s.id, tool: s.tool, cents: shotQuote(episode.code, s, cast) })).filter((x) => x.cents > 0);
  return { items, cents: items.reduce((a, x) => a + x.cents, 0) };
}

const autoReserve = (db: Db) => async (p: { kind: string; shot: string | null; character: string | null; text: string; model: string; cents: number; params?: Record<string, unknown>; refs?: string[] }) => {
  const { data, error } = await db.rpc('studio_reserve_runway_auto', { p_kind: p.kind, p_shot: p.shot, p_character: p.character, p_text: p.text, p_model: p.model, p_cents: Math.max(1, Math.round(p.cents)), p_params: p.params ?? {}, p_refs: p.refs ?? [] });
  if (error) throw new Error(error.message);
  return data as string;
};
const setProduce = (db: Db, s: ProdShot, patch: Record<string, unknown>) => db.rpc('studio_shot_produce_patch', { p_shot: s.id, p_patch: patch });
async function claim(db: Db, shot: string, step: string) {
  const { data } = await db.rpc('studio_claim_step', { p_shot: shot, p_step: step, p_seconds: 90 });
  return data === true;
}
const release = (db: Db, shot: string, step: string) => db.rpc('studio_release_step', { p_shot: shot, p_step: step });
/** Claim a step, run it, release it. Returns false if another advancer holds the step. */
async function once(db: Db, shot: string, step: string, run: () => Promise<{ ok: boolean; error?: string }>) {
  if (!(await claim(db, shot, step))) return false;
  try { const r = await run(); if (!r.ok) throw new Error(r.error); } finally { await release(db, shot, step); }
  return true;
}
const busy = (st: string) => st === 'running' || st === 'queued';

/**
 * Move one shot forward. The line reads and the keyframe don't depend on each other, so both start at once; the
 * take starts the moment both are ready. Returns the shot's stage.
 */
async function advanceShot(db: Db, code: string, s: ProdShot, cast: { id: string; code: string; name: string }[], since: string): Promise<string> {
  const stage = String(s.produce?.stage ?? '');
  if (!stage || ['review', 'approved', 'capture', 'blocked'].includes(stage)) return stage || 'idle';
  if (s.tool === 'edit') { await setProduce(db, s, { stage: 'review', note: 'Code card: made in the render.' }); return 'review'; }
  const runStart = String(s.produce?.since ?? since);
  const reserve = autoReserve(db);
  const eng = engineFor(s.tool, s.tier);

  // Identity first (a quick check): nothing is spent on a generated shot until its cast is locked.
  if (eng) for (const c of cast.filter((x) => (s.cast_codes ?? []).includes(x.code))) {
    if (!(await identityLocked(db, c.id))) { await setProduce(db, s, { stage: 'blocked', note: `Lock ${c.name}’s identity first.` }); return 'blocked'; }
  }

  // Line reads (every line in its current wording; the newest read of each picked) …
  const lines = parseRead(readOf(code, s), cast);
  let linesReady = true;
  const lineStep = async () => {
    if (!lines.length) return;
    const { data: clipRows } = await db.from('studio_voice_clips').select('id, slot, text, status, approved, created_at').eq('shot_id', s.id).eq('kind', 'line').order('created_at', { ascending: false });
    const clips = (clipRows ?? []) as { id: string; slot: string; text: string; status: string; approved: boolean; created_at: string }[];
    const missing = lines.filter((l) => !clips.some((c) => c.slot === l.slot && c.text === l.text && c.status === 'ready'));
    if (missing.length) {
      linesReady = false;
      if (clips.some((c) => busy(c.status))) return;
      if (clips.filter((c) => c.status === 'failed' && new Date(c.created_at) >= new Date(runStart)).length >= 2 * lines.length) throw new Error('BLOCK:Line reads keep failing.');
      await once(db, s.id, 'lines', () => startLines(reserve, s.id));
      return;
    }
    for (const l of lines) {
      const mine = clips.filter((c) => c.slot === l.slot && c.text === l.text && c.status === 'ready');
      if (!mine.some((c) => c.approved)) {
        await db.from('studio_voice_clips').update({ approved: false }).eq('shot_id', s.id).eq('kind', 'line').eq('slot', l.slot);
        await db.from('studio_voice_clips').update({ approved: true }).eq('id', mine[0].id);
      }
    }
  };
  // … and the keyframe (one, picked provisionally; a redo draws a fresh one), at the same time.
  let frameReady = !eng;
  const frameStep = async () => {
    if (!eng) return;
    const { data: frameRows } = await db.from('studio_art').select('id, status, chosen').eq('shot_id', s.id).eq('kind', 'frame').eq('role', 'start').gte('created_at', runStart).order('created_at', { ascending: false });
    const frames = (frameRows ?? []) as { id: string; status: string; chosen: boolean }[];
    if (frames.some((f) => f.chosen && f.status === 'ready')) { frameReady = true; return; }
    const ready = frames.find((f) => f.status === 'ready');
    if (ready) { await db.rpc('studio_auto_choose_frame', { p_id: ready.id }); frameReady = true; return; }
    if (frames.some((f) => busy(f.status))) return;
    if (frames.filter((f) => f.status === 'failed').length >= 2) throw new Error('BLOCK:The keyframe keeps failing.');
    await once(db, s.id, 'keyframe', () => startKeyframes(reserve, s.id, 1));
  };
  try { await Promise.all([lineStep(), frameStep()]); } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (msg.startsWith('BLOCK:')) { await setProduce(db, s, { stage: 'blocked', note: msg.slice(6) }); return 'blocked'; }
    throw e;
  }
  if (s.tool === 'capture') {
    if (!linesReady) { await setProduce(db, s, { stage: 'reading' }); return 'reading'; }
    await setProduce(db, s, { stage: 'capture', note: 'Voice-over ready. Capture the screens on a phone.' }); return 'capture';
  }
  if (!eng) { await setProduce(db, s, { stage: 'review' }); return 'review'; }
  if (!linesReady || !frameReady) { const st = !frameReady ? 'drawing' : 'reading'; if (stage !== st) await setProduce(db, s, { stage: st }); return st; }

  // The take: from the picked keyframe, performing to the picked reads; then the shot waits for review.
  const { data: takeRows } = await db.from('studio_takes').select('id, status, chosen').eq('shot_id', s.id).like('model', 'runway:%').gte('created_at', runStart).order('created_at', { ascending: false });
  const takes = (takeRows ?? []) as { id: string; status: string; chosen: boolean }[];
  const done = takes.find((t) => t.status === 'ready');
  if (done) { await db.rpc('studio_auto_choose_take', { p_id: done.id }); await setProduce(db, s, { stage: 'review' }); return 'review'; }
  if (takes.some((t) => busy(t.status))) { if (stage !== 'rendering') await setProduce(db, s, { stage: 'rendering' }); return 'rendering'; }
  if (takes.filter((t) => t.status === 'failed').length >= 2) { await setProduce(db, s, { stage: 'blocked', note: 'The take keeps failing.' }); return 'blocked'; }
  await once(db, s.id, 'take', () => startRunwayTake(reserve, s.id));
  await setProduce(db, s, { stage: 'rendering' });
  return 'rendering';
}

/** Advance one episode's run: finish Runway jobs, then step every approved shot. A spend refusal pauses the run. */
export async function advanceProduction(episodeId: string): Promise<Record<string, number>> {
  const db = adminDb();
  const { data: e } = await db.from('studio_episodes').select('id, code, production').eq('id', episodeId).single();
  const run = (e?.production ?? {}) as { on?: boolean; at?: string; shots?: string[] };
  if (!e || !run.on) return {};
  await pollRunwayJobs().catch(() => ({}));
  const cast = await activeCast(db);
  const shots = (await episodeShots(db, e.id)).filter((s) => (run.shots ?? []).includes(s.id));
  const out: Record<string, number> = {};
  let pauseMsg: string | null = null;
  const step = async (s: ProdShot) => {
    if (pauseMsg) return;
    try {
      const st = await advanceShot(db, e.code, s, cast, run.at ?? new Date().toISOString());
      out[st] = (out[st] ?? 0) + 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'step failed';
      if (/ceiling|budget|paused|isn.t in the approved run/i.test(msg)) { pauseMsg = msg; return; }
      console.warn(`[production] ${e.code} shot ${s.n}: ${msg}`);
      await setProduce(db, s, { last_error: msg.slice(0, 300) });
      out.errors = (out.errors ?? 0) + 1;
    }
  };
  for (let i = 0; i < shots.length; i += 4) await Promise.all(shots.slice(i, i + 4).map(step));
  // A spend refusal (the ceiling, the monthly cap) pauses the run with the reason.
  if (pauseMsg) {
    await db.rpc('studio_production_patch', { p_episode: e.id, p_patch: { on: false, paused_at: new Date().toISOString(), paused_reason: (pauseMsg as string).slice(0, 300) }, p_remove: [] });
    out.paused = 1;
  }
  // Everything waits on people (review, capture, a lock): the run stays open for redos inside its ceiling.
  if (!['queued', 'reading', 'drawing', 'rendering'].some((k) => out[k]) && !out.paused && !out.errors) {
    if (!(run as { idle_at?: string }).idle_at) await db.rpc('studio_production_patch', { p_episode: e.id, p_patch: { idle_at: new Date().toISOString() }, p_remove: [] });
    out.idle = 1;
  } else if ((run as { idle_at?: string }).idle_at) {
    await db.rpc('studio_production_patch', { p_episode: e.id, p_patch: {}, p_remove: ['idle_at'] });
  }
  return out;
}

/** Every minute (the Studio cron): advance every episode with a run on. */
export async function advanceAllProductions() {
  const { data } = await adminDb().from('studio_episodes').select('id, code').eq('production->>on', 'true');
  const out: Record<string, Record<string, number>> = {};
  for (const e of data ?? []) out[e.code as string] = await advanceProduction(e.id as string);
  return out;
}
