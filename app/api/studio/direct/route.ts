// StudioNext direction: the board and Helix's voice tools share this one door. Every action runs with the caller's
// own session (staff only) through audited Studio functions. Spending happens only through a production run, and a
// run starts only by approving a quote the server priced (a tap, or a spoken yes that Helix confirms with the quote).
//   POST { episode: code, tool, args }   tools: status, direct_shot, plan, approve, review, lock_cast, pause
//   GET  ?episode=code                    advance the run (single-flight) and report where every shot is
import { put } from '@vercel/blob';
import { db } from '@/lib/supabase/server';
import { adminDb } from '@/lib/supabase/admin';
import { advanceProduction, cancelShotJobs, episodeShots, quote, type ProdShot } from '@/lib/studio-production';
import { castSheetBytes, identityLocked } from '@/lib/studio-runway';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const STAGE: Record<string, string> = { queued: 'queued', reading: 'reading lines', drawing: 'drawing the keyframe', rendering: 'rendering the take', review: 'ready for review', approved: 'approved', capture: 'needs a phone capture', blocked: 'blocked' };

async function episodeOf(code: unknown) {
  if (typeof code !== 'string' || !/^[A-Za-z0-9-]{1,30}$/.test(code)) return null;
  const supabase = await db();
  const { data } = await supabase.from('studio_episodes').select('id, code, title, series_id, production').eq('code', code).maybeSingle(); // RLS: staff
  return data as { id: string; code: string; title: string; series_id: string; production: Record<string, unknown> } | null;
}
async function status(e: { id: string; code: string; title: string }) {
  const admin = adminDb();
  const { data: fresh } = await admin.from('studio_episodes').select('production').eq('id', e.id).single();
  const run = (fresh?.production ?? {}) as { on?: boolean; at?: string; ceiling_cents?: number; shots?: string[]; paused_reason?: string };
  const shots = await episodeShots(admin, e.id);
  const { data: spent } = run.at ? await admin.rpc('studio_production_spent', { p_episode: e.id, p_since: run.at }) : { data: 0 };
  const list = shots.map((s, i) => ({ board: i + 1, title: s.description.slice(0, 70), tool: s.tool, stage: String(s.produce?.stage ?? (s.status === 'approved' ? 'approved' : 'not started')), note: (s.produce?.redo_note ?? s.produce?.note ?? s.produce?.last_error ?? null) as string | null }));
  return { episode: e.title, run: { on: Boolean(run.on), spent: money(Number(spent ?? 0)), ceiling: money(run.ceiling_cents ?? 0), paused_reason: run.paused_reason ?? null }, shots: list,
    summary: `${list.filter((x) => x.stage === 'review').length} ready for review, ${list.filter((x) => x.stage === 'approved').length} approved, ${list.filter((x) => ['queued', 'reading', 'drawing', 'rendering'].includes(x.stage)).length} in production, ${list.filter((x) => x.stage === 'capture').length} need a phone capture, ${list.filter((x) => x.stage === 'blocked').length} blocked.` };
}
const boardShot = (shots: ProdShot[], n: unknown) => { const i = Math.round(Number(n)); return Number.isFinite(i) && i >= 1 && i <= shots.length ? shots[i - 1] : null; };

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { episode?: string; tool?: string; args?: Record<string, unknown> };
  const supabase = await db();
  const { data: staff } = await supabase.rpc('is_staff');
  if (!staff) return Response.json({ ok: false, error: 'Only the Genovus team can direct the Studio.' }, { status: 403 });
  const e = await episodeOf(b.episode);
  if (!e) return Response.json({ ok: false, error: 'Open an episode’s production board first.' }, { status: 404 });
  const a = b.args ?? {};
  const shots = await episodeShots(adminDb(), e.id);
  const fail = (error: string) => Response.json({ ok: false, error });
  /** Lock every active character not yet locked to the official V2 cast sheet; shots waiting on a lock resume. */
  const lockCast = async (): Promise<{ locked: string[] } | { error: string }> => {
    const admin = adminDb();
    const { data: cast } = await supabase.from('studio_characters').select('id, code, name').eq('status', 'active').order('sort');
    const locked: string[] = [];
    for (const c of (cast ?? []) as { id: string; code: string; name: string }[]) {
      if (await identityLocked(admin, c.id)) continue;
      let { data: ref } = await admin.from('studio_refs').select('id').eq('character_id', c.id).eq('slot', 'CASTING').eq('status', 'ready').order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (!ref) {
        const bytes = await castSheetBytes(c.code, new URL(req.url).origin);
        if (!bytes) continue;
        const file = await put(`studio/casting/${c.id}/official-v2.jpg`, bytes, { access: 'private', contentType: 'image/jpeg', addRandomSuffix: true });
        const added = await supabase.rpc('studio_add_casting', { p_character: c.id, p_blob: file.pathname });
        if (added.error) return { error: added.error.message };
        ref = { id: added.data as string };
      }
      const { error } = await supabase.rpc('studio_approve_ref', { p_id: ref.id, p_reason: `${c.name}: official V2 cast sheet, locked for production` });
      if (error) return { error: error.message };
      locked.push(c.name);
    }
    const fresh = await episodeShots(admin, e.id);
    for (const s of fresh.filter((x) => x.produce?.stage === 'blocked' && /identity/i.test(String(x.produce?.note ?? '')))) await admin.rpc('studio_shot_produce_patch', { p_shot: s.id, p_patch: { stage: 'queued', since_now: true, force: true, note: null, leases: {} } });
    return { locked };
  };
  try {
    switch (b.tool) {
      case 'status': return Response.json({ ok: true, ...(await status(e)) });
      case 'direct_shot': {
        const s = boardShot(shots, a.shot);
        if (!s) return fail(`There’s no shot ${a.shot}; the board has shots 1 to ${shots.length}.`);
        const log: Record<string, string> = {};
        for (const k of ['acting', 'read', 'camera']) if (typeof a[k] === 'string' && (a[k] as string).trim()) log[k] = (a[k] as string).trim().slice(0, k === 'read' ? 600 : 300);
        if (!Object.keys(log).length) return fail('Say what to change: the acting, the line read or the camera.');
        const { error } = await supabase.rpc('studio_update_shot_log', { p_id: s.id, p_log: log });
        return error ? fail(error.message) : Response.json({ ok: true, shot: a.shot, changed: Object.keys(log) });
      }
      case 'plan': {
        const q = await quote(adminDb(), e, typeof a.shots === 'string' ? a.shots : 'all');
        if (!q.items.length) return fail('Nothing to produce in those shots: they’re approved already or have nothing to generate.');
        const { data: id, error } = await supabase.rpc('studio_quote_production', { p_episode: e.id, p_shots: q.items.map((x) => x.id), p_cents: q.cents, p_detail: { items: q.items } });
        if (error) return fail(error.message);
        return Response.json({ ok: true, quote_id: id, total: money(q.cents), ceiling: money(Math.ceil(q.cents * 1.25)), shots: q.items.map((x) => x.board), expires_in_minutes: 15,
          say: `Producing shots ${q.items.map((x) => x.board).join(', ')} is about ${money(q.cents)} (ceiling ${money(Math.ceil(q.cents * 1.25))}). Shall I go ahead?` });
      }
      case 'approve': {
        if (typeof a.quote_id !== 'string') return fail('Get a quote first, read it back, and approve that quote.');
        const { error } = await supabase.rpc('studio_approve_production', { p_quote: a.quote_id, p_via: a.via === 'voice' ? 'voice' : 'tap' });
        if (error) return fail(error.message);
        // Producing means producing with the official cast: any character not yet locked is locked to the official V2
        // sheet now (recorded as this person's decision), so no shot stalls waiting on a lock.
        const locked = await lockCast();
        if ('error' in locked) return fail(locked.error);
        const progress = await advanceProduction(e.id).catch(() => ({}));
        return Response.json({ ok: true, started: true, progress, say: 'Approved. Lines, keyframes and takes are underway; each shot lands in review as it finishes.' });
      }
      case 'review': {
        const s = boardShot(shots, a.shot);
        if (!s) return fail(`There’s no shot ${a.shot}.`);
        const action = a.action === 'redo' ? 'redo' : a.action === 'approve' ? 'approve' : null;
        if (!action) return fail('Approve it or redo it?');
        const { error } = await supabase.rpc('studio_review_shot', { p_shot: s.id, p_action: action, p_note: typeof a.note === 'string' ? a.note.slice(0, 300) : '' });
        if (error) return fail(error.message);
        if (action === 'redo') await advanceProduction(e.id).catch(() => ({}));
        return Response.json({ ok: true, shot: a.shot, action });
      }
      case 'lock_cast': {
        const r = await lockCast();
        if ('error' in r) return fail(r.error);
        return Response.json({ ok: true, locked: r.locked, say: r.locked.length ? `Locked ${r.locked.join(', ')} to the official cast sheet.` : 'The whole cast is already locked.' });
      }
      case 'retry': {
        // Blocked shots in the run start over (fresh failure counts); the run resumes if it was paused for no spend reason.
        const blocked = shots.filter((x) => x.produce?.stage === 'blocked');
        for (const s of blocked) await adminDb().rpc('studio_shot_produce_patch', { p_shot: s.id, p_patch: { stage: 'queued', since_now: true, force: true, note: null, last_error: null, leases: {} } });
        const progress = await advanceProduction(e.id).catch(() => ({}));
        return Response.json({ ok: true, retried: blocked.length, progress, say: blocked.length ? `Retrying ${blocked.length} shot${blocked.length === 1 ? '' : 's'}.` : 'Nothing is blocked.' });
      }
      case 'raise_ceiling': {
        // Price what the run still needs (the shots not yet in review), so the person approves an exact amount.
        const run = (e.production ?? {}) as { shots?: string[] };
        const admin = adminDb();
        const pending = shots.filter((x) => (run.shots ?? []).includes(x.id) && !['review', 'approved', 'capture'].includes(String(x.produce?.stage ?? '')));
        const q = await quote(admin, e, pending.map((x) => shots.indexOf(x) + 1).join(',') || 'none');
        const cents = Math.max(100, q.cents);
        const ids = pending.length ? pending.map((x) => x.id) : (run.shots ?? []).slice(0, 1);
        if (!ids.length) return fail('There’s no run to extend.');
        const { data: id, error } = await supabase.rpc('studio_quote_production', { p_episode: e.id, p_shots: ids, p_cents: cents, p_detail: { raise: true } });
        if (error) return fail(error.message);
        return Response.json({ ok: true, quote_id: id, total: money(cents), ceiling: money(Math.ceil(cents * 1.25)), shots: pending.map((x) => shots.indexOf(x) + 1), say: `Finishing the run needs about ${money(cents)} more. Shall I approve it?` });
      }
      case 'retry_shot':
      case 'cancel_shot': {
        const s = boardShot(shots, a.shot);
        if (!s) return fail(`There’s no shot ${a.shot}.`);
        const cancelled = await cancelShotJobs(s.id, b.tool === 'retry_shot' ? 'Cancelled for a retry' : 'Cancelled by the team');
        if (b.tool === 'cancel_shot') {
          await adminDb().rpc('studio_shot_produce_patch', { p_shot: s.id, p_patch: { stage: 'blocked', note: 'Cancelled by the team. Tap Retry to start it again.', leases: {}, force: true } });
          return Response.json({ ok: true, shot: a.shot, cancelled, say: `Stopped shot ${a.shot}.` });
        }
        // A retry starts the shot over inside the run (fresh failure counts); the run resumes if it was paused.
        const run = (e.production ?? {}) as { on?: boolean; shots?: string[] };
        if (!(run.shots ?? []).includes(s.id)) return fail(`Shot ${a.shot} isn’t in the approved run. Ask Helix to produce it first.`);
        await adminDb().rpc('studio_shot_produce_patch', { p_shot: s.id, p_patch: { stage: 'queued', since_now: true, force: true, note: null, last_error: null, leases: {} } });
        if (!run.on) await adminDb().rpc('studio_production_patch', { p_episode: e.id, p_patch: { on: true }, p_remove: ['paused_at', 'paused_reason', 'idle_at'] });
        const progress = await advanceProduction(e.id).catch(() => ({}));
        return Response.json({ ok: true, shot: a.shot, cancelled, progress, say: `Retrying shot ${a.shot}.` });
      }
      case 'pause': {
        const { error } = await supabase.rpc('studio_pause_production', { p_episode: e.id });
        return error ? fail(error.message) : Response.json({ ok: true, paused: true });
      }
      default: return fail('Unknown direction.');
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Something went wrong.');
  }
}

export async function GET(req: Request) {
  const supabase = await db();
  const { data: staff } = await supabase.rpc('is_staff');
  if (!staff) return Response.json({ error: 'not allowed' }, { status: 403 });
  const e = await episodeOf(new URL(req.url).searchParams.get('episode'));
  if (!e) return Response.json({ error: 'not found' }, { status: 404 });
  const progress = (e.production as { on?: boolean }).on ? await advanceProduction(e.id).catch((x) => ({ error: String(x) })) : {};
  return Response.json({ progress, ...(await status(e)) });
}
