// Helix presses the buttons in UnEdit Studio and the Newsroom, so the team can brainstorm and build hands-free. Every
// action runs exactly what the button runs (lib/unedit.ts tap, lib/newsroom-actions.ts), in three lanes enforced HERE,
// on the server, not only in Helix's instructions:
//   free   reversible and free: Helix just does it and says what it did
//   spend  spends from the Studio cap: Helix says the rough cost first, then does it; slow ones run in the background
//   yes    goes out or can't be undone: the first call only returns a summary and a signed token; it runs only when
//          confirm_studio_action brings that token back (after the person said yes), for the same person, within 10 min
// Staff only (the route checks). Names resolve to records here: a story by headline words, a recording by title words
// or "this" (the one on screen), a clip by number, a claim by its number on the story card.
import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { adminDb } from '@/lib/supabase/admin';
import { genovusTenant, postingContext, tap } from '@/lib/unedit';
import { newsroomAction } from '@/lib/newsroom-actions';
import { RHYTHMS, type Rhythm } from '@/lib/unedit-plan';
import { best } from '@/lib/helix-stories';

import { ACTIONS, type Lane } from '@/lib/helix-act-tools';
type Args = Record<string, unknown>;
type Ctx = { by: string; origin: string; current?: string; currentStory?: string };
export type ActResult = { ok: boolean; say?: string; error?: string; lane?: Lane; needs_yes?: boolean; summary?: string; token?: string; background?: () => Promise<string>; choices?: string[] };

const UUID = /^[0-9a-f-]{36}$/i;
const str = (v: unknown, n = 400) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const SECRET = () => process.env.HELIX_ACT_SECRET || process.env.CRON_SECRET || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const sign = (s: string) => createHmac('sha256', SECRET()).update(s).digest('base64url');

/** A signed, 10-minute token for one exact resolved action and one person. */
function tokenFor(action: string, args: Args, by: string): string {
  const body = Buffer.from(JSON.stringify({ a: action, x: args, u: by, e: Date.now() + 10 * 60_000 })).toString('base64url');
  return `${body}.${sign(body)}`;
}
function readToken(token: string, by: string): { a: string; x: Args } | { error: string } {
  const [body, sig] = String(token ?? '').split('.');
  if (!body || !sig || !SECRET()) return { error: 'There is nothing waiting for a yes. Ask again.' };
  const want = Buffer.from(sign(body)), got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { error: 'That confirmation is not valid. Ask again.' };
  const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as { a: string; x: Args; u: string; e: number };
  if (p.u !== by) return { error: 'That confirmation belongs to someone else.' };
  if (Date.now() > p.e) return { error: 'That confirmation expired (10 minutes). Ask again.' };
  return { a: p.a, x: p.x };
}

async function findStory(args: Args, ctx: Ctx): Promise<{ id: string; headline: string; angles: { title?: string }[] } | { error: string; choices?: string[] }> {
  const tenant = await genovusTenant();
  const want = str(args.story, 200);
  const sid = UUID.test(want) ? want : /^(this|this one|this story|current)?$/i.test(want) ? ctx.currentStory : undefined;
  if (sid) {
    const { data } = await adminDb().from('newsroom_stories').select('id, headline, angles').eq('id', sid).eq('tenant_id', tenant).maybeSingle();
    if (data) return data as { id: string; headline: string; angles: { title?: string }[] };
    if (!want || !UUID.test(want)) return { error: 'No story is open on screen; say words from its headline.' };
  }
  const { data } = await adminDb().from('newsroom_stories').select('id, headline, angles, created_at').eq('tenant_id', tenant).neq('status', 'dismissed').gte('created_at', new Date(Date.now() - 45 * 86_400_000).toISOString()).order('created_at', { ascending: false }).limit(400);
  const r = best((data ?? []) as { id: string; headline: string; angles: { title?: string }[] }[], want, (s) => s.headline);
  if (!r.row) return { error: `No story matches “${want}”.`, choices: r.others };
  if (r.others.length) return { error: `“${want}” matches more than one story.`, choices: [r.row.headline, ...r.others] };
  return r.row;
}
async function findRecording(args: Args, ctx: Ctx): Promise<{ id: string; title: string } | { error: string; choices?: string[] }> {
  const want = str(args.recording, 200);
  const name = (v: { title: string | null; episode: { title?: string } | null }) => v.episode?.title || v.title || 'Recording';
  const id = UUID.test(want) ? want : /^(this|this one|this recording|current)?$/i.test(want) ? ctx.current : undefined;
  if (id) {
    const { data } = await adminDb().from('unedit_vlogs').select('id, title, episode').eq('id', id).maybeSingle();
    if (data) return { id: data.id, title: name(data as never) };
    if (!want || !UUID.test(want)) return { error: 'No recording is open on screen; say words from its title.' };
  }
  const { data } = await adminDb().from('unedit_vlogs').select('id, title, episode, created_at').order('created_at', { ascending: false }).limit(200);
  const rows = ((data ?? []) as { id: string; title: string | null; episode: { title?: string } | null }[]).filter((v) => !/^\[test/i.test(name(v)));
  const r = best(rows, want, name);
  if (!r.row) return { error: `No recording matches “${want}”.`, choices: r.others };
  return { id: r.row.id, title: name(r.row) };
}
async function clipId(vlog: string, n: unknown): Promise<string> {
  const { data } = await adminDb().from('unedit_clips').select('id').eq('vlog_id', vlog).eq('n', Number(n)).maybeSingle();
  if (!data) throw new Error(`There is no clip ${str(n, 4) || '(say its number)'} on that recording.`);
  return data.id as string;
}

/**
 * Resolve and run one action. Free and spend actions run now (slow ones hand back `background` for the route to run
 * after answering). A yes-lane action returns needs_yes with a summary and token; nothing changes until confirm.
 */
export async function studioAction(action: string, args: Args, ctx: Ctx): Promise<ActResult> {
  const meta = ACTIONS[action];
  if (!meta) return { ok: false, error: `Helix can’t do “${action}” here.`, choices: Object.keys(ACTIONS) };
  try {
    const resolved = await resolve(action, args, ctx);
    if ('error' in resolved) return { ok: false, ...resolved };
    if (meta.lane === 'yes') return { ok: true, lane: 'yes', needs_yes: true, summary: resolved.summary, token: tokenFor(action, resolved.run, ctx.by), say: `Read this back and ask: ${resolved.summary} Shall I? Call confirm_studio_action with the token only after a clear yes.` };
    return { ...(await execute(action, resolved.run, ctx)), lane: meta.lane };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'That didn’t work.' };
  }
}

/** Run the action a yes was given to: exactly what was summarized, for the same person. */
export async function confirmStudioAction(token: string, ctx: Ctx): Promise<ActResult> {
  const t = readToken(token, ctx.by);
  if ('error' in t) return { ok: false, error: t.error };
  try { return { ...(await execute(t.a, t.x, ctx)), lane: 'yes' }; } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'That didn’t work.' }; }
}

/** Names → records, and a plain summary of what will happen. */
async function resolve(action: string, args: Args, ctx: Ctx): Promise<{ run: Args; summary: string } | { error: string; choices?: string[] }> {
  if (action === 'sweep_wire') return { run: {}, summary: 'Sweep the free wire.' };
  if (action === 'write_brief') return { run: {}, summary: 'Write today’s brief.' };
  if (action === 'research_beat') {
    const { data } = await adminDb().from('newsroom_settings').select('beats').eq('tenant_id', await genovusTenant()).maybeSingle();
    const beats = ((data?.beats ?? []) as { id: string; label: string }[]);
    const w = str(args.beat, 60).toLowerCase();
    const b = beats.find((x) => x.id === w || x.label.toLowerCase() === w) ?? beats.find((x) => x.label.toLowerCase().includes(w) || w.includes(x.id));
    if (!b) return { error: `No beat called “${str(args.beat, 60)}”.`, choices: beats.map((x) => x.label) };
    return { run: { beat: b.id }, summary: `Research the ${b.label} beat.` };
  }
  const storyActions = ['pick_angle', 'set_parts', 'voiced', 'next_upload', 'research_deeper', 'write_production', 'faceless_video', 'approve_claim', 'drop_claim', 'dismiss_story'];
  if (storyActions.includes(action)) {
    const s = await findStory(args, ctx);
    if ('error' in s) return s;
    const head = `“${s.headline}”`;
    if (action === 'pick_angle') {
      const n = Number(args.angle) - 1;
      if (!(n >= 0 && n < (s.angles ?? []).length)) return { error: `That story has ${(s.angles ?? []).length} angles; say 1 to ${(s.angles ?? []).length}.`, choices: (s.angles ?? []).map((a, i) => `${i + 1}. ${a.title ?? ''}`) };
      return { run: { tool: 'set_angle', story: s.id, angle: n }, summary: `Use angle ${n + 1} (${s.angles[n].title ?? ''}) for ${head}.` };
    }
    if (action === 'set_parts') return { run: { tool: 'set_build', story: s.id, parts: str(args.parts, 1600).split(/;|\n/).map((p) => p.trim()).filter(Boolean) }, summary: `Set the parts for ${head}.` };
    if (action === 'voiced') return { run: { tool: 'voiced', story: s.id, on: !/^(no|off|false)$/i.test(str(args.on, 5)) }, summary: `Voice setting for ${head}.` };
    if (action === 'research_deeper') return { run: { tool: 'deeper', story: s.id }, summary: `Research ${head} deeper.` };
    if (action === 'dismiss_story') return { run: { tool: 'dismiss', story: s.id }, summary: `Take ${head} off the wire.` };
    if (action === 'write_production') {
      const { data: st } = await adminDb().from('newsroom_stories').select('chosen_angle, voiced').eq('id', s.id).single();
      const n = args.angle ? Number(args.angle) - 1 : Number(st?.chosen_angle ?? 0);
      return { run: { tool: 'produce', story: s.id, angle: n >= 0 ? n : 0, formats: ['long', 'cut', 'clips', 'article', 'social', 'newsletter'], voiced: Boolean(st?.voiced) }, summary: `Write the package for ${head}.` };
    }
    if (action === 'next_upload' || action === 'faceless_video') {
      const { data: p } = await adminDb().from('newsroom_productions').select('id').eq('story_id', s.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (!p) return { error: `${head} has no production yet. Write the package first.` };
      return action === 'next_upload' ? { run: { tool: 'next_upload', production: p.id }, summary: `Cut the next upload against ${head}.` } : { run: { tool: 'faceless', production: p.id, length: args.length === 'full' ? 'full' : 'short' }, summary: `Build a faceless video of ${head}.` };
    }
    // Claims, numbered as on the story card (oldest first).
    const { data: cs } = await adminDb().from('newsroom_claims').select('id, text, status').eq('story_id', s.id).order('created_at');
    const n = Number(args.claim) - 1;
    const c = (cs ?? [])[n] as { id: string; text: string; status: string } | undefined;
    if (!c) return { error: `${head} has ${(cs ?? []).length} facts; say which number.`, choices: (cs ?? []).map((x, i) => `${i + 1}. ${str((x as { text: string }).text, 120)}`) };
    return { run: { tool: action, claim: c.id }, summary: `${action === 'approve_claim' ? 'Approve' : 'Take out'} fact ${n + 1} of ${head} (${c.status}): “${str(c.text, 200)}”.` };
  }
  // UnEdit: one recording.
  const v = await findRecording(args, ctx);
  if ('error' in v) return v;
  const rec = `“${v.title}”`;
  switch (action) {
    case 'approve_clip': case 'leave_out_clip': case 'reopen_clip': {
      const tool = action === 'approve_clip' ? 'approve_clip' : action === 'leave_out_clip' ? 'drop_clip' : 'reopen_clip';
      return { run: { vlog: v.id, t: { tool, clip: await clipId(v.id, args.clip) } }, summary: `${action.replace(/_/g, ' ')} ${args.clip} on ${rec}.` };
    }
    case 'redo_clip': {
      const note = str(args.note, 300);
      if (note.length < 3) return { error: 'Say what to change in the clip.' };
      return { run: { vlog: v.id, t: { tool: 'redo_clip', clip: await clipId(v.id, args.clip), note } }, summary: `Recut clip ${args.clip} on ${rec}: ${note}.` };
    }
    case 'edit_clip': {
      const t: Args = { tool: 'edit_clip', clip: await clipId(v.id, args.clip) };
      for (const k of ['title', 'instagram', 'facebook', 'youtube']) if (args[k]) t[k] = str(args[k], 2200);
      if (Object.keys(t).length < 3) return { error: 'Say the new title or copy.' };
      return { run: { vlog: v.id, t }, summary: `Edit clip ${args.clip} on ${rec}.` };
    }
    case 'edit_episode': {
      const t: Args = { tool: 'edit_episode' };
      if (args.title) t.title = str(args.title, 200);
      if (args.description) t.description = str(args.description, 5000);
      if (Object.keys(t).length < 2) return { error: 'Say the new title or description.' };
      return { run: { vlog: v.id, t }, summary: `Edit ${rec}.` };
    }
    case 'pick_thumbnail': {
      const n = Number(args.thumb);
      if (!(n >= 1 && n <= 3)) return { error: 'Say thumbnail 1, 2 or 3.' };
      return { run: { vlog: v.id, t: { tool: 'pick_thumb', index: n - 1 } }, summary: `Use thumbnail ${n} on ${rec}.` };
    }
    case 'set_package': return { run: { vlog: v.id, t: { tool: 'set_package', pkg: str(args.package, 40).toLowerCase() } }, summary: `Switch ${rec} to the ${str(args.package, 40)} package.` };
    case 'retry': return { run: { vlog: v.id, t: { tool: 'retry' } }, summary: `Retry ${rec}.` };
    case 'post_full_video': return { run: { vlog: v.id, t: { tool: 'post_longform' } }, summary: `Post the full video of ${rec} to YouTube now.` };
    case 'approve_campaign': {
      const { data: full } = await adminDb().from('unedit_vlogs').select('id, tenant_id, stage').eq('id', v.id).single();
      if (full?.stage !== 'review') return { error: `${rec} isn’t waiting for review (it is ${full?.stage}).` };
      const { data: cs } = await adminDb().from('unedit_clips').select('n, status').eq('vlog_id', v.id);
      const going = (cs ?? []).filter((c) => c.status === 'ready' || c.status === 'approved').length;
      const cutting = (cs ?? []).filter((c) => c.status === 'rendering' || c.status === 'redo').map((c) => c.n);
      if (cutting.length) return { error: `Clip ${cutting.join(', ')} ${cutting.length === 1 ? 'is' : 'are'} still being cut. Approve when ${cutting.length === 1 ? 'it lands' : 'they land'}.` };
      if (!going) return { error: `${rec} has no clips ready to go.` };
      const mode = args.mode === 'now' ? 'now' : 'plan';
      const ctxp = await postingContext(full as { id: string; tenant_id: string });
      const rhythm = (['flood', 'drip', 'steady'].includes(String(args.rhythm)) ? String(args.rhythm) : ctxp.rec.rhythm) as Rhythm;
      const how = mode === 'now' ? 'everything goes out within the next few minutes' : `on Helix’s plan, ${RHYTHMS[rhythm].name.toLowerCase()}${rhythm === ctxp.rec.rhythm ? ` (what Helix recommends: ${ctxp.rec.why})` : ''}`;
      return { run: { vlog: v.id, t: { tool: 'approve', mode, ...(mode === 'plan' ? { rhythm } : {}) } }, summary: `Approve ${rec}: ${going} clip${going === 1 ? '' : 's'} plus the full video, ${how}. Each post can still be moved until it goes out.` };
    }
  }
  return { error: 'Helix can’t do that here.' };
}

async function execute(action: string, run: Args, ctx: Ctx): Promise<ActResult> {
  const meta = ACTIONS[action];
  if (run.vlog) {
    const say = await tap(String(run.vlog), run.t as never, ctx.by, ctx.origin);
    return { ok: true, say };
  }
  const go = async () => (await newsroomAction(run, ctx.by, ctx.origin)).say;
  if (meta?.slow) return { ok: true, say: `Started: ${meta.does}. It takes a minute or two; the page updates when it lands (ask me “is it ready?”).`, background: go };
  return { ok: true, say: await go() };
}
