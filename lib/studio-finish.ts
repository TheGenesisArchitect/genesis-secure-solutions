// Studio finisher, server only: when every shot of an approved run has landed, the episode finishes itself. The final
// cut (16:9) and every Short (9:16) render from the canonical timeline and the episode waits for one person's
// Publish tap. Nobody presses Render. In an auto run, speaking shots whose lips aren't verified don't block: their
// reads are mixed in the edit (the board says so); Act-Two stays available for hero work.
// Triggered by the Studio cron and the open board (kickFinish), run by /api/studio/finish/[code] in the background.
import 'server-only';
import { adminDb } from '@/lib/supabase/admin';
import { buildTimeline, validateTimeline } from '@/lib/studio-timeline';
import { renderTimeline } from '@/lib/studio-render';
import { shortsOf } from '@/lib/studio-board';
import { episodeShots } from '@/lib/studio-production';

type Run = { on?: boolean; at?: string; shots?: string[]; auto_finish?: boolean; finishing?: string; finished_at?: string; finish_note?: string; finish_failed_at?: string };
const ACTIVE = ['queued', 'reading', 'drawing', 'rendering', 'syncing'];
const STUCK = ['blocked', 'capture'];

/** Is this run ready to finish? Every run shot landed (review or approved), nothing stuck, not already finishing. */
export async function finishable(episodeId: string): Promise<{ ready: boolean; why?: string; code?: string }> {
  const db = adminDb();
  const { data: e } = await db.from('studio_episodes').select('id, code, production').eq('id', episodeId).single();
  const run = (e?.production ?? {}) as Run;
  // A failed finish waits for a change (a redo, a retry, or "Finish now" on the board) instead of looping.
  if (!e || !run.on || !run.auto_finish || run.finishing || run.finished_at || run.finish_failed_at) return { ready: false, why: run.finish_failed_at ? run.finish_note : undefined };
  const shots = (await episodeShots(db, e.id)).filter((s) => (run.shots ?? []).includes(s.id));
  const stage = (s: (typeof shots)[number]) => String(s.produce?.stage ?? '');
  if (shots.some((s) => ACTIVE.includes(stage(s)))) return { ready: false };
  const stuck = shots.filter((s) => STUCK.includes(stage(s)));
  if (stuck.length) return { ready: false, why: `Waiting on ${stuck.map((s) => `shot ${s.n}`).join(', ')} (${stuck.map((s) => stage(s)).join(', ')})` };
  return { ready: true, code: e.code as string };
}

/** Ask the finish route to finish this episode (it claims the run, so a double kick is harmless). */
export async function kickFinish(origin: string, episodeId: string): Promise<boolean> {
  const f = await finishable(episodeId);
  if (!f.ready || !f.code || !process.env.CRON_SECRET) return false;
  await fetch(`${origin}/api/studio/finish/${f.code}`, { method: 'POST', headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, signal: AbortSignal.timeout(10_000) }).catch(() => null);
  return true;
}

/** Claim the run for finishing (single-flight): the claim's stamp if this caller holds it, else null. */
export async function claimFinish(episodeId: string): Promise<string | null> {
  const db = adminDb();
  const f = await finishable(episodeId);
  if (!f.ready) return null;
  const { data: e } = await db.from('studio_episodes').select('production').eq('id', episodeId).single();
  const run = (e?.production ?? {}) as Run;
  if (run.finishing) return null;
  const stamp = new Date().toISOString();
  const { data } = await db.from('studio_episodes').update({ production: { ...run, finishing: stamp } }).eq('id', episodeId).is('production->>finishing', null).select('id');
  return data?.length ? stamp : null;
}

/** Render the final cut and every Short, then hand the episode to Publish. Records its own failures on the run. */
export async function finishEpisode(episodeId: string, claim: string): Promise<{ ok: boolean; note: string }> {
  const db = adminDb();
  const patch = (p: Record<string, unknown>, remove: string[] = []) => db.rpc('studio_production_patch', { p_episode: episodeId, p_patch: p, p_remove: remove });
  const started = Date.now();
  const { data: e } = await db.from('studio_episodes').select('id, code, title').eq('id', episodeId).single();
  if (!e) return { ok: false, note: 'episode not found' };
  try {
    const cut = await buildTimeline(e.id, 'wide');
    // Unverified lips are mixed in the edit in an auto run; everything else (missing pictures, reads, screens) blocks.
    const mixed = cut.problems.filter((p) => p.kind === 'sync_unverified');
    const problems = validateTimeline(cut, 'final').filter((p) => p.kind !== 'sync_unverified');
    if (problems.length) {
      const note = `Couldn't finish: ${problems.map((p) => `${p.label}: ${p.detail}`).join(' · ')}`.slice(0, 500);
      await patch({ finish_note: note, finish_failed_at: new Date().toISOString() }, ['finishing']);
      return { ok: false, note };
    }
    const r = await renderTimeline(e.id, cut, 'final', 'wide');
    const set = await db.rpc('studio_system_set_final', { p_episode: e.id, p_blob: r.blob, p_sha256: r.sha256 });
    if (set.error) throw new Error(set.error.message);
    const shorts = shortsOf(e.code as string);
    for (const s of shorts) {
      const sc = await buildTimeline(e.id, 'vertical', s.shots);
      const sr = await renderTimeline(e.id, sc, 'short', 'vertical', s.code);
      const add = await db.rpc('studio_system_add_render', { p_episode: e.id, p_kind: 'short', p_format: 'vertical', p_short: s.code, p_title: s.title, p_blob: sr.blob, p_secs: sr.secs, p_note: '' });
      if (add.error) throw new Error(add.error.message);
    }
    // Did the run change while this rendered (a new approval, a redo, Act-Two)? Then this finish is stale: stand down
    // and let the next one follow the new shots.
    const { data: now } = await db.from('studio_episodes').select('production').eq('id', e.id).single();
    if ((now?.production as Run | null)?.finishing !== claim) return { ok: false, note: 'superseded by a change to the run' };
    const secs = Math.round((Date.now() - started) / 1000);
    const note = `Finished in ${secs} s: final cut (${Math.round(r.secs)} s)${shorts.length ? ` and ${shorts.length} Short${shorts.length === 1 ? '' : 's'}` : ''}. Ready to publish.${mixed.length ? ` Lips mixed in the edit on ${mixed.map((p) => p.label).join(', ')}.` : ''}`;
    // The run stays open (redos inside its ceiling still work); a redo reopens the finish so the final follows it.
    await patch({ finished_at: new Date().toISOString(), finish_secs: secs, finish_note: note }, ['finishing', 'finish_failed_at']);
    return { ok: true, note };
  } catch (err) {
    const note = `The finish failed: ${err instanceof Error ? err.message.slice(0, 300) : 'unknown error'}`;
    console.error(`[studio-finish] ${e.code}: ${note}`);
    await patch({ finish_note: note, finish_failed_at: new Date().toISOString() }, ['finishing']);
    return { ok: false, note };
  }
}
