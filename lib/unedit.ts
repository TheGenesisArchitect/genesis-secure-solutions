// Unedit (Studio): one take in, a campaign out. Server only.
//   uploaded     → read the recording, pull its audio, transcribe it (words with times)       → finding
//   finding      → Claude picks the clips and writes the copy, the episode title, thumb lines   → rendering
//   finding      … and Episode Pro's edit (head/tail, hands-free commands, uh/um, false starts, pauses) and look
//   rendering    → each clip rendered 9:16 with word captions; then three thumbnails; then the full episode,
//                  edited and polished, rendered in parallel parts and joined with one soundtrack  → review
//   review       → the card: Approve or Redo each clip, pick a thumbnail, Approve the campaign   → publishing
//   publishing   → Metricool drafts (or scheduled posts when METRICOOL_MODE=publish)           → published
// One step at a time, under a lease, run by /api/studio/unedit/[id]/step (kicked by the Studio cron and right after
// an upload or a tap). A failed step keeps its files, records the error and waits for Retry; nothing loops.
// Every cost goes through unedit_spend, which refuses past the monthly Studio budget. Nothing posts without the
// Approve tap, and real footage is never labeled AI-generated.
import 'server-only';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { head, put } from '@vercel/blob';
import os from 'node:os';
import path from 'node:path';
import { adminDb } from '@/lib/supabase/admin';
import { siteOrigin } from '@/lib/cron';
import { clipGroups, clipPieces, episodeCaptionsAss, extractAudio, finishClip, fontsDir, frames, presigned, sweepTmp, probe, renderClip, toSdr, type Probe, type Span, type Word } from '@/lib/unedit-media';
import { costCents, defaultProvider, transcribe, type Provider } from '@/lib/unedit-transcribe';
import { directEpisode, pickStills, planVlog, redoClip, sentences, type Chapter, type Pick } from '@/lib/unedit-moments';
import { LOOKS, renderThumb } from '@/lib/unedit-thumb';
import type { Shot } from '@/lib/unedit-shots';
import type { Cue } from '@/lib/unedit-cues';
import { editList, within, type Edit } from '@/lib/unedit-edit';
import { FILL, NEUTRAL, analyzeLook, episodeSize, framing, gradeFilter, sampleTimes, type Box, type Look } from '@/lib/unedit-look';
import { parseSheet, placeNews, type NewsEntry } from '@/lib/unedit-news';
import { musicBed } from '@/lib/unedit-music';
import { claimForUpload } from '@/lib/newsroom';
import { runwayConfigured, runwayTask, runwayTextVideo } from '@/lib/runway';
import { cutoutOn, faceOnFrame, packageOf, styleGraphics, STYLEBOOK_VERSION, type BaseGraphic } from '@/lib/unedit-style';
import { PACKAGES, RULES } from '@/data/unedit-stylebook';
import { assemble, effectSounds, epTime, layReel, overlayPart, partOverlays, planParts, renderPart, shotCrops, splitBoxes, picKey, WORKERS, type EpGraphic, type EpisodePlan, type Graphics, type Part } from '@/lib/unedit-episode';
import { renderOnSandbox, screenLinks } from '@/lib/unedit-pro';
import { qaEpisode } from '@/lib/unedit-qa';
import { proConfigured, proProps, renderPro } from '@/lib/unedit-pro';
import { GENOVUS_BLOG_ID, metricoolConfigured, metricoolLive, postStatus, schedulePost } from '@/lib/metricool';

export type Stage = 'uploaded' | 'transcribing' | 'finding' | 'rendering' | 'review' | 'publishing' | 'published' | 'failed';
export type Vlog = {
  id: string; tenant_id: string; title: string | null; file_name: string | null; blob_path: string; blob_url: string; bytes: number; fingerprint: string;
  duration_s: number | null; width: number | null; height: number | null; rotation: number | null; vcodec: string | null;
  stage: Stage; stage_at: string; lease_until: string | null; attempts: number; error: string | null; provider: Provider | 'mock' | null;
  transcript_blob: string | null; words: number | null; episode: { title?: string; description?: string; tags?: string[]; dropped?: string[] };
  thumbs: { blob: string; text: string; t: number; look: string }[]; thumb_pick: number | null; cost_cents: number; created_at: string; approved_at: string | null;
  // Episode Pro (null on recordings made before it: their episode posts as recorded)
  audio_blob: string | null; edit: Edit | null; look: Look | null; episode_plan: EpisodePlan | null; episode_path: string | null;
  /** Newsroom: the approved sources sheet (lib/unedit-news.ts); null on ordinary recordings. */
  sources?: NewsEntry[] | null;
  /** Faceless (lib/unedit-faceless.ts): narration over the moving background; null on a real take. */
  faceless?: { voice: string; production: string; length: string } | null;
};
export type Clip = {
  id: string; vlog_id: string; n: number; start_s: number; end_s: number; hook_start_s: number | null; hook_end_s: number | null;
  title: string; caption: string; copy: { instagram?: string; facebook?: string; youtube?: string }; features: Record<string, unknown>;
  blob_path: string | null; secs: number | null; status: 'rendering' | 'ready' | 'approved' | 'redo' | 'dropped' | 'failed'; note: string | null; error: string | null;
};
export type UPost = { id: string; vlog_id: string; clip_id: string | null; platform: 'instagram' | 'facebook' | 'youtube'; kind: 'reel' | 'short' | 'video'; title: string | null; body: string; status: string; mc_post_id: number | null; mc_status: string | null; mc_error: string | null; posted_url: string | null };

// 'transcribing' is runnable too: a step cut off mid-transcription starts again from the recording.
const RUNNABLE: Stage[] = ['uploaded', 'transcribing', 'finding', 'rendering', 'publishing'];
const LEASE_MIN = 14;
const dbx = () => adminDb();
const log = (action: string, subject: string, after: Record<string, unknown>) => dbx().rpc('unedit_log', { p_action: `studio.unedit.${action}`, p_subject: subject, p_after: after });
const spend = async (id: string, cents: number, what: string) => { const r = await dbx().rpc('unedit_spend', { p_vlog: id, p_cents: cents, p_what: what }); if (r.error) throw new Error(r.error.message); };
const dir = (v: { id: string }) => `studio/vlogs/${v.id}`;

export async function genovusTenant(): Promise<string> {
  const { data } = await dbx().from('tenants').select('id').eq('slug', 'genovus').single();
  if (!data) throw new Error('The genovus tenant is missing.');
  return data.id as string;
}

// ---- registration ----------------------------------------------------------------------------------------------
const FP = /^[0-9]+:[0-9a-f]{64}:[0-9a-f]{64}$/;
/** Register an uploaded recording. The same file (same size and first/last 4 MB) opens the job it already has. */
export async function registerVlog(f: { blobPath: string; blobUrl: string; bytes: number; fingerprint: string; fileName: string; by: string }): Promise<{ id: string; existing: boolean }> {
  if (!/^studio\/vlogs\/uploads\/[A-Za-z0-9._/-]+\.(mp4|mov|m4v|webm)$/i.test(f.blobPath)) throw new Error('That upload is not an Unedit recording.');
  if (!FP.test(f.fingerprint) || !(f.bytes > 0)) throw new Error('The upload is missing its fingerprint.');
  const tenant = await genovusTenant();
  const { data: had } = await dbx().from('unedit_vlogs').select('id').eq('tenant_id', tenant).eq('fingerprint', f.fingerprint).maybeSingle();
  if (had) return { id: had.id as string, existing: true };
  const title = f.fileName.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').slice(0, 120);
  const { data, error } = await dbx().from('unedit_vlogs').insert({ tenant_id: tenant, title, file_name: f.fileName.slice(0, 200), blob_path: f.blobPath, blob_url: f.blobUrl, bytes: f.bytes, fingerprint: f.fingerprint, created_by: f.by }).select('id').single();
  if (error) {
    // Two taps on the same file at once: the unique fingerprint keeps one job.
    const { data: again } = await dbx().from('unedit_vlogs').select('id').eq('tenant_id', tenant).eq('fingerprint', f.fingerprint).maybeSingle();
    if (again) return { id: again.id as string, existing: true };
    throw new Error(error.message);
  }
  await log('upload', data.id as string, { bytes: f.bytes, file: f.fileName });
  // Newsroom: a production waiting for the next upload hands this recording its sources sheet.
  await claimForUpload(tenant, data.id as string).catch((e) => console.error('[unedit] newsroom sheet not attached:', e instanceof Error ? e.message : e));
  return { id: data.id as string, existing: false };
}

// ---- the runner -----------------------------------------------------------------------------------------------
/** Claim the vlog's next step (single-flight): the row if this caller holds the lease, else null. */
export async function claim(id: string): Promise<Vlog | null> {
  const now = new Date().toISOString();
  const { data } = await dbx().from('unedit_vlogs')
    .update({ lease_until: new Date(Date.now() + LEASE_MIN * 60_000).toISOString() })
    .eq('id', id).is('error', null).in('stage', RUNNABLE).or(`lease_until.is.null,lease_until.lt.${now}`)
    .select('*');
  return (data?.[0] as Vlog | undefined) ?? null;
}
const release = (id: string, patch: Record<string, unknown> = {}) => dbx().from('unedit_vlogs').update({ lease_until: null, ...patch }).eq('id', id);
const advance = (id: string, stage: Stage, patch: Record<string, unknown> = {}) => release(id, { stage, stage_at: new Date().toISOString(), attempts: 0, ...patch });

/** Vlogs with a step to take: the cron kicks each one (the step route claims, so a double kick is harmless). */
export async function runnable(): Promise<string[]> {
  const { data } = await dbx().from('unedit_vlogs').select('id').in('stage', RUNNABLE).is('error', null).or(`lease_until.is.null,lease_until.lt.${new Date().toISOString()}`).limit(10);
  return (data ?? []).map((r) => r.id as string);
}
export async function kick(origin: string, id: string): Promise<void> {
  if (!process.env.CRON_SECRET) return;
  // In production always call the public domain: the cron runs on the deployment's *.vercel.app URL, which sits behind
  // Vercel's login wall and answers a server-to-server POST with a 302 that never reaches this app (2026-11-12 stall).
  const base = process.env.VERCEL_ENV === 'production' ? siteOrigin() : origin;
  const r = await fetch(`${base}/api/studio/unedit/${id}/step`, { method: 'POST', redirect: 'manual', headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, signal: AbortSignal.timeout(20_000) })
    .catch((e) => { console.error(`[unedit] ${id} kick failed: ${e instanceof Error ? e.message : e}`); return null; });
  if (r && !r.ok) console.error(`[unedit] ${id} kick answered ${r.status} from ${base}`);
}

async function readWords(v: Vlog): Promise<Word[]> {
  if (!v.transcript_blob) throw new Error('The transcript is missing.');
  const r = await fetch(await presigned(v.transcript_blob, 10), { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`Couldn't read the transcript (${r.status}).`);
  return ((await r.json()) as { words: Word[] }).words;
}
const probeOf = (v: Vlog): Probe => ({ duration: Number(v.duration_s ?? 0), width: Number(v.width ?? 1080), height: Number(v.height ?? 1920), rotation: Number(v.rotation ?? 0), vcodec: v.vcodec ?? '', acodec: '' });

/** Take the vlog's next step. Returns what happened, in words (for logs and the toast). */
export async function step(v: Vlog, origin: string): Promise<string> {
  const subject = v.id;
  try {
    if (v.stage === 'uploaded' || v.stage === 'transcribing') {
      const src = await presigned(v.blob_path, 60);
      const p = await probe(src);
      if (p.duration < 20) throw new Error(`This recording is ${Math.round(p.duration)} seconds; Unedit needs at least 20.`);
      if (p.duration > 45 * 60) throw new Error('Unedit takes recordings up to 45 minutes.');
      await dbx().from('unedit_vlogs').update({ duration_s: p.duration, width: p.width, height: p.height, rotation: p.rotation, vcodec: p.vcodec, stage: 'transcribing', stage_at: new Date().toISOString() }).eq('id', v.id);
      const provider = defaultProvider();
      // The cost is known from the length, so it is charged (and checked against the budget) before the call.
      await spend(v.id, costCents(provider, p.duration), `transcription (${provider})`);
      // One read of the recording gives the small MP3 for transcription and the full-quality soundtrack for the episode.
      const { mp3, m4a } = await extractAudio(src, true);
      const audioPath = `${dir(v)}/audio.m4a`;
      await put(audioPath, m4a, { access: 'private', contentType: 'audio/mp4', addRandomSuffix: false, allowOverwrite: true });
      const t = await transcribe(mp3, p.duration, provider);
      const path = `${dir(v)}/transcript-${provider}.json`;
      await put(path, JSON.stringify({ provider, words: t.words }), { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true });
      await advance(v.id, 'finding', { provider, transcript_blob: path, words: t.words.length, audio_blob: audioPath });
      await log('transcribed', subject, { provider, words: t.words.length, secs: Math.round(p.duration), cents: t.cents });
      return `Transcribed ${t.words.length} words with ${provider}.`;
    }
    if (v.stage === 'finding') {
      const words = await readWords(v);
      const plan = await planVlog(words);
      await spend(v.id, plan.cents, 'clip plan (Claude)');
      if (!plan.clips.length) throw new Error(`No clip stood on its own${plan.dropped.length ? ` (${plan.dropped.slice(0, 3).join('; ')})` : ''}. Try a recording with a few clear points.`);
      await dbx().from('unedit_clips').delete().eq('vlog_id', v.id);
      const rows = plan.clips.map((c, i) => clipRow(v, i + 1, c));
      const ins = await dbx().from('unedit_clips').insert(rows);
      if (ins.error) throw new Error(ins.error.message);
      // Episode Pro: what the full episode keeps, how it looks, and its parts (rendered in parallel after the clips).
      const pro = await planEpisode(v, words, plan.falseStarts, plan.episode.title);
      const chapters = pro.episode_plan?.graphics?.chapters;
      const description = chapters ? `${plan.episode.description}\n\n${chapters}` : plan.episode.description;
      await advance(v.id, 'rendering', { title: plan.episode.title, episode: { ...plan.episode, description, dropped: plan.dropped, thumb_lines: plan.thumbs }, ...pro });
      await log('planned', subject, { clips: plan.clips.length, dropped: plan.dropped.length, cents: plan.cents });
      return `Picked ${plan.clips.length} clip${plan.clips.length === 1 ? '' : 's'}.`;
    }
    if (v.stage === 'rendering') {
      const src = await presigned(v.blob_path, 60);
      const { data: todo } = await dbx().from('unedit_clips').select('*').eq('vlog_id', v.id).in('status', ['rendering', 'redo']).order('n');
      const clips = (todo ?? []) as Clip[];
      // Redo with a note: Claude picks a new or tightened moment for that clip first.
      for (const c of clips.filter((x) => x.status === 'redo')) {
        const words = await readWords(v);
        const { data: others } = await dbx().from('unedit_clips').select('start_s, end_s').eq('vlog_id', v.id).neq('id', c.id).neq('status', 'dropped');
        const r = await redoClip(words, { title: c.title, from: Number(c.start_s), to: Number(c.end_s), note: c.note ?? '' }, (others ?? []).map((o) => ({ from: Number(o.start_s), to: Number(o.end_s) })));
        await spend(v.id, r.cents, 'clip redo (Claude)');
        if (!r.pick) { await dbx().from('unedit_clips').update({ status: 'ready', error: `The redo didn't find a better moment${r.why ? `: ${r.why}` : ''}. The clip is unchanged.` }).eq('id', c.id); continue; }
        const row = clipRow(v, c.n, r.pick);
        await dbx().from('unedit_clips').update({ ...row, status: 'rendering', error: null }).eq('id', c.id);
        c.status = 'rendering';
      }
      const next = (await dbx().from('unedit_clips').select('*').eq('vlog_id', v.id).eq('status', 'rendering').order('n').limit(1)).data?.[0] as Clip | undefined;
      if (next) {
        const words = await readWords(v);
        const spans = clipSpans(v, next);
        const look = clipLook(v);
        // A long clip from an 8K recording renders as ~8 s groups in parallel workers (one function could not decode it
        // all inside its time limit); this step waits on a short lease until every group is stored, then joins them.
        let groups: string[] | null = null;
        if (needsFanout(v, spans)) {
          groups = await clipGroupsJoined(v, next, spans, look, origin);
          if (!groups) {
            await release(v.id, { lease_until: new Date(Date.now() + 40_000).toISOString() });
            return `Clip ${next.n}: its pieces are rendering in parallel.`;
          }
        }
        // Unedit Pro: the shot plan's accent words get the orange caption and a punch-in (clips planned before it have none).
        const shots = ((next.features as { shots?: Shot[] })?.shots ?? []);
        const accents = shots.map((s) => s.accent).filter((a): a is number => a != null);
        const cut = async (captions: boolean) => {
          if (groups) {
            await sweepTmp();
            const d = await fs.mkdtemp(`${os.tmpdir()}/unedit-clipfinish-`);
            try { const o = await finishClip(d, words, spans, { accents, captions, ...look }, 'clip.mp4', groups); return { bytes: await fs.readFile(o.file), secs: o.secs }; } finally { await fs.rm(d, { recursive: true, force: true }).catch(() => {}); }
          }
          const o = await renderClip(src, spans, words, probeOf(v), { accents, captions, ...look });
          try { return { bytes: await fs.readFile(o.file), secs: o.secs }; } finally { await fs.rm(o.dir, { recursive: true, force: true }).catch(() => {}); }
        };
        // Unedit Pro's graphics pass (Remotion on Vercel Sandbox) when it is configured; any failure falls back to the plain clip.
        let made: { bytes: Buffer; secs: number; pro: boolean } | null = null;
        let proError: string | null = null;
        if (proConfigured() && shots.length) {
          try {
            const base = await cut(false);
            const basePath = `${dir(v)}/clips/${next.n}-base.mp4`;
            await put(basePath, base.bytes, { access: 'private', contentType: 'video/mp4', addRandomSuffix: false, allowOverwrite: true, abortSignal: AbortSignal.timeout(180_000) });
            const cues = ((next.features as { cues?: Cue[] })?.cues ?? []);
            made = { bytes: await renderPro(await proProps(await presigned(basePath, 120), words, spans, shots, accents, cues)), secs: base.secs, pro: true };
          } catch (e) {
            console.error(`[unedit] ${v.id} clip ${next.n}: Unedit Pro fell back to the plain clip: ${e instanceof Error ? e.message : e}`);
            // Said on the card, never silent: this clip is the plain cut, and Redo tries the graphics again.
            proError = `The graphics didn't render, so this is the plain cut (${(e instanceof Error ? e.message : String(e)).slice(0, 160)}). Redo to try again.`;
          }
        }
        made ??= { ...(await cut(true)), pro: false };
        const path = `${dir(v)}/clips/${next.n}-${Date.now()}.mp4`;
        await put(path, made.bytes, { access: 'private', contentType: 'video/mp4', addRandomSuffix: false, allowOverwrite: true, abortSignal: AbortSignal.timeout(180_000) });
        await dbx().from('unedit_clips').update({ blob_path: path, secs: Math.round(made.secs * 10) / 10, status: 'ready', error: proError, features: { ...(next.features ?? {}), pro: made.pro } }).eq('id', next.id);
        await release(v.id); // the route kicks the next clip right away, in a fresh function
        return `Rendered clip ${next.n}${made.pro ? ' (Unedit Pro)' : ''}.`;
      }
      if (!v.thumbs?.length) {
        await makeThumbs(v, src);
      }
      // Episode Pro: start the part workers, wait for them, then join the episode (each its own step).
      if (v.episode_plan && !v.episode_path && !v.episode_plan.error) return await episodeStep(v, origin);
      await advance(v.id, 'review');
      await log('ready', subject, {});
      return 'Ready for review.';
    }
    if (v.stage === 'publishing') {
      const r = await distribute(v);
      await advance(v.id, 'published');
      await log('published', subject, r);
      return `Sent ${r.sent} post${r.sent === 1 ? '' : 's'} to Metricool${r.live ? '' : ' as drafts'}${r.failed.length ? `; ${r.failed.length} failed` : ''}.`;
    }
    await release(v.id);
    return 'Nothing to do.';
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 500) : 'Unknown error';
    await release(v.id, { error: msg, attempts: v.attempts + 1 });
    await log('error', subject, { stage: v.stage, error: msg });
    console.error(`[unedit] ${v.id} ${v.stage}: ${msg}`);
    return `Stopped: ${msg}`;
  }
}

function clipRow(v: Vlog, n: number, c: Pick) {
  return { tenant_id: v.tenant_id, vlog_id: v.id, n, start_s: c.from, end_s: c.to, hook_start_s: c.hookFrom, hook_end_s: c.hookTo, title: c.title, caption: c.caption, copy: c.copy, features: c.features, status: 'rendering', blob_path: null, secs: null, note: null };
}

// ---- Episode Pro ------------------------------------------------------------------------------------------------
const PARALLEL = WORKERS();
const PART_LEASE_MIN = 14;
const PART_TRIES = 3;
/** The cut-out must be finished this long after a part starts (the function stops at 800 s). */
const CUTOUT_BUDGET_MS = 600_000;
/** A part waits for the graphics reel at most this long after it starts. */
const REEL_WAIT_MS = 420_000;
/** The cut-out's own budget once the overlay starts (a part that reused its stored picture has more room). */
const CUTOUT_ALONE_MS = 600_000;
const partPath = (v: { id: string }, k: number) => `${dir(v)}/episode/part-${String(k).padStart(3, '0')}.mp4`;

/** The episode's edit, look and parts, from the transcript (at the end of 'finding'). A recording with too little
 *  talk left after the edit keeps posting as recorded (no plan). */
async function planEpisode(v: Vlog, words: Word[], falseStarts: string[], title = ''): Promise<{ edit: Edit; look: Look | null; episode_plan: EpisodePlan | null; episode_path: null }> {
  const edit = editList(words, Number(v.duration_s ?? 0), falseStarts);
  // UNEDIT_EPISODE=off turns Episode Pro off without a redeploy: the episode posts as recorded, clips keep the edit.
  if (process.env.UNEDIT_EPISODE === 'off' || !edit.keep.length || edit.secs < 15) return { edit, look: null, episode_plan: null, episode_path: null };
  const src0 = await presigned(v.blob_path, 60);
  // Faceless: there is no face to find or grade, and camera sizes would only zoom into the background, so one steady
  // full frame carries it and the graphics and illustrations do the cutting.
  if (v.faceless) edit.segs = edit.segs.map((s) => ({ ...s, cam: 'wide' as const }));
  const sdr = v.faceless ? '' : await toSdr((await probe(src0)).hdr);
  const look: Look = v.faceless ? { face: null, grade: NEUTRAL, stats: { warmth: 0, faceY: null, sat: 1 }, cents: 0, sdr: '' } : await analyzeLook(src0, edit.keep, sdr);
  if (look.cents) await spend(v.id, look.cents, 'episode look (Claude)');
  const src = { width: Number(v.width ?? 1920), height: Number(v.height ?? 1080) };
  const parts = planParts(edit.segs, src, edit.secs);
  await spend(v.id, await splitBoxes(src0, parts), 'episode framing of split shots (Claude)');
  await dbx().from('unedit_episode_parts').delete().eq('vlog_id', v.id);
  const ins = await dbx().from('unedit_episode_parts').insert(parts.map((p) => ({ vlog_id: v.id, k: p.k, tenant_id: v.tenant_id, segs: p.segs })));
  if (ins.error) throw new Error(ins.error.message);
  await log('episode-planned', v.id, { keep: edit.keep.length, secs: edit.secs, removed: edit.removed, cuts: edit.cuts.length, parts: parts.length, face: Boolean(look.face), grade: look.grade });
  // The graphics layer: the long-form director's chapters and cues, plus the title, lower-third and end card.
  let graphics: Graphics | undefined;
  try {
    // Graphics render in the Remotion sandbox (UNEDIT_PRO); UNEDIT_EPISODE_GRAPHICS=off turns just them off.
    if (proConfigured() && process.env.UNEDIT_EPISODE_GRAPHICS !== 'off') graphics = await planGraphics(v, words, edit, title, { face: look.face, src, size: episodeSize(src) });
  } catch (e) {
    graphics = { items: [], error: `the graphics plan failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300) };
  }
  return { edit, look, episode_plan: { size: episodeSize(src), src, face: look.face, grade: look.grade, sdr, parts: parts.length, secs: edit.secs, graphics }, episode_path: null };
}

const END_CTA = () => (process.env.UNEDIT_END_CTA || 'Follow for more').trim();
const LOWER = () => (process.env.UNEDIT_LOWER_THIRD || 'Genovus').trim();
const LOWER_SUB = () => (process.env.UNEDIT_LOWER_THIRD_SUB || 'genovus.io').trim();
const ts = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** The title as it goes on screen (style book: an opener over 8 words wraps into the speaker): the part after a colon
 *  ("Anthony's Studio Vlog: Chips, Coffee…" → "Chips, Coffee…"), else the first 8 words. The YouTube title is unchanged. */
export function screenTitle(t: string): string {
  const after = t.includes(':') ? t.slice(t.indexOf(':') + 1).trim() : t;
  const words = (after.split(/\s+/).length >= 2 ? after : t).split(/\s+/).filter(Boolean);
  return words.length <= 8 ? words.join(' ') : `${words.slice(0, 8).join(' ').replace(/[,;:–—-]+$/, '')}…`;
}

const KICKER = () => (process.env.UNEDIT_TITLE_KICKER || 'Genovus · Studio').trim();

/** Every graphic on the episode's timeline, before styling: the title, lower-third, chapters and end card, the
 *  director's kinetic phrases and emphasis words, and the clip cues. Chapters become YouTube chapters (0:00 first, at
 *  least 3, each at least 10 s) for the description. The show package styles them (lib/unedit-style.ts). */
async function planGraphics(v: Vlog, words: Word[], edit: Edit, title: string, frame: { face: Box | null; src: { width: number; height: number }; size: { width: number; height: number } }, pkgName: string | null = null): Promise<Graphics> {
  const secs = edit.secs;
  const ss = sentences(words);
  const keepSentences = ss.filter((x) => epTime(x.s, edit.keep) != null && epTime(x.e, edit.keep) != null).map((x) => x.i);
  const pkg = packageOf(pkgName);
  const dir = await directEpisode(words, keepSentences, secs, undefined, pkg, Boolean(v.faceless));
  await spend(v.id, dir.cents, 'episode director (Claude)');
  const base: BaseGraphic[] = [];
  if (title && secs > 12) base.push({ T: 0.2, D: 3.4, kind: 'title', text: screenTitle(title), sub: KICKER(), sound: 'whoosh' });
  if (secs > 20) base.push({ T: 4, D: 4, kind: 'lower', text: LOWER(), sub: LOWER_SUB(), sound: 'swish' });
  // Chapters: on the edited timeline, 10 s apart at least; the first is the episode's start.
  const chaps: { t: number; c: Chapter }[] = [];
  for (const c of dir.chapters) {
    const t = epTime(ss[c.s]?.s ?? -1, edit.keep);
    if (t == null) continue;
    const at = chaps.length ? t : 0;
    if (chaps.length && at - chaps[chaps.length - 1].t < 10) continue;
    chaps.push({ t: at, c });
  }
  chaps.forEach((x, i) => { if (i > 0 && x.t > 9 && x.t < secs - 8) base.push({ T: x.t, D: 3.2, kind: 'chapter', n: i + 1, text: x.c.title, sound: 'whoosh' }); });
  if (secs > 20) base.push({ T: Math.max(0, secs - 4.5), D: 4.5, kind: 'end', text: END_CTA(), sub: 'GENOVUS.IO', sound: 'sting' });
  // The director's words for the package: a kinetic phrase lands as its first word is said, an emphasis word a beat
  // before it is said (so it is on screen when the word is).
  for (const k of dir.kinetic) { const T = epTime(words[k.w].s, edit.keep); if (T != null) base.push({ T: Math.max(0, T - 0.1), D: 2.7, kind: 'kinetic', text: k.text, accent: k.accent, sound: 'pop' }); }
  for (const e of dir.emphasis) { const T = epTime(words[e.w].s, edit.keep); if (T != null) base.push({ T: Math.max(0, T - 0.4), D: 3, kind: 'emphasis', text: e.word, sound: null }); }
  for (const c of dir.cues) {
    const T = epTime(c.s, edit.keep);
    if (T == null) continue;
    const end = epTime(c.e, edit.keep) ?? T + 2;
    const D = Math.min(4, Math.max(1.6, end - T + 0.5));
    // The cue as Genovus Motion draws it, starting at its own frame 0 (list items: seconds after the cue starts).
    const items2 = c.items?.map((it) => {
      const first = it.split(' ')[0].toLowerCase().replace(/[^a-z0-9$%']/g, '');
      const k = words.findIndex((w, i) => i >= c.w && w.w.toLowerCase().replace(/[^a-z0-9$%']/g, '') === first);
      const at = k >= 0 ? epTime(words[k].s, edit.keep) : null;
      return { text: it, t: at != null ? Math.max(0, at - T) : 0 };
    });
    // Words copied from the transcript keep its punctuation; a figure card read "$4,000,000," (22809137). Trailing commas,
    // semicolons and colons come off whatever goes on screen.
    const tidy = <T,>(x: T): T => (typeof x === 'string' ? (x.replace(/[,;:\s]+$/, '') as T) : x);
    const cue = { t: 0, end: D, kind: c.kind, text: tidy(c.text), icon: c.icon, items: items2?.map((it) => ({ ...it, text: tidy(it.text) })), value: tidy(c.value), prefix: c.prefix, suffix: tidy(c.suffix), screen: c.screen ? await screenLinks(c.screen) : null, sound: c.sound, cam: c.cam };
    base.push({ T, D, kind: 'cue', text: cue.text, cue, sound: c.sound });
  }
  // B-roll: each director moment starts a Runway illustration now (it renders while the parts do); the step waits for
  // the clips before the reel. Abstract or generic shots only, labelled "Illustration" on screen. UNEDIT_BROLL=off.
  const brollFail: string[] = [];
  if (BROLL_ON() && runwayConfigured()) {
    for (const b of dir.broll) {
      const T = epTime(ss[b.s]?.s ?? -1, edit.keep);
      if (T == null || T < 6 || T > secs - 10) continue;
      try {
        const job = await runwayTextVideo({ prompt: b.prompt, duration: 8 });
        await spend(v.id, BROLL_CENTS, 'B-roll illustration (Runway)');
        // An 8 s shot: 4 s of it over a talking head, 6 s when the illustrations carry a faceless video.
        base.push({ T: T + 0.3, D: v.faceless ? 6 : 4, kind: 'broll', text: 'Illustration', broll: { prompt: b.prompt, task: job.id }, sound: 'whoosh' });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[unedit] ${v.id} B-roll not started: ${msg}`);
        brollFail.push(msg);
      }
    }
  }
  // Said on the card and in Studio Live, never only in the logs (Runway ran out of credits on 2026-11-15 unseen).
  const brollNote = brollFail.length ? [`B-roll ${brollFail.length} illustration${brollFail.length === 1 ? '' : 's'} not made: ${/credits/i.test(brollFail[0]) ? 'the Runway account is out of credits. Add credits in Runway, then ask Helix to add the graphics again.' : brollFail[0].slice(0, 160)}`] : [];
  // Newsroom: every fact on the approved sources sheet, where its words are said (never placed by a model).
  const placed = v.sources?.length ? placeNews(v.sources, words, (s) => epTime(s, edit.keep), secs) : { items: [], notes: [] };
  for (const n of placed.items) base.push({ T: n.T, D: n.D, kind: n.kind, text: n.text, news: n.news, sound: n.sound });
  const chapters = chaps.length >= 3 ? `Chapters\n${chaps.map((x) => `${ts(x.t)} ${x.c.title}`).join('\n')}` : undefined;
  const s = styled(base, pkg, frame, secs);
  return { ...s, notes: [...brollNote, ...placed.notes, ...(s.notes ?? [])], chapters, error: null };
}

/** Style the plan with a show package and lay out the reel (also used when the card changes the package). */
function styled(base: BaseGraphic[], pkg: string, frame: { face: Box | null; src: { width: number; height: number }; size: { width: number; height: number } }, secs: number): Omit<Graphics, 'chapters' | 'error'> {
  const ctx = { landscape: frame.size.width > frame.size.height, cutout: cutoutOn(), face: faceOnFrame(frame.face, frame.src, frame.size) };
  const { items, notes, gl } = styleGraphics(base, pkg, ctx, secs);
  const laid = layReel(items);
  const cuts = RULES.transitionAtChapters ? items.filter((g) => g.kind === 'chapter' && g.T > 1).map((g) => Math.round(g.T * 1000) / 1000) : [];
  return { items: laid.items, reels: laid.reels, pkg, stylebook: STYLEBOOK_VERSION, base, notes, gl, cuts };
}

/** A clip's framing and grade from the recording's look: a face-aware 9:16 crop of a landscape source. */
function clipLook(v: Vlog): { crop?: ReturnType<typeof framing> | null; grade?: string | null; sdr?: string | null } {
  if (!v.look) return {};
  const src = { width: Number(v.width ?? 1080), height: Number(v.height ?? 1920) };
  const crop = src.width > src.height ? framing(v.look.face, src, { width: 1080, height: 1920 }, FILL.clip) : null;
  return { crop, grade: gradeFilter(v.look.grade), sdr: v.look.sdr || null };
}

async function kickPart(origin: string, id: string, k: number): Promise<void> {
  if (!process.env.CRON_SECRET) return;
  const base = process.env.VERCEL_ENV === 'production' ? siteOrigin() : origin;
  const r = await fetch(`${base}/api/studio/unedit/${id}/part/${k}`, { method: 'POST', redirect: 'manual', headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, signal: AbortSignal.timeout(20_000) })
    .catch((e) => { console.error(`[unedit] ${id} part ${k} kick failed: ${e instanceof Error ? e.message : e}`); return null; });
  if (r && !r.ok) console.error(`[unedit] ${id} part ${k} kick answered ${r.status} from ${base}`);
}

// ---- long 8K clips: rendered in groups by parallel workers ------------------------------------------------------
/** A clip's spans on the recording: the hook first (when it has one), then the moment, with the edit applied (no uh/um,
 *  false starts or long pauses inside a clip). */
function clipSpans(v: Vlog, c: Clip): Span[] {
  const raw: Span[] = [...(c.hook_start_s != null && c.hook_end_s != null ? [{ from: Number(c.hook_start_s), to: Number(c.hook_end_s) }] : []), { from: Number(c.start_s), to: Number(c.end_s) }];
  const edited = v.edit ? within(raw, v.edit.keep) : [];
  return edited.length ? edited : raw;
}
/** 8K decodes slowly on a function (a 56 s clip did not finish inside 800 s): past 15 s of 8K footage, fan out. */
const needsFanout = (v: Vlog, spans: Span[]) => Math.max(Number(v.width ?? 0), Number(v.height ?? 0)) > 4000 && spans.reduce((a, s) => a + (s.to - s.from), 0) > 15;
const groupPaths = (v: Vlog, c: Clip, spans: Span[], look: unknown) => {
  const key = createHash('sha256').update(JSON.stringify({ spans, look })).digest('hex').slice(0, 12);
  return clipGroups(spans).map((_, g) => `${dir(v)}/clips/${c.n}-${key}-g${g}.mkv`);
};
/** Every group stored: their links (the last pass reads them in order, straight from storage). Otherwise kick a
 *  worker on each missing group (unless one started in the last 14 minutes) and return null. */
async function clipGroupsJoined(v: Vlog, c: Clip, spans: Span[], look: unknown, origin: string): Promise<string[] | null> {
  const paths = groupPaths(v, c, spans, look);
  const have = await Promise.all(paths.map((p) => head(p).then(() => true, () => false)));
  if (have.some((h) => !h)) {
    await Promise.all(paths.map(async (p, g) => {
      if (have[g]) return;
      const lock = await head(`${p}.lock`).catch(() => null);
      if (lock && Date.now() - new Date(lock.uploadedAt).getTime() < 14 * 60_000) return;
      await put(`${p}.lock`, String(Date.now()), { access: 'private', contentType: 'text/plain', addRandomSuffix: false, allowOverwrite: true });
      await kickGroup(origin, v.id, c.n, g);
    }));
    return null;
  }
  return Promise.all(paths.map((p) => presigned(p, 60)));
}
async function kickGroup(origin: string, id: string, n: number, g: number): Promise<void> {
  if (!process.env.CRON_SECRET) return;
  const base = process.env.VERCEL_ENV === 'production' ? siteOrigin() : origin;
  const r = await fetch(`${base}/api/studio/unedit/${id}/clippiece/${n}/${g}`, { method: 'POST', redirect: 'manual', headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, signal: AbortSignal.timeout(20_000) })
    .catch((e) => { console.error(`[unedit] ${id} clip ${n} group ${g} kick failed: ${e instanceof Error ? e.message : e}`); return null; });
  if (r && !r.ok) console.error(`[unedit] ${id} clip ${n} group ${g} kick answered ${r.status} from ${base}`);
}
/** A group worker: render one group of a clip's spans and store it (lib/unedit-media.ts clipPieces). */
export async function renderClipGroup(id: string, n: number, g: number): Promise<string> {
  const { data: v0 } = await dbx().from('unedit_vlogs').select('*').eq('id', id).single();
  const { data: c0 } = await dbx().from('unedit_clips').select('*').eq('vlog_id', id).eq('n', n).single();
  if (!v0 || !c0) return 'No such clip.';
  const v = v0 as Vlog, c = c0 as Clip;
  const spans = clipSpans(v, c);
  const look = clipLook(v);
  const groups = clipGroups(spans);
  const p = groupPaths(v, c, spans, look)[g];
  if (!p || !groups[g]) return `Clip ${n} has no group ${g + 1}.`;
  if (await head(p).then(() => true, () => false)) return `Clip ${n} group ${g + 1} is already stored.`;
  await sweepTmp();
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'unedit-clipgroup-'));
  const t0 = Date.now();
  try {
    await clipPieces(d, await presigned(v.blob_path, 60), groups[g], probeOf(v), look, 'group.mkv');
    await put(p, await fs.readFile(path.join(d, 'group.mkv')), { access: 'private', contentType: 'video/x-matroska', addRandomSuffix: false, allowOverwrite: true, multipart: true });
    return `Clip ${n} group ${g + 1} of ${groups.length} in ${Math.round((Date.now() - t0) / 1000)} s.`;
  } finally { await fs.rm(d, { recursive: true, force: true }).catch(() => {}); }
}

/** Start a worker on every part that needs one (up to the worker limit). */
async function startParts(id: string, origin: string): Promise<number> {
  const { data } = await dbx().from('unedit_episode_parts').select('k, status, lease_until').eq('vlog_id', id).order('k');
  const now = Date.now();
  const open = (data ?? []).filter((p) => p.status === 'todo' || p.status === 'running');
  const running = open.filter((p) => p.status === 'running' && p.lease_until && Date.parse(p.lease_until) > now).length;
  const free = open.filter((p) => p.status === 'todo' || (p.status === 'running' && (!p.lease_until || Date.parse(p.lease_until) <= now)));
  const start = free.slice(0, Math.max(0, PARALLEL - running));
  await Promise.all(start.map((p) => kickPart(origin, id, p.k)));
  return start.length;
}

/** One step of the episode: start workers on parts that need one, or (all parts done) join the episode. */
async function episodeStep(v: Vlog, origin: string): Promise<string> {
  if (v.episode_plan?.graphics?.replan && v.edit) {
    // The card asked for a show package on an episode planned before the style book: plan its graphics fresh.
    const ep = v.episode_plan;
    let graphics: Graphics;
    try { graphics = await planGraphics(v, await readWords(v), v.edit, v.episode?.title ?? v.title ?? '', { face: ep.face, src: ep.src, size: ep.size }, ep.graphics!.pkg ?? null); }
    catch (e) { graphics = { items: [], error: `the graphics plan failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300) }; }
    await dbx().from('unedit_vlogs').update({ episode_plan: { ...ep, graphics } }).eq('id', v.id);
    await release(v.id);
    return `Planned the episode's graphics (${graphics.items.length}).`;
  }
  const g = v.episode_plan?.graphics;
  // The graphics reel and the parts render at the same time: the parts start now (each renders its picture, then
  // waits for the reel), and every missing chunk of the reel renders in its own sandbox, side by side. A failed reel
  // never stops the episode: it finishes without graphics and the card says so.
  const todo = (g?.reels ?? []).map((r, i) => (r.path ? -1 : i)).filter((i) => i >= 0);
  if (g?.items.length && g.reels && todo.length && !g.error) {
    const t0 = Date.now();
    await startParts(v.id, origin);
    try {
      const size = v.episode_plan!.size;
      await settleBroll(v, g);
      const brollLink = async (x: EpGraphic) => (x.broll?.path ? presigned(x.broll.path, 120) : null);
      const items = await Promise.all(g.items.map(async (x) => ({ at: x.off ?? 0, dur: x.D, kind: x.kind, text: x.text, sub: x.sub, n: x.n, cue: x.cue, style: x.style, accent: x.accent, maxW: x.maxW, news: x.news, media: await brollLink(x) })));
      const done = await Promise.all(todo.map(async (i) => {
        const r = g.reels![i];
        const bytes = await renderOnSandbox('UneditEpisodeCues', { width: size.width, height: size.height, items }, { codec: 'vp8', alpha: true, gl: Boolean(g.gl), frameRange: [Math.round(r.from * 30), Math.max(Math.round(r.from * 30), Math.round(r.to * 30) - 1)] });
        const path = `${dir(v)}/episode/graphics-${i}-${Date.now()}.webm`;
        await put(path, bytes, { access: 'private', contentType: 'video/webm', addRandomSuffix: false, allowOverwrite: true, multipart: true });
        return { i, path, bytes: bytes.length };
      }));
      const reels = g.reels.map((x, i) => ({ ...x, path: done.find((d) => d.i === i)?.path ?? x.path }));
      // Re-read the plan so nothing written meanwhile is lost (the parts only read it).
      const { data: cur } = await dbx().from('unedit_vlogs').select('episode_plan').eq('id', v.id).single();
      const ep = (cur?.episode_plan ?? v.episode_plan) as EpisodePlan;
      await dbx().from('unedit_vlogs').update({ episode_plan: { ...ep, graphics: { ...ep.graphics!, reels } } }).eq('id', v.id);
      await log('episode-graphics', v.id, { chunks: todo.length, of: g.reels.length, ms: Date.now() - t0, bytes: done.reduce((a, d) => a + d.bytes, 0) });
      await release(v.id);
      return `Rendered the episode's graphics (${todo.length} chunk${todo.length === 1 ? '' : 's'} side by side).`;
    } catch (e) {
      const why = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      const { data: cur } = await dbx().from('unedit_vlogs').select('episode_plan').eq('id', v.id).single();
      const ep = (cur?.episode_plan ?? v.episode_plan) as EpisodePlan;
      await dbx().from('unedit_vlogs').update({ episode_plan: { ...ep, graphics: { ...ep.graphics!, error: `the graphics didn't render (${why})` } } }).eq('id', v.id);
      console.error(`[unedit] ${v.id} episode graphics: ${why}`);
      await release(v.id);
      return `The episode's graphics didn't render (${why}); the episode continues without them.`;
    }
  }
  const { data } = await dbx().from('unedit_episode_parts').select('k, status, lease_until, attempts, error, blob_path').eq('vlog_id', v.id).order('k');
  const parts = (data ?? []) as { k: number; status: string; lease_until: string | null; attempts: number; error: string | null; blob_path: string | null }[];
  if (!parts.length) throw new Error('The episode has no parts to render. Retry plans it again.');
  // A failed episode never holds the clips back: the card says so (with a retry) and the full video goes as recorded.
  const giveUp = async (why: string) => {
    await dbx().from('unedit_vlogs').update({ episode_plan: { ...v.episode_plan, error: why.slice(0, 300) } }).eq('id', v.id);
    await log('episode-failed', v.id, { why });
    await advance(v.id, 'review');
    return `The polished episode didn't finish (${why}); the clips are ready for review.`;
  };
  const failed = parts.find((p) => p.status === 'failed');
  if (failed) return await giveUp(`part ${failed.k + 1} failed ${PART_TRIES} times: ${failed.error ?? 'unknown error'}`);
  const open = parts.filter((p) => p.status !== 'done');
  if (open.length) {
    const now = Date.now();
    const started = await startParts(v.id, origin);
    // Hold the recording while the workers run: the last one to finish kicks this step; the cron covers a lost kick.
    await release(v.id, { lease_until: new Date(now + 3 * 60_000).toISOString() });
    return `Polishing the episode: ${parts.length - open.length} of ${parts.length} parts done${started ? `, started ${started}` : ''}.`;
  }
  // Every part is done: one soundtrack for the whole episode, the parts joined without re-encoding.
  const t0 = Date.now();
  const path = `${dir(v)}/episode/episode-${Date.now()}.mp4`;
  const urls = await Promise.all(parts.map((p) => presigned(p.blob_path ?? partPath(v, p.k), 120)));
  const sound = await presigned(v.audio_blob ?? v.blob_path, 120);
  try {
    const graphicsOn = Boolean(g?.reels?.length && g.reels.every((r) => r.path) && !g.error);
    const bed = await musicBed(); // the approved series score (lib/unedit-music.ts), or none
    await assemble(sound, v.edit?.keep ?? [], urls, (body) => put(path, body, { access: 'private', contentType: 'video/mp4', addRandomSuffix: false, allowOverwrite: true, multipart: true }), graphicsOn ? effectSounds(g!.items) : [], bed ? (/^https?:/.test(bed) ? bed : await presigned(bed, 120)) : null);
  } catch (e) { return await giveUp(`joining the parts: ${e instanceof Error ? e.message : String(e)}`); }
  // The quality check (lib/unedit-qa.ts): a finishing editor's look at every graphic on the finished episode. A graphic
  // that fails is left out and the episode re-renders once; after that, anything left is reported on the card.
  let plan: EpisodePlan = { ...v.episode_plan!, path, at: new Date().toISOString() };
  if (g && !g.error && g.items.length && process.env.UNEDIT_QA !== 'off') {
    const qa = await qaEpisode(await presigned(path, 60), g.items);
    await spend(v.id, qa.cents, 'episode quality check (Claude)');
    const say = (x: { i: number; problem: string }) => `${g.items[x.i].kind} “${g.items[x.i].text}”: ${x.problem}`;
    // A sourced fact (newsroom chip, quote, timeline, ticker) is never dropped by the check: a person fixes it.
    const FACTS = new Set(['source', 'quote', 'timeline', 'ticker']);
    const drops = qa.issues.filter((x) => x.drop && !FACTS.has(g.items[x.i].kind)).map((x) => g.items[x.i]);
    const fixedBefore = g.qa?.fixed ?? 0;
    if (drops.length && !fixedBefore && g.base?.length) {
      const gone = (b: BaseGraphic) => drops.some((d) => d.kind === b.kind && Math.abs(d.T - b.T) < 0.6 && d.text === b.text);
      const ep = v.episode_plan!;
      const graphics: Graphics = { ...g, ...styled((g.base as BaseGraphic[]).filter((b) => !gone(b)), g.pkg ?? packageOf(null), { face: ep.face, src: ep.src, size: ep.size }, ep.secs), error: null,
        qa: { at: new Date().toISOString(), ok: false, issues: qa.issues.map(say), fixed: drops.length, cents: qa.cents } };
      await dbx().from('unedit_episode_parts').update({ status: 'todo', attempts: 0, error: null, lease_until: null, blob_path: null }).eq('vlog_id', v.id);
      await dbx().from('unedit_vlogs').update({ episode_plan: { ...ep, graphics }, episode_path: null }).eq('id', v.id);
      await log('episode-qa', v.id, { issues: qa.issues.length, dropped: drops.length, refix: true });
      await release(v.id);
      return `Quality check: left out ${drops.length} graphic${drops.length === 1 ? '' : 's'}; rendering the episode again.`;
    }
    const left = qa.issues.map(say);
    plan = { ...plan, graphics: { ...g, qa: { at: new Date().toISOString(), ok: !left.length, issues: left, fixed: fixedBefore, cents: qa.cents + (g.qa?.cents ?? 0) } } };
    await log('episode-qa', v.id, { checked: qa.checked, issues: left.length, fixedBefore });
  }
  await dbx().from('unedit_vlogs').update({ episode_path: path, episode_plan: plan }).eq('id', v.id);
  await log('episode-ready', v.id, { path, parts: parts.length, secs: v.episode_plan?.secs, ms: Date.now() - t0 });
  await release(v.id);
  return `Finished the episode (${parts.length} parts).`;
}

/** A part worker (POST /api/studio/unedit/[id]/part/[k]): claim the part, frame each shot on the speaker, render,
 *  store. The last part to finish kicks the recording's next step. A part that fails PART_TRIES times stops the job. */
export async function renderEpisodePart(id: string, k: number, origin: string): Promise<string> {
  const now = new Date().toISOString();
  const { data: claimed } = await dbx().from('unedit_episode_parts')
    .update({ status: 'running', lease_until: new Date(Date.now() + PART_LEASE_MIN * 60_000).toISOString() })
    .eq('vlog_id', id).eq('k', k).or(`status.eq.todo,and(status.eq.running,lease_until.lt.${now})`)
    .select('*').maybeSingle();
  if (!claimed) return `Part ${k} is taken or done.`;
  await sweepTmp(); // a warm instance may hold folders from a part that was killed
  const tries = Number(claimed.attempts ?? 0) + 1;
  if (tries > PART_TRIES) {
    // Every earlier try was killed (out of time or memory: nothing was thrown, so nothing was recorded). Stop here
    // instead of re-claiming forever; the step reports it on the card.
    await dbx().from('unedit_episode_parts').update({ status: 'failed', error: `stopped after ${PART_TRIES} tries ran out of time or memory`, lease_until: null }).eq('vlog_id', id).eq('k', k);
    await release(id); await kick(origin, id);
    return `Part ${k + 1} stopped after ${PART_TRIES} tries.`;
  }
  await dbx().from('unedit_episode_parts').update({ attempts: tries }).eq('vlog_id', id).eq('k', k);
  const t0 = Date.now();
  try {
    const { data: row } = await dbx().from('unedit_vlogs').select('*').eq('id', id).single();
    const v = row as Vlog;
    if (!v.episode_plan) throw new Error('The episode has no plan.');
    const src = await presigned(v.blob_path, 120);
    const part: Part = { k, segs: claimed.segs as Part['segs'], status: 'todo' };
    // The part's place in the episode: its start is the length of the parts before it.
    const { data: before } = await dbx().from('unedit_episode_parts').select('segs').eq('vlog_id', id).lt('k', k);
    const p0 = (before ?? []).flatMap((b) => b.segs as Part['segs']).reduce((a, s) => a + (s.to - s.from), 0);
    const g0 = v.episode_plan.graphics;
    // Pacing (style book): slow push-ins on long shots, a zoom-blur punch at each chapter change. UNEDIT_MOTION=off skips both.
    const motion = process.env.UNEDIT_MOTION === 'off' ? undefined : { p0, cuts: g0?.error ? [] : g0?.cuts ?? [], push: { after: RULES.pushAfter, amount: RULES.pushAmount } };
    // The picture (framed, graded, moving) is kept apart from the graphics: a quality-check fix, a package switch or a
    // part that waited for the graphics reuses it instead of decoding the source again.
    const pic = `${dir(v)}/episode/pic-${String(k).padStart(3, '0')}-${picKey(part, v.episode_plan, motion)}.mp4`;
    let out: { file: string; dir: string; secs: number };
    const kept = await head(pic).catch(() => null);
    if (kept) {
      const d = await fs.mkdtemp(path.join(os.tmpdir(), 'unedit-ep-'));
      const r = await fetch(await presigned(pic, 30), { signal: AbortSignal.timeout(120_000) });
      if (!r.ok) throw new Error(`the stored picture didn't download (${r.status})`);
      await fs.writeFile(path.join(d, 'part.mp4'), Buffer.from(await r.arrayBuffer()));
      out = { file: path.join(d, 'part.mp4'), dir: d, secs: part.segs.reduce((a, s) => a + (s.to - s.from), 0) };
    } else {
      const { crops, cents } = await shotCrops(src, part, v.episode_plan);
      await spend(id, cents, `episode part ${k + 1} framing (Claude)`);
      out = await renderPart(src, part, crops, v.episode_plan, motion);
      await put(pic, await fs.readFile(out.file), { access: 'private', contentType: 'video/mp4', addRandomSuffix: false, allowOverwrite: true, abortSignal: AbortSignal.timeout(180_000) });
    }
    try {
      // The parts start while the graphics reel is still rendering: wait for it (it usually lands first), and if it
      // doesn't land in time, hand the part back without spending a try; the step starts it again once the reel is in.
      const ready = (x?: Graphics) => !x || x.error || !x.items.length || !x.reels?.length || x.reels.every((r) => r.path);
      let g = g0;
      while (!ready(g) && Date.now() - t0 < REEL_WAIT_MS) {
        await new Promise((r) => setTimeout(r, 10_000));
        g = ((await dbx().from('unedit_vlogs').select('episode_plan').eq('id', id).single()).data?.episode_plan as EpisodePlan | null)?.graphics;
      }
      if (!ready(g)) {
        await dbx().from('unedit_episode_parts').update({ status: 'todo', attempts: tries - 1, lease_until: null, ms: Date.now() - t0 }).eq('vlog_id', id).eq('k', k);
        return `Part ${k + 1}'s picture is stored; it waits for the graphics.`;
      }
      // Word-by-word captions for this part (burned in on the same encode as the graphics).
      const caps = CAPTIONS_ON() ? await writePartCaptions(v, out.dir, p0, out.secs, g && !g.error ? g.items : []).catch((e) => { console.error(`[unedit] ${id} part ${k} captions: ${e instanceof Error ? e.message : e}`); return false; }) : false;
      // The graphics reel's stretches for this part's place in the episode.
      if (g?.reels?.length && g.reels.every((r) => r.path) && !g.error && g.items.length) {
        const overlays = partOverlays(g.items, g.reels, p0, p0 + out.secs);
        const urls = await Promise.all(g.reels.map((r) => presigned(r.path!, 120)));
        // Text behind the speaker only on a first try and while the part has time for it (a retry, or a slow part,
        // lays those graphics in front instead). The budget counts from when the overlay starts.
        if (overlays.length || caps) await overlayPart(out.dir, urls, overlays, v.episode_plan.size, tries === 1 ? Math.min(t0 + CUTOUT_BUDGET_MS, Date.now() + CUTOUT_ALONE_MS) : 0, caps).catch((e) => console.error(`[unedit] ${id} part ${k} graphics: ${e instanceof Error ? e.message : e}`));
      } else if (caps) await overlayPart(out.dir, [], [], v.episode_plan.size, 0, true).catch((e) => console.error(`[unedit] ${id} part ${k} captions: ${e instanceof Error ? e.message : e}`));
      const path_ = partPath(v, k);
      await put(path_, await fs.readFile(out.file), { access: 'private', contentType: 'video/mp4', addRandomSuffix: false, allowOverwrite: true, abortSignal: AbortSignal.timeout(180_000) });
      await dbx().from('unedit_episode_parts').update({ status: 'done', blob_path: path_, secs: Math.round(out.secs * 100) / 100, ms: Date.now() - t0, error: null, lease_until: null }).eq('vlog_id', id).eq('k', k);
    } finally { await fs.rm(out.dir, { recursive: true, force: true }).catch(() => {}); }
    const { count } = await dbx().from('unedit_episode_parts').select('k', { count: 'exact', head: true }).eq('vlog_id', id).neq('status', 'done');
    if (!count) { await release(id); await kick(origin, id); }
    return `Rendered episode part ${k + 1} in ${Math.round((Date.now() - t0) / 1000)} s.`;
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 400);
    await dbx().from('unedit_episode_parts').update({ status: tries >= PART_TRIES ? 'failed' : 'todo', error: msg, lease_until: null, ms: Date.now() - t0 }).eq('vlog_id', id).eq('k', k);
    if (tries >= PART_TRIES) { await release(id); await kick(origin, id); } // the step reports the failure on the card
    console.error(`[unedit] ${id} episode part ${k}: ${msg}`);
    return `Part ${k + 1} failed: ${msg}`;
  }
}

// ---- B-roll ----------------------------------------------------------------------------------------------------
const BROLL_ON = () => process.env.UNEDIT_BROLL !== 'off';
const BROLL_CENTS = 80; // Veo 3.1 Fast through Runway: 10 credits a second, 8 s (the only length at 1080p)
/** Wait (up to ~4 minutes in all) for the episode's B-roll jobs, store each clip in Blob, and record it on the plan
 *  (mutating `g`). A job that fails or runs out of time leaves its slot empty: the speaker stays on screen. */
async function settleBroll(v: Vlog, g: Graphics): Promise<void> {
  const open = g.items.filter((x) => x.kind === 'broll' && x.broll?.task && !x.broll.path && !x.broll.failed);
  if (!open.length) return;
  const until = Date.now() + 240_000;
  await Promise.all(open.map(async (x, n) => {
    try {
      let t = await runwayTask(x.broll!.task!);
      while (!['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(t.status) && Date.now() < until) { await new Promise((r) => setTimeout(r, 6000)); t = await runwayTask(x.broll!.task!); }
      if (t.status !== 'SUCCEEDED' || !t.output?.[0]) { x.broll!.failed = t.failure ?? `still ${t.status.toLowerCase()}`; return; }
      const r = await fetch(t.output[0], { signal: AbortSignal.timeout(90_000) });
      if (!r.ok) throw new Error(`download ${r.status}`);
      const p = `${dir(v)}/episode/broll-${n}-${Date.now()}.mp4`;
      await put(p, Buffer.from(await r.arrayBuffer()), { access: 'private', contentType: 'video/mp4', addRandomSuffix: false, allowOverwrite: true });
      x.broll!.path = p;
    } catch (e) { x.broll!.failed = (e instanceof Error ? e.message : String(e)).slice(0, 160); }
  }));
  const { data: cur } = await dbx().from('unedit_vlogs').select('episode_plan').eq('id', v.id).single();
  const ep = (cur?.episode_plan ?? v.episode_plan) as EpisodePlan;
  if (ep.graphics) await dbx().from('unedit_vlogs').update({ episode_plan: { ...ep, graphics: { ...ep.graphics, items: g.items } } }).eq('id', v.id);
}

// ---- the episode's captions ------------------------------------------------------------------------------------
const CAPTIONS_ON = () => process.env.UNEDIT_EPISODE_CAPTIONS !== 'off';
/** Graphics that sit low in the frame or fill it: captions step aside while one is on screen. */
const CAPTION_CLEAR = new Set(['title', 'lower', 'kinetic', 'ticker', 'end', 'globe', 'chapter']);
/** Write this part's c.ass (and its fonts) into `dir`: the words said in it, on the part's own timeline, minus the
 *  windows where a low or full-frame graphic is up; the director's emphasis and kinetic words in orange. False when
 *  the part has no words to caption. */
async function writePartCaptions(v: Vlog, dir: string, p0: number, secs: number, items: EpGraphic[]): Promise<boolean> {
  if (!v.edit || !v.episode_plan) return false;
  const words = await readWords(v);
  const keep = v.edit.keep;
  const clear = items.filter((g) => CAPTION_CLEAR.has(g.kind)).map((g) => [g.T - 0.15, g.T + g.D + 0.1] as const);
  const key = items.filter((g) => g.kind === 'emphasis' || g.kind === 'kinetic').map((g) => ({ T: g.T, D: g.D, words: new Set(g.text.toLowerCase().split(/\s+/).map((x) => x.replace(/[^a-z0-9$%']/g, ''))) }));
  const out: Word[] = [];
  for (const w of words) {
    // Only words the episode actually keeps: a cut word touching a kept edge (an "um" just after a join) once
    // flashed on screen for a frame while its sound was gone.
    const mid = (w.s + w.e) / 2;
    if (!keep.some((k) => mid >= k.from && mid <= k.to)) continue;
    const a = epTime(w.s, keep), b = epTime(Math.max(w.s, w.e - 0.02), keep);
    if (a == null || b == null || a < p0 - 0.01 || a >= p0 + secs) continue;
    if (clear.some(([x, y]) => a < y && b > x)) continue;
    const bare = w.w.toLowerCase().replace(/[^a-z0-9$%']/g, '');
    const accent = key.some((e) => a >= e.T - 1 && a <= e.T + e.D + 1 && e.words.has(bare));
    out.push({ w: w.w, s: Math.max(0, a - p0), e: Math.min(secs, Math.max(b, a + 0.05) - p0), a: accent });
  }
  if (!out.length) return false;
  const serif = await fontsDir(dir);
  await fs.writeFile(path.join(dir, 'c.ass'), episodeCaptionsAss(out, v.episode_plan.size, serif));
  return true;
}

/** Three thumbnail options: Claude picks the three best stills of the speaker from eight, each gets a line and a look. */
async function makeThumbs(v: Vlog, src: string) {
  const dur = Number(v.duration_s ?? 60);
  // Sampled from the talk the edit keeps (never the walk-up or walk-off); polished like the episode.
  const at = v.edit?.keep.length ? sampleTimes(v.edit.keep, 8) : Array.from({ length: 8 }, (_, i) => Math.round(((i + 0.5) / 8) * dur * 10) / 10);
  const src2 = { width: Number(v.width ?? 1920), height: Number(v.height ?? 1080) };
  const c = v.look && v.episode_plan ? framing(v.look.face, src2, v.episode_plan.size, FILL.medium) : null;
  const pre = v.look ? [c ? `crop=${c.w}:${c.h}:${c.x}:${c.y}` : '', v.look.sdr, gradeFilter(v.look.grade)].filter(Boolean).join(',') : '';
  const small = await frames(src, at, 512);
  const { order, cents } = await pickStills(small);
  await spend(v.id, cents, 'thumbnail stills (Claude)');
  const lines = ((v.episode as { thumb_lines?: string[] }).thumb_lines ?? []).concat([v.episode.title ?? v.title ?? 'New video']).filter(Boolean);
  const big = await frames(src, order.map((i) => at[i]), 1280, false, pre);
  const thumbs: Vlog['thumbs'] = [];
  for (const [k, still] of big.entries()) {
    const look = LOOKS[k % LOOKS.length];
    const text = lines[k % lines.length];
    const jpg = await renderThumb(still, text, look, v.episode_plan?.graphics?.pkg ?? null);
    const path = `${dir(v)}/thumbs/${k + 1}-${look}.jpg`;
    await put(path, jpg, { access: 'private', contentType: 'image/jpeg', addRandomSuffix: false, allowOverwrite: true });
    thumbs.push({ blob: path, text, t: at[order[k]], look });
  }
  await dbx().from('unedit_vlogs').update({ thumbs, thumb_pick: 0 }).eq('id', v.id);
}

// ---- the card's taps ------------------------------------------------------------------------------------------
type Tap =
  | { tool: 'approve_clip' | 'drop_clip' | 'reopen_clip'; clip: string }
  | { tool: 'redo_clip'; clip: string; note: string }
  | { tool: 'edit_clip'; clip: string; title?: string; instagram?: string; facebook?: string; youtube?: string }
  | { tool: 'pick_thumb'; index: number }
  | { tool: 'edit_episode'; title?: string; description?: string }
  | { tool: 'retry' }
  | { tool: 'retry_episode' }
  | { tool: 'set_package'; pkg: string }
  | { tool: 'set_sources'; sheet: string }
  | { tool: 'drop_graphic'; kind: string; text: string; T: number }
  | { tool: 'approve' };

/** One tap on the card, by a staff member. Returns what changed, in words. */
export async function tap(id: string, t: Tap, by: string, origin: string): Promise<string> {
  const { data: v } = await dbx().from('unedit_vlogs').select('*').eq('id', id).single();
  if (!v) throw new Error('Recording not found.');
  const vlog = v as Vlog;
  const clipOf = async (cid: string) => {
    const { data } = await dbx().from('unedit_clips').select('*').eq('id', cid).eq('vlog_id', id).single();
    if (!data) throw new Error('Clip not found.');
    return data as Clip;
  };
  const inReview = () => { if (vlog.stage !== 'review') throw new Error(vlog.stage === 'published' || vlog.stage === 'publishing' ? 'This campaign is already approved.' : 'Wait until the clips are ready.'); };
  switch (t.tool) {
    case 'approve_clip': case 'drop_clip': case 'reopen_clip': {
      inReview();
      const c = await clipOf(t.clip);
      const status = t.tool === 'approve_clip' ? 'approved' : t.tool === 'drop_clip' ? 'dropped' : 'ready';
      if (status === 'approved' && !c.blob_path) throw new Error('This clip has no render yet.');
      await dbx().from('unedit_clips').update({ status }).eq('id', c.id);
      await log(t.tool, id, { clip: c.n });
      return status === 'approved' ? `Clip ${c.n} approved.` : status === 'dropped' ? `Clip ${c.n} left out.` : `Clip ${c.n} back on the card.`;
    }
    case 'redo_clip': {
      inReview();
      const c = await clipOf(t.clip);
      await dbx().from('unedit_clips').update({ status: 'redo', note: t.note.trim().slice(0, 400) || null, error: null }).eq('id', c.id);
      await advance(id, 'rendering');
      await log('redo', id, { clip: c.n, note: t.note.slice(0, 200) });
      await kick(origin, id);
      return `Redoing clip ${c.n}.`;
    }
    case 'edit_clip': {
      inReview();
      const c = await clipOf(t.clip);
      const copy = { ...c.copy, ...(t.instagram != null ? { instagram: t.instagram.slice(0, 2000) } : {}), ...(t.facebook != null ? { facebook: t.facebook.slice(0, 2000) } : {}), ...(t.youtube != null ? { youtube: t.youtube.slice(0, 95) } : {}) };
      await dbx().from('unedit_clips').update({ copy, ...(t.title ? { title: t.title.slice(0, 80) } : {}) }).eq('id', c.id);
      return 'Saved.';
    }
    case 'pick_thumb': {
      if (!(t.index >= 0 && t.index < (vlog.thumbs?.length ?? 0))) throw new Error('Pick one of the three thumbnails.');
      await dbx().from('unedit_vlogs').update({ thumb_pick: t.index }).eq('id', id);
      return `Thumbnail ${t.index + 1} goes with the video.`;
    }
    case 'edit_episode': {
      const episode = { ...vlog.episode, ...(t.title ? { title: t.title.slice(0, 95) } : {}), ...(t.description != null ? { description: t.description.slice(0, 4500) } : {}) };
      await dbx().from('unedit_vlogs').update({ episode }).eq('id', id);
      return 'Saved.';
    }
    case 'set_package': {
      // A different show package: restyle the planned graphics (no new director call) and render them again.
      inReview();
      const ep = vlog.episode_plan;
      const gr = ep?.graphics;
      if (!ep || ep.error || !vlog.edit) throw new Error('This episode has no polished version to restyle.');
      if (!PACKAGES[t.pkg]) throw new Error('Unknown show package.');
      if (gr?.pkg === t.pkg && !gr.error) return `Already ${PACKAGES[t.pkg].label}.`;
      const frame = { face: ep.face, src: ep.src, size: ep.size };
      // An episode planned before the style book has no base plan: the director plans it fresh (words and all).
      const graphics: Graphics = gr?.base?.length
        ? { ...gr, ...styled(gr.base as BaseGraphic[], t.pkg, frame, ep.secs), error: null, qa: undefined }
        : { items: [], pkg: t.pkg, replan: true, error: null }; // planned in the episode step (a director call can outlast this request)
      await dbx().from('unedit_episode_parts').update({ status: 'todo', attempts: 0, error: null, lease_until: null, blob_path: null }).eq('vlog_id', id);
      await dbx().from('unedit_vlogs').update({ episode_plan: { ...ep, graphics }, episode_path: null, stage: 'rendering', stage_at: new Date().toISOString(), lease_until: null }).eq('id', id);
      await log('set-package', id, { pkg: t.pkg, by });
      await kick(origin, id);
      return `Restyling the episode as ${PACKAGES[t.pkg].label}.`;
    }
    case 'drop_graphic': {
      // Studio Live: take one graphic out. The plan is restyled without it (no new director call) and the parts render
      // again, reusing their stored pictures, so only the overlay pass runs.
      inReview();
      const ep = vlog.episode_plan;
      const gr = ep?.graphics;
      if (!ep || ep.error || !vlog.edit || !gr?.base?.length) throw new Error('This episode has no graphics plan to change.');
      const same = gr.base.map((b, i) => ({ b, i })).filter((x) => x.b.kind === t.kind && x.b.text === t.text);
      if (!same.length) throw new Error('That graphic is not in the plan.');
      const pick = same.reduce((a, x) => (Math.abs(x.b.T - Number(t.T)) < Math.abs(a.b.T - Number(t.T)) ? x : a));
      const base = (gr.base as BaseGraphic[]).filter((_, i) => i !== pick.i);
      const graphics: Graphics = { ...gr, ...styled(base, gr.pkg ?? packageOf(null), { face: ep.face, src: ep.src, size: ep.size }, ep.secs), error: null, qa: undefined };
      await dbx().from('unedit_episode_parts').update({ status: 'todo', attempts: 0, error: null, lease_until: null, blob_path: null }).eq('vlog_id', id);
      await dbx().from('unedit_vlogs').update({ episode_plan: { ...ep, graphics }, episode_path: null, stage: 'rendering', stage_at: new Date().toISOString(), lease_until: null }).eq('id', id);
      await log('drop-graphic', id, { kind: t.kind, text: String(t.text).slice(0, 80), by });
      await kick(origin, id);
      return `Took out the ${t.kind === 'broll' ? 'B-roll' : t.kind}; the episode is rendering again (the pictures are reused).`;
    }
    case 'set_sources': {
      // Newsroom: the approved sources sheet. Saved as parsed entries; a line that doesn't parse stops the save, so
      // nothing half-sourced reaches the episode. If the episode is already polished, its graphics are planned again.
      if (vlog.stage === 'published' || vlog.stage === 'publishing') throw new Error('This campaign is already approved.');
      const { entries, errors } = parseSheet(String(t.sheet ?? '').slice(0, 20_000));
      if (errors.length) throw new Error(`Fix the sources sheet first: ${errors.slice(0, 3).join('; ')}.`);
      const ep = vlog.episode_plan;
      const replan = vlog.stage === 'review' && ep && !ep.error && vlog.edit;
      await dbx().from('unedit_vlogs').update({
        sources: entries.length ? entries : null,
        ...(replan ? { episode_plan: { ...ep, graphics: { items: [], pkg: ep.graphics?.pkg, replan: true, error: null } }, episode_path: null, stage: 'rendering', stage_at: new Date().toISOString(), lease_until: null } : {}),
      }).eq('id', id);
      if (replan) {
        await dbx().from('unedit_episode_parts').update({ status: 'todo', attempts: 0, error: null, lease_until: null, blob_path: null }).eq('vlog_id', id);
        await kick(origin, id);
      }
      await log('set-sources', id, { entries: entries.length, by });
      return `${entries.length} sourced ${entries.length === 1 ? 'item' : 'items'} saved${replan ? '; replanning the episode’s graphics' : '; they go on the episode when it’s polished'}.`;
    }
    case 'retry_episode': {
      // The polished episode stopped (the clips went on to review): fresh tries for its failed parts, before approval.
      inReview();
      const gr = vlog.episode_plan?.graphics;
      if (vlog.episode_plan && !vlog.episode_plan.error && gr?.error && gr.items.length) {
        // The episode finished without its graphics: render the reel again and lay it over every part.
        await dbx().from('unedit_episode_parts').update({ status: 'todo', attempts: 0, error: null, lease_until: null, blob_path: null }).eq('vlog_id', id);
        const graphics = { ...gr, error: null, reels: gr.reels?.map((r) => ({ from: r.from, to: r.to })) };
        await dbx().from('unedit_vlogs').update({ episode_plan: { ...vlog.episode_plan, graphics }, episode_path: null, stage: 'rendering', stage_at: new Date().toISOString(), lease_until: null }).eq('id', id);
        await log('retry-episode', id, { graphics: true });
        await kick(origin, id);
        return 'Adding the graphics to the episode again.';
      }
      if (vlog.episode_plan && !vlog.episode_plan.error && vlog.edit && (gr?.notes ?? []).some((n) => n.startsWith('B-roll '))) {
        // Illustrations were skipped (e.g. Runway out of credits): plan the graphics fresh, B-roll included, and
        // render every part again with them.
        await dbx().from('unedit_episode_parts').update({ status: 'todo', attempts: 0, error: null, lease_until: null, blob_path: null }).eq('vlog_id', id);
        await dbx().from('unedit_vlogs').update({ episode_plan: { ...vlog.episode_plan, graphics: { items: [], pkg: gr?.pkg, replan: true, error: null } }, episode_path: null, stage: 'rendering', stage_at: new Date().toISOString(), lease_until: null }).eq('id', id);
        await log('retry-episode', id, { replan: true });
        await kick(origin, id);
        return 'Planning the graphics again with the B-roll, then polishing the episode.';
      }
      if (!vlog.episode_plan?.error) return 'The episode is fine.';
      await dbx().from('unedit_episode_parts').update({ status: 'todo', attempts: 0, error: null, lease_until: null }).eq('vlog_id', id).neq('status', 'done');
      await dbx().from('unedit_vlogs').update({ episode_plan: { ...vlog.episode_plan, error: null }, stage: 'rendering', stage_at: new Date().toISOString(), lease_until: null }).eq('id', id);
      await log('retry-episode', id, {});
      await kick(origin, id);
      return 'Polishing the episode again.';
    }
    case 'retry': {
      if (!vlog.error) return 'Nothing to retry.';
      await dbx().from('unedit_vlogs').update({ error: null, lease_until: null }).eq('id', id);
      await dbx().from('unedit_clips').update({ status: 'rendering', error: null }).eq('vlog_id', id).eq('status', 'failed');
      // A failed episode part gets fresh tries.
      await dbx().from('unedit_episode_parts').update({ status: 'todo', attempts: 0, error: null, lease_until: null }).eq('vlog_id', id).eq('status', 'failed');
      await log('retry', id, { stage: vlog.stage });
      await kick(origin, id);
      return 'Trying again.';
    }
    case 'approve': {
      inReview();
      const { data: cs } = await dbx().from('unedit_clips').select('*').eq('vlog_id', id).order('n');
      const clips = (cs ?? []) as Clip[];
      if (clips.some((c) => c.status === 'ready')) throw new Error('Approve, redo or leave out every clip first.');
      const approved = clips.filter((c) => c.status === 'approved');
      const posts = [
        ...approved.flatMap((c) => [
          { platform: 'instagram', kind: 'reel', clip_id: c.id, title: c.title, body: c.copy.instagram || c.caption },
          { platform: 'facebook', kind: 'reel', clip_id: c.id, title: c.title, body: c.copy.facebook || c.caption },
          { platform: 'youtube', kind: 'short', clip_id: c.id, title: c.copy.youtube || c.title, body: c.caption },
        ]),
        { platform: 'youtube', kind: 'video', clip_id: null, title: vlog.episode.title || vlog.title || 'New video', body: vlog.episode.description ?? '' },
      ].map((p) => ({ ...p, tenant_id: vlog.tenant_id, vlog_id: id, ai_label: false }));
      await dbx().from('unedit_posts').delete().eq('vlog_id', id).eq('status', 'queued');
      const ins = await dbx().from('unedit_posts').insert(posts);
      if (ins.error) throw new Error(ins.error.message);
      await dbx().from('unedit_vlogs').update({ stage: 'publishing', stage_at: new Date().toISOString(), approved_by: by, approved_at: new Date().toISOString(), lease_until: null }).eq('id', id).eq('stage', 'review');
      await log('approve', id, { clips: approved.length, posts: posts.length, by });
      await kick(origin, id);
      return `Approved: ${posts.length} post${posts.length === 1 ? '' : 's'} going to Metricool${metricoolLive() ? '' : ' as drafts'}.`;
    }
  }
}

// ---- distribution -----------------------------------------------------------------------------------------------
/** Send the approved posts to Metricool on the Genovus brand. Media goes by presigned links (valid six days), which
 *  Metricool copies when it saves the post. Real footage: every AI flag is false. */
export async function distribute(v: Vlog): Promise<{ sent: number; skipped: string[]; failed: string[]; live: boolean }> {
  const out = { sent: 0, skipped: [] as string[], failed: [] as string[], live: metricoolLive() };
  const { data: rows } = await dbx().from('unedit_posts').select('*').eq('vlog_id', v.id).eq('status', 'queued');
  const posts = (rows ?? []) as UPost[];
  if (!metricoolConfigured()) {
    await dbx().from('unedit_posts').update({ status: 'skipped', mc_error: 'Metricool is not connected on this deployment.' }).eq('vlog_id', v.id).eq('status', 'queued');
    out.skipped.push('Metricool is not connected');
    return out;
  }
  const { data: cs } = await dbx().from('unedit_clips').select('id, blob_path').eq('vlog_id', v.id);
  const clipPath = new Map((cs ?? []).map((c) => [c.id as string, c.blob_path as string | null]));
  const thumb = v.thumbs?.[v.thumb_pick ?? 0]?.blob;
  const when = new Date(Date.now() + 15 * 60_000);
  const mins = 6 * 24 * 60;
  for (const p of posts) {
    // The full video is the polished episode when Episode Pro made one, else the recording as shot.
    const media = p.clip_id ? clipPath.get(p.clip_id) : (v.episode_path ?? v.blob_path);
    if (!media) { await dbx().from('unedit_posts').update({ status: 'skipped', mc_error: 'No video for this post.' }).eq('id', p.id); out.skipped.push(`${p.platform} ${p.kind}`); continue; }
    const r = await schedulePost({
      // A faceless video is narrated by an AI voice: the post says so and carries the platform's AI-content flag.
      blogId: GENOVUS_BLOG_ID(), network: p.platform, text: v.faceless && !/AI voice/i.test(p.body) ? `${p.body}

Narrated by an AI voice.` : p.body, title: p.title ?? undefined, mediaUrl: await presigned(media, mins), when,
      vertical: p.kind !== 'video', aiGenerated: Boolean(v.faceless), format: p.platform === 'youtube' ? undefined : 'reel',
      thumbnailUrl: p.kind === 'video' && thumb ? await presigned(thumb, mins) : undefined,
    });
    if (r.ok) { await dbx().from('unedit_posts').update({ status: 'sent', mc_post_id: r.data.id, mc_status: r.data.status, mc_error: null }).eq('id', p.id); out.sent++; }
    else { await dbx().from('unedit_posts').update({ status: 'error', mc_error: r.error }).eq('id', p.id); out.failed.push(`${p.platform} ${p.kind}: ${r.error}`); }
  }
  return out;
}

/** Every minute: posts Metricool has published get their live link; failures are recorded. */
export async function syncUneditPosts(): Promise<{ checked: number; posted: number }> {
  const out = { checked: 0, posted: 0 };
  if (!metricoolConfigured()) return out;
  const { data } = await dbx().from('unedit_posts').select('id, mc_post_id, mc_status').eq('status', 'sent').limit(25); // every in-flight state (SCHEDULED, PENDING, PUBLISHING, ...): 'sent' is never final
  for (const p of data ?? []) {
    out.checked++;
    const r = await postStatus(GENOVUS_BLOG_ID(), Number(p.mc_post_id));
    if (!r.ok) continue;
    if (r.data.status === 'PUBLISHED') { await dbx().from('unedit_posts').update({ status: 'posted', mc_status: 'PUBLISHED', posted_url: r.data.url }).eq('id', p.id); out.posted++; }
    else if (r.data.status === 'ERROR') await dbx().from('unedit_posts').update({ status: 'error', mc_status: 'ERROR', mc_error: r.data.detail ?? 'Metricool reported an error' }).eq('id', p.id);
    else if (r.data.status !== p.mc_status) await dbx().from('unedit_posts').update({ mc_status: r.data.status }).eq('id', p.id);
  }
  return out;
}
