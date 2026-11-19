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
import { clipDiskMB, clipGroups, clipPieces, episodeCaptionsAss, extractAudio, ffmpeg, finishClip, fontsDir, frames, presigned, sweepTmp, probe, renderClip, tmpFreeMB, toSdr, type Probe, type Span, type Word } from '@/lib/unedit-media';
import { costCents, defaultProvider, transcribe, type Provider } from '@/lib/unedit-transcribe';
import { directEpisode, pickStills, planVlog, redoClip, sentences, type Chapter, type Pick } from '@/lib/unedit-moments';
import { LOOKS, renderThumb } from '@/lib/unedit-thumb';
import type { Shot } from '@/lib/unedit-shots';
import type { Cue } from '@/lib/unedit-cues';
import { editList, within, type Drop, type Edit } from '@/lib/unedit-edit';
import { cleanTake, keyterms } from '@/lib/unedit-clean';
import { deskById, deskFor } from '@/lib/desk';
import { checkAll } from '@/lib/agency-copy';
import { enhanceVoice, isEnhanced } from '@/lib/unedit-voice';
import { makePartReview, dropPartReview } from '@/lib/unedit-review';
import { FILL, NEUTRAL, studioLight, analyzeLook, episodeSize, framing, gradeFilter, sampleTimes, type Box, type Look } from '@/lib/unedit-look';
import { parseSheet, placeNews, sheetText, type NewsEntry } from '@/lib/unedit-news';
import { planRecording, withScenes, type ScenePlan } from '@/lib/unedit-scenes';
import { musicBed } from '@/lib/unedit-music';
import { claimForUpload } from '@/lib/newsroom';
import { CREDIT_CENTS, runwayConfigured, runwayRoutedVideo, runwayTask, runwayTextVideo } from '@/lib/runway';
import { getRouters } from '@/lib/studio-runway';
import { matte, matteFilter } from '@/lib/unedit-cutout';
import { thumbLink } from '@/lib/unedit-share';
import { cutoutOn, faceOnFrame, packageOf, styleGraphics, STYLEBOOK_VERSION, type BaseGraphic } from '@/lib/unedit-style';
import { PACKAGES, RULES } from '@/data/unedit-stylebook';
import { assemble, effectSounds, epTime, layReel, overlayPart, partOverlays, planParts, renderPart, shotCrops, splitBoxes, picKey, WORKERS, type EpGraphic, type EpisodePlan, type Graphics, type Part } from '@/lib/unedit-episode';
import { renderOnSandbox, screenLinks } from '@/lib/unedit-pro';
import { qaEpisode } from '@/lib/unedit-qa';
import { proBrand, proConfigured, proProps, renderPro } from '@/lib/unedit-pro';
import { footageFor, footageOn, planFootage } from '@/lib/unedit-footage';
import { alignToScript, facelessProps, FACELESS_END_SECS, type FacelessClaim, type ScriptLine } from '@/lib/unedit-faceless-pro';
import { GENOVUS_BLOG_ID, findPostLike, metricoolConfigured, metricoolLive, postStatus, schedulePost } from '@/lib/metricool';
import { campaignPosts, nowTimes, planPosts, postKey, recommend, LEAD_MIN, type Busy, type PostMode, type Rhythm, type Signal } from '@/lib/unedit-plan';

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
  /** The scene plan Helix proposed from the article (lib/unedit-scenes.ts); approved scenes move onto the sheet. */
  scene_plan?: ScenePlan | null;
  /** Faceless (lib/unedit-faceless.ts): narration over the moving background; null on a real take. */
  faceless?: { voice: string; production: string; length: string; /** each narrated line and its time (alignToScript) */ script?: ScriptLine[] } | null;
  /** How the campaign was approved (lib/unedit-plan.ts); null before Approve. */
  post_plan?: { mode: PostMode; rhythm: Rhythm | null; why: string | null; by: string; at: string } | null;
};
export type Clip = {
  id: string; vlog_id: string; n: number; start_s: number; end_s: number; hook_start_s: number | null; hook_end_s: number | null;
  title: string; caption: string; copy: { instagram?: string; facebook?: string; youtube?: string }; features: Record<string, unknown>;
  blob_path: string | null; secs: number | null; status: 'rendering' | 'ready' | 'approved' | 'redo' | 'dropped' | 'failed'; note: string | null; error: string | null;
};
export type UPost = { id: string; vlog_id: string; clip_id: string | null; platform: 'instagram' | 'facebook' | 'youtube'; kind: 'reel' | 'short' | 'video'; title: string | null; body: string; status: string; mc_post_id: number | null; mc_status: string | null; mc_error: string | null; posted_url: string | null; scheduled_at: string | null };

// 'transcribing' is runnable too: a step cut off mid-transcription starts again from the recording.
const RUNNABLE: Stage[] = ['uploaded', 'transcribing', 'finding', 'rendering', 'publishing'];
const LEASE_MIN = 14;
const dbx = () => adminDb();
const log = (action: string, subject: string, after: Record<string, unknown>) => dbx().rpc('unedit_log', { p_action: `studio.unedit.${action}`, p_subject: subject, p_after: after });
const spend = async (id: string, cents: number, what: string) => { const r = await dbx().rpc('unedit_spend', { p_vlog: id, p_cents: cents, p_what: what }); if (r.error) throw new Error(r.error.message); };
const dir = (v: { id: string }) => `studio/vlogs/${v.id}`;

/** The Metricool brand a desk posts from: Genovus's for the house desk, the agency's own for an agency desk (never
 *  Genovus's). An agency without a connected brand can't post: that is an error, never a fallback. */
export async function blogFor(tenantId: string): Promise<string> {
  const desk = await deskById(tenantId);
  if (desk.house) return GENOVUS_BLOG_ID();
  const { data } = await dbx().from('tenants').select('metricool_blog_id').eq('id', tenantId).maybeSingle();
  const blog = String(data?.metricool_blog_id ?? '').trim();
  if (!blog) throw new Error(`${desk.name} has no Metricool brand connected, so nothing can post for it yet.`);
  return blog;
}

export async function genovusTenant(): Promise<string> {
  const { data } = await dbx().from('tenants').select('id').eq('slug', 'genovus').single();
  if (!data) throw new Error('The genovus tenant is missing.');
  return data.id as string;
}

// ---- registration ----------------------------------------------------------------------------------------------
const FP = /^[0-9]+:[0-9a-f]{64}:[0-9a-f]{64}$/;
/** Register an uploaded recording. The same file (same size and first/last 4 MB) opens the job it already has. */
export async function registerVlog(f: { blobPath: string; blobUrl: string; bytes: number; fingerprint: string; fileName: string; by: string; desk?: string | null }): Promise<{ id: string; existing: boolean }> {
  if (!/^studio\/vlogs\/uploads\/[A-Za-z0-9._/-]+\.(mp4|mov|m4v|webm)$/i.test(f.blobPath)) throw new Error('That upload is not an Unedit recording.');
  if (!FP.test(f.fingerprint) || !(f.bytes > 0)) throw new Error('The upload is missing its fingerprint.');
  // The desk it was recorded for (lib/desk.ts): the Genovus desk unless an agency desk was chosen.
  const tenant = (await deskFor(f.desk)).id;
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
// A step that finishes after someone stopped the recording (error set) must not move it forward again: a stage change
// only lands while the recording has no error (a step reporting its own error still lands).
/** Real footage for a faceless clip's lines (lib/unedit-footage.ts), keyed by shot index, as links the sandbox can
 *  read, with each clip's credit. Off unless UNEDIT_FOOTAGE=on; any failure leaves the clip as cards (never stops it). */
async function facelessFootage(v: Vlog, shots: Shot[], words: Word[]): Promise<Map<number, { src: string; credit: string | null }>> {
  const out = new Map<number, { src: string; credit: string | null }>();
  if (!footageOn() || !shots.length) return out;
  try {
    const lines = shots.map((sh, i) => ({ i, text: words.slice(sh.w0, sh.w1 + 1).map((w) => w.w).join(' ') }));
    const { plan, cents } = await planFootage(lines, v.title ?? '');
    await spend(v.id, cents, 'footage plan (Claude)');
    const { got, cents: looked, rejected } = await footageFor(v.tenant_id, plan, new Map(shots.map((sh, i) => [i, sh.e - sh.s])));
    if (looked) await spend(v.id, looked, 'footage look-check (Claude)');
    for (const [i, f] of got) out.set(i, { src: await presigned(f.blob_path, 120), credit: f.credit });
    await log('footage', v.id, { planned: plan.length, placed: got.size, clips: [...got.values()].map((f) => `${f.source}:${f.title.slice(0, 40)} (${f.license_note})`), rejected });
  } catch (e) { console.error(`[unedit] ${v.id} footage skipped: ${e instanceof Error ? e.message : e}`); }
  return out;
}

/** A faceless recording's story claims (its Newsroom package's story), for the verdict card. */
async function facelessClaims(production: string): Promise<FacelessClaim[]> {
  const { data: p } = await dbx().from('newsroom_productions').select('story_id').eq('id', production).maybeSingle();
  if (!p?.story_id) return [];
  const { data } = await dbx().from('newsroom_claims').select('text, status, attribution, approved').eq('story_id', p.story_id);
  return (data ?? []) as FacelessClaim[];
}

const release = (id: string, patch: Record<string, unknown> = {}) => {
  const q = dbx().from('unedit_vlogs').update({ lease_until: null, ...patch }).eq('id', id);
  return 'stage' in patch && !('error' in patch) ? q.is('error', null) : q;
};
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
      // Voice enhancement runs alongside transcription (never fatal; the original sound stays when it can't run).
      const voicing = enhanceVoice(audioPath);
      const t = await transcribe(mp3, p.duration, provider, keyterms(v.sources, v.title ? [v.title] : []));
      // A faceless narration is the script read word for word: captions and plans use the script's spelling ("8-K", not "eight k").
      if (v.faceless?.script?.length) t.words = alignToScript(t.words, v.faceless.script);
      const vo = await voicing;
      if (vo.cents) await spend(v.id, vo.cents, 'voice enhancement (Runway voice isolation)');
      await log(vo.path ? 'voice-enhanced' : 'voice-not-enhanced', subject, vo.path ? { path: vo.path } : { why: vo.why });
      const path = `${dir(v)}/transcript-${provider}.json`;
      await put(path, JSON.stringify({ provider, words: t.words }), { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true });
      await advance(v.id, 'finding', { provider, transcript_blob: path, words: t.words.length, audio_blob: vo.path ?? audioPath });
      await log('transcribed', subject, { provider, words: t.words.length, secs: Math.round(p.duration), cents: t.cents });
      return `Transcribed ${t.words.length} words with ${provider}.`;
    }
    if (v.stage === 'finding') {
      let words = await readWords(v);
      // The dialogue editor first: misheard names fixed in the transcript (so every caption and plan reads them right)
      // and the take's restarts, repeats and stumbles marked to cut. A failure here never stops the recording.
      let drops: Drop[] = [];
      // Not on a faceless narration: it is the approved script, already spelled right, with no stumbles to cut.
      if (!v.faceless) try {
        const clean = await cleanTake(words, { title: v.title ?? undefined, terms: keyterms(v.sources), sources: v.sources });
        await spend(v.id, clean.cents, 'dialogue edit (Claude)');
        drops = clean.drops;
        if (clean.fixes.length) {
          words = words.map((w, i) => { const f = clean.fixes.find((x) => x.i === i); return f ? { ...w, w: f.to } : w; });
          await put(v.transcript_blob!, JSON.stringify({ provider: v.provider, words, fixes: clean.fixes }), { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true });
        }
        await log('dialogue-edit', subject, { drops: drops.length, fixes: clean.fixes.map((f) => `${f.from} → ${f.to}`), cents: clean.cents });
      } catch (e) { console.error(`[unedit] ${v.id} dialogue edit skipped: ${e instanceof Error ? e.message : e}`); }
      const plan = await planVlog(words, undefined, Boolean(v.faceless));
      await spend(v.id, plan.cents, 'clip plan (Claude)');
      if (!plan.clips.length) throw new Error(`No clip stood on its own${plan.dropped.length ? ` (${plan.dropped.slice(0, 3).join('; ')})` : ''}. Try a recording with a few clear points.`);
      await dbx().from('unedit_clips').delete().eq('vlog_id', v.id);
      const rows = plan.clips.map((c, i) => clipRow(v, i + 1, c));
      const ins = await dbx().from('unedit_clips').insert(rows);
      if (ins.error) throw new Error(ins.error.message);
      // Episode Pro: what the full episode keeps, how it looks, and its parts (rendered in parallel after the clips).
      const pro = await planEpisode(v, words, plan.falseStarts, plan.episode.title, drops);
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
        const r = await redoClip(words, { title: c.title, from: Number(c.start_s), to: Number(c.end_s), note: c.note ?? '' }, (others ?? []).map((o) => ({ from: Number(o.start_s), to: Number(o.end_s) })), undefined, Boolean(v.faceless));
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
        // Room on the scratch disk first: other work on the same instance (episode parts, review copies) shares it, and
        // a cut that runs out of space fails. Waiting a minute is better than a failed clip.
        if (!needsFanout(v, spans)) {
          const need = clipDiskMB(spans.reduce((a, x) => a + (x.to - x.from), 0));
          let free = await tmpFreeMB();
          if (free != null && free < need) { await sweepTmp(); free = await tmpFreeMB(); }
          if (free != null && free < need) {
            await release(v.id, { lease_until: new Date(Date.now() + 60_000).toISOString() });
            return `Clip ${next.n} waits for scratch disk (${free} MB free, ${need} MB needed).`;
          }
        }
        const look = clipLook(v);
        const voice = isEnhanced(v.audio_blob) ? await presigned(v.audio_blob!, 60) : null;
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
            try { const o = await finishClip(d, words, spans, { accents, captions, ...look, voice }, 'clip.mp4', groups); return { bytes: await fs.readFile(o.file), secs: o.secs }; } finally { await fs.rm(d, { recursive: true, force: true }).catch(() => {}); }
          }
          const o = await renderClip(src, spans, words, probeOf(v), { accents, captions, ...look, voice });
          try { return { bytes: await fs.readFile(o.file), secs: o.secs }; } finally { await fs.rm(o.dir, { recursive: true, force: true }).catch(() => {}); }
        };
        // Unedit Pro's graphics pass (Remotion on Vercel Sandbox) when it is configured; any failure falls back to the plain clip.
        let made: { bytes: Buffer; secs: number; pro: boolean } | null = null;
        let proError: string | null = null;
        if (proConfigured() && shots.length) {
          try {
            const base = await cut(false);
            // A new name per render: an overwritten name can be served from cache (stored blobs are cached up to a month).
            const basePath = `${dir(v)}/clips/${next.n}-base-${Date.now()}.mp4`;
            await put(basePath, base.bytes, { access: 'private', contentType: 'video/mp4', addRandomSuffix: false, allowOverwrite: true, abortSignal: AbortSignal.timeout(180_000) });
            const cues = ((next.features as { cues?: Cue[] })?.cues ?? []);
            // An agency desk's clip carries the agency's crest, colors and end card (lib/desk.ts profile.brand), never Genovus's.
            const brand = proBrand((await deskById(v.tenant_id)).profile);
            if (v.faceless) {
              // No speaker: every frame is a grounded graphic beat (lib/unedit-faceless-pro.ts), never the empty background.
              const footage = await facelessFootage(v, shots, words);
              const props = facelessProps(await presigned(basePath, 120), words, spans, shots, accents, { title: next.title, sheet: v.sources ?? [], claims: await facelessClaims(v.faceless.production), footage });
              made = { bytes: await renderOnSandbox('UneditFaceless', props as unknown as Record<string, unknown>, { codec: 'h264', crf: 20, gl: props.gl }), secs: base.secs + FACELESS_END_SECS, pro: true };
            } else made = { bytes: await renderPro(await proProps(await presigned(basePath, 120), words, spans, shots, accents, cues, brand)), secs: base.secs, pro: true };
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
      // The clips' vertical covers (once per clip render; a failure is recorded and never blocks review).
      console.info(`[unedit] ${v.id} ${await makeClipCovers(v, src).catch((e) => `covers: ${e instanceof Error ? e.message : e}`)}`);
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
      if (r.left) { await release(v.id); return `Sent ${r.sent} post${r.sent === 1 ? '' : 's'}; ${r.left} more in the next step.`; }
      // Posts later on the calendar wait: the cron brings the recording back here when the next one is due.
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
async function planEpisode(v: Vlog, words: Word[], falseStarts: string[], title = '', drops: Drop[] = []): Promise<{ edit: Edit; look: Look | null; episode_plan: EpisodePlan | null; episode_path: null }> {
  const edit = editList(words, Number(v.duration_s ?? 0), falseStarts, drops);
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
  const lib = await shotLibrary(v, words);
  const dir = await directEpisode(words, keepSentences, secs, undefined, pkg, Boolean(v.faceless), title || v.title || '', lib.map((l) => ({ code: l.code, prompt: l.prompt })));
  await spend(v.id, dir.cents, 'episode director (Claude)');
  // Even pacing, guaranteed: any stretch over GAP_MAX seconds with nothing new planned (the director tends to front-
  // load, and the close of DeepSeek had 57 s with three items) gets a focused second pass on just those sentences;
  // what it finds joins the plan (chapters only come from the first pass; at most two more illustrations).
  const sAt = (i: number) => epTime(ss[i]?.s ?? -1, edit.keep);
  const marks = [0, ...dir.cues.map((c) => epTime(words[c.w].s, edit.keep)), ...dir.kinetic.map((k) => epTime(words[k.w].s, edit.keep)), ...dir.emphasis.map((e) => epTime(words[e.w].s, edit.keep)), ...dir.broll.map((b) => sAt(b.s)), ...dir.chapters.map((c) => sAt(c.s)), secs - 5]
    .filter((t): t is number => t != null).sort((a, b) => a - b);
  const gapSentences = keepSentences.filter((i) => { const t = sAt(i); if (t == null) return false; for (let k = 1; k < marks.length; k++) if (marks[k] - marks[k - 1] > GAP_MAX && t > marks[k - 1] + 3 && t < marks[k] - 3) return true; return false; });
  if (gapSentences.length >= 3) {
    const gapSecs = gapSentences.reduce((a, i) => a + Math.max(0, (ss[i].e ?? 0) - (ss[i].s ?? 0)), 0);
    const more = await directEpisode(words, gapSentences, Math.max(30, gapSecs), undefined, pkg, Boolean(v.faceless), title || v.title || '').catch(() => null);
    if (more) {
      await spend(v.id, more.cents, 'episode director, pacing pass (Claude)');
      dir.cues.push(...more.cues); dir.kinetic.push(...more.kinetic); dir.emphasis.push(...more.emphasis); dir.broll.push(...more.broll.slice(0, 2));
      await log('pacing-pass', v.id, { sentences: gapSentences.length, cues: more.cues.length, kinetic: more.kinetic.length, emphasis: more.emphasis.length, broll: Math.min(2, more.broll.length) });
    }
  }
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
      // A library shot: already rendered and approved, reused for free.
      const reuse = b.library ? lib.find((l) => l.code === b.library) : null;
      if (reuse) {
        base.push({ T: T + 0.3, D: v.faceless ? 6 : 4, kind: 'broll', text: 'Illustration', broll: { prompt: reuse.prompt, path: reuse.path, model: 'library' }, sound: 'whoosh' });
        await dbx().from('unedit_assets').update({ uses: reuse.uses + 1, last_used_vlog: v.id }).eq('id', reuse.id);
        continue;
      }
      try {
        const job = await startBroll(b.prompt);
        await spend(v.id, job.cents, `B-roll illustration (Runway ${job.model})`);
        // 4 s of the shot over a talking head, 6 s when the illustrations carry a faceless video.
        base.push({ T: T + 0.3, D: v.faceless ? 6 : 4, kind: 'broll', text: 'Illustration', broll: { prompt: b.prompt, task: job.id, model: job.model, at: Date.now() }, sound: 'whoosh' });
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
  // An article's preview image is copied into the recording's storage now, so the render never depends on the
  // publisher's site (a page we couldn't read keeps the designed card without a picture).
  for (const [k, b] of base.entries()) {
    if (b.kind !== 'article' || !b.news?.image || !/^https:\/\//.test(b.news.image)) continue;
    try {
      const r = await fetch(b.news.image, { headers: { 'user-agent': 'GenovusNewsroom/1.0 (+https://genovus.io)' }, signal: AbortSignal.timeout(15_000) });
      const type = r.headers.get('content-type') ?? '';
      if (!r.ok || !/^image\/(jpeg|png|webp)/.test(type)) throw new Error(`${r.status} ${type}`);
      const bytes = Buffer.from(await r.arrayBuffer());
      if (bytes.length > 8 * 1024 * 1024) throw new Error('too large');
      const p = `studio/vlogs/${v.id}/article-${k}.${type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg'}`;
      await put(p, bytes, { access: 'private', contentType: type.split(';')[0], addRandomSuffix: false, allowOverwrite: true });
      b.news = { ...b.news, image: p };
    } catch { b.news = { ...b.news, image: undefined }; }
  }
  const chapters = chaps.length >= 3 ? `Chapters\n${chaps.map((x) => `${ts(x.t)} ${x.c.title}`).join('\n')}` : undefined;
  const s = styled(base, pkg, { ...frame, edit }, secs);
  return { ...s, notes: [...brollNote, ...placed.notes, ...(s.notes ?? [])], chapters, error: null };
}

/** Style the plan with a show package and lay out the reel (also used when the card changes the package). */
function styled(base: BaseGraphic[], pkg: string, frame: { face: Box | null; src: { width: number; height: number }; size: { width: number; height: number }; edit?: Edit | null }, secs: number): Omit<Graphics, 'chapters' | 'error'> {
  const ctx = { landscape: frame.size.width > frame.size.height, cutout: cutoutOn(), face: faceOnFrame(frame.face, frame.src, frame.size), headAt: headAtFn(frame) };
  const { items, notes, gl } = styleGraphics(base, pkg, ctx, secs);
  const laid = layReel(items);
  const cuts = RULES.transitionAtChapters ? items.filter((g) => g.kind === 'chapter' && g.T > 1).map((g) => Math.round(g.T * 1000) / 1000) : [];
  return { items: laid.items, reels: laid.reels, pkg, stylebook: STYLEBOOK_VERSION, base, notes, gl, cuts };
}

/** A clip's framing and grade from the recording's look: a face-aware 9:16 crop of a landscape source. */
function clipLook(v: Vlog): { crop?: ReturnType<typeof framing> | null; grade?: string | null; sdr?: string | null; light?: string | null } {
  if (!v.look) return {};
  const src = { width: Number(v.width ?? 1080), height: Number(v.height ?? 1920) };
  const crop = src.width > src.height ? framing(v.look.face, src, { width: 1080, height: 1920 }, FILL.clip) : null;
  // Studio light after the grade, as in the episode (never on a faceless background).
  return { crop, grade: gradeFilter(v.look.grade), sdr: v.look.sdr || null, light: v.faceless ? null : studioLight() || null };
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
/** Large frames decode slowly on a function (a 56 s clip did not finish inside 800 s): past 15 s of footage, fan out to
 *  parallel group workers. 8K always; so does any recording past about 6 megapixels (a47f35a0, a 3000x2160 browser
 *  capture at 44 Mbps, decoded at 1-5 min per 15 s: its 56 s clip 2 ran out of time on one function, 2026-11-18). */
const needsFanout = (v: Vlog, spans: Span[]) => {
  const w = Number(v.width ?? 0), h = Number(v.height ?? 0);
  return (Math.max(w, h) > 4000 || w * h > 6_000_000) && spans.reduce((a, s) => a + (s.to - s.from), 0) > 15;
};
const groupPaths = (v: Vlog, c: Clip, spans: Span[], look: unknown) => {
  const key = createHash('sha256').update(JSON.stringify({ spans, look, voice: isEnhanced(v.audio_blob) })).digest('hex').slice(0, 12);
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
    const voice = isEnhanced(v.audio_blob) ? await presigned(v.audio_blob!, 60) : null;
    await clipPieces(d, await presigned(v.blob_path, 60), groups[g], probeOf(v), { ...look, voice }, 'group.mkv');
    await put(p, await fs.readFile(path.join(d, 'group.mkv')), { access: 'private', contentType: 'video/x-matroska', addRandomSuffix: false, allowOverwrite: true, multipart: true });
    return `Clip ${n} group ${g + 1} of ${groups.length} in ${Math.round((Date.now() - t0) / 1000)} s.`;
  } finally { await fs.rm(d, { recursive: true, force: true }).catch(() => {}); }
}

/** Tighten the edit: run the dialogue editor on the take (misheard names fixed in the transcript; restarts, repeats,
 *  abandoned phrases, corrections and tics cut), re-cut the episode with it, and plan its graphics fresh. Clips keep
 *  their cut. Asked from Studio Live before approval; the parts render again in the next steps. */
async function tightenStep(v: Vlog): Promise<string> {
  let words = await readWords(v);
  const clean = await cleanTake(words, { title: v.episode?.title ?? v.title ?? undefined, terms: keyterms(v.sources), sources: v.sources });
  await spend(v.id, clean.cents, 'dialogue edit (Claude)');
  if (clean.fixes.length) {
    words = words.map((w, i) => { const f = clean.fixes.find((x) => x.i === i); return f ? { ...w, w: f.to } : w; });
    await put(v.transcript_blob!, JSON.stringify({ provider: v.provider, words, fixes: clean.fixes }), { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true });
  }
  const old = v.edit!;
  // The planner's false starts, read back from the old cuts (runs of two or more words).
  const falseStarts = old.cuts.filter((c) => c.why === 'false start')
    .map((c) => words.filter((w) => w.s >= c.from - 0.05 && w.e <= c.to + 0.05).map((w) => w.w).join(' ')).filter((t) => t.split(' ').length >= 2);
  const edit = editList(words, Number(v.duration_s ?? 0), falseStarts, clean.drops);
  const ep = v.episode_plan!;
  const parts = planParts(edit.segs, ep.src, edit.secs);
  await dbx().from('unedit_episode_parts').delete().eq('vlog_id', v.id);
  const ins = await dbx().from('unedit_episode_parts').insert(parts.map((p) => ({ vlog_id: v.id, k: p.k, tenant_id: v.tenant_id, segs: p.segs })));
  if (ins.error) throw new Error(ins.error.message);
  await dbx().from('unedit_vlogs').update({
    edit, episode_path: null,
    episode_plan: { ...ep, parts: parts.length, secs: edit.secs, graphics: { items: [], pkg: ep.graphics?.pkg, replan: true, error: null } },
  }).eq('id', v.id);
  await log('tightened', v.id, { before: old.secs, after: edit.secs, drops: clean.drops.length, fixes: clean.fixes.map((f) => `${f.from} → ${f.to}`), cents: clean.cents });
  await release(v.id);
  return `Tightened the edit: ${Math.round(old.secs - edit.secs)} s shorter, ${clean.drops.length} words cut, ${clean.fixes.length} words fixed.`;
}

/** The speaker's head on screen over a window of the episode (the union over the camera sizes cut in during it), from
 *  the head box (hat to chin, ear to ear: lib/unedit-look.ts) and each shot's crop: a close-up leaves no headroom.
 *  Undefined when there is no face or no edit. */
function headAtFn(frame: { face: Box | null; src: { width: number; height: number }; size: { width: number; height: number }; edit?: Edit | null }) {
  const { face, src, size, edit } = frame;
  if (!face || !edit?.keep.length) return undefined;
  const srcAt = (T: number) => { let off = 0; for (const k of edit.keep) { const d = k.to - k.from; if (T <= off + d) return k.from + Math.max(0, T - off); off += d; } return edit.keep[edit.keep.length - 1].to; };
  const box = (cam: keyof typeof FILL) => {
    const c = framing(face, src, size, FILL[cam]);
    return { top: Math.max(0, (face.y * src.height - c.y) / c.h), left: Math.max(0, (face.x * src.width - c.x) / c.w), right: Math.min(1, ((face.x + face.w) * src.width - c.x) / c.w), bottom: Math.min(1, ((face.y + face.h) * src.height - c.y) / c.h) };
  };
  return (T: number, D: number) => {
    const bs = [T, T + D / 2, T + Math.max(0, D - 0.1)].map((t) => {
      const s = srcAt(t);
      const seg = edit.segs.find((x) => s >= x.from && s < x.to) ?? edit.segs[edit.segs.length - 1];
      return box(seg?.cam ?? 'medium');
    });
    return { top: Math.min(...bs.map((b) => b.top)), left: Math.min(...bs.map((b) => b.left)), right: Math.max(...bs.map((b) => b.right)), bottom: Math.max(...bs.map((b) => b.bottom)) };
  };
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
  if (v.edit?.reclean) return await tightenStep(v);
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
      // Routed models (Kling, Wan, ...) can take longer than Veo: shots still generating are waited for, across steps,
      // up to BROLL_WAIT_MS from when they were ordered, instead of being dropped after one step's wait.
      if (!(await settleBroll(v, g))) {
        await release(v.id, { lease_until: new Date(Date.now() + 45_000).toISOString() });
        return `Waiting for ${g.items.filter((x) => x.kind === 'broll' && x.broll?.task && !x.broll.path && !x.broll.failed).length} B-roll shots still being generated.`;
      }
      const brollLink = async (x: EpGraphic) => (x.broll?.path ? presigned(x.broll.path, 120) : x.kind === 'article' && x.news?.image?.startsWith('studio/') ? presigned(x.news.image, 120) : null);
      const items = await Promise.all(g.items.map(async (x) => ({ at: x.off ?? 0, dur: x.D, kind: x.kind, text: x.text, sub: x.sub, n: x.n, cue: x.cue, style: x.style, accent: x.accent, maxW: x.maxW, place: x.place, ...(x.kind === 'article' ? { bubble: x.bubble ? (x.bubble.mode === 'cutout' ? 'cutout' : true) : false } : {}), news: x.news, media: await brollLink(x) })));
      // Each chunk stands alone: one sandbox that fails (a 410 from an expired sandbox, 2026-11-17) no longer throws
      // away the chunks that finished. Those are kept; the rest render again next step, up to REEL_TRIES rounds.
      const settled = await Promise.allSettled(todo.map(async (i) => {
        const r = g.reels![i];
        const bytes = await renderOnSandbox('UneditEpisodeCues', { width: size.width, height: size.height, items }, { codec: 'vp8', alpha: true, gl: Boolean(g.gl), frameRange: [Math.round(r.from * 30), Math.max(Math.round(r.from * 30), Math.round(r.to * 30) - 1)] });
        const path = `${dir(v)}/episode/graphics-${i}-${Date.now()}.webm`;
        await put(path, bytes, { access: 'private', contentType: 'video/webm', addRandomSuffix: false, allowOverwrite: true, multipart: true });
        return { i, path, bytes: bytes.length };
      }));
      const done = settled.flatMap((x) => (x.status === 'fulfilled' ? [x.value] : []));
      const why = settled.flatMap((x, n) => (x.status === 'rejected' ? [`chunk ${todo[n] + 1}: ${x.reason instanceof Error ? x.reason.message : String(x.reason)}`] : []));
      for (const w of why) console.error(`[unedit] ${v.id} episode graphics ${w}`);
      const reels = g.reels.map((x, i) => ({ ...x, path: done.find((d) => d.i === i)?.path ?? x.path }));
      // Re-read the plan so nothing written meanwhile is lost (the parts only read it).
      const { data: cur } = await dbx().from('unedit_vlogs').select('episode_plan').eq('id', v.id).single();
      const ep = (cur?.episode_plan ?? v.episode_plan) as EpisodePlan;
      const tries = (g.reelTries ?? 0) + (why.length ? 1 : 0);
      const error = why.length && tries >= REEL_TRIES ? `the graphics didn't render (${why[0]})`.slice(0, 300) : null;
      await dbx().from('unedit_vlogs').update({ episode_plan: { ...ep, graphics: { ...ep.graphics!, reels, reelTries: tries, ...(error ? { error } : {}) } } }).eq('id', v.id);
      await log('episode-graphics', v.id, { chunks: done.length, failed: why.length, of: g.reels.length, ms: Date.now() - t0, bytes: done.reduce((a, d) => a + d.bytes, 0), ...(why.length ? { why: why[0].slice(0, 200) } : {}) });
      await release(v.id);
      if (error) return `The episode's graphics didn't render after ${tries} tries (${why[0]}); the episode continues without them.`;
      if (why.length) return `Rendered ${done.length} of ${todo.length} graphics chunks; ${why.length} will render again (${why[0]}).`;
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
  // A recording from before voice enhancement gets it now, before its soundtrack is built.
  let audio = v.audio_blob;
  if (audio && !isEnhanced(audio)) {
    const vo = await enhanceVoice(audio);
    if (vo.cents) await spend(v.id, vo.cents, 'voice enhancement (Runway voice isolation)');
    await log(vo.path ? 'voice-enhanced' : 'voice-not-enhanced', v.id, vo.path ? { path: vo.path } : { why: vo.why });
    if (vo.path) { audio = vo.path; await dbx().from('unedit_vlogs').update({ audio_blob: audio }).eq('id', v.id); }
  }
  const sound = await presigned(audio ?? v.blob_path, 120);
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
      const graphics: Graphics = { ...g, ...styled((g.base as BaseGraphic[]).filter((b) => !gone(b)), g.pkg ?? packageOf(null), { face: ep.face, src: ep.src, size: ep.size, edit: v.edit }, ep.secs), error: null,
        qa: { at: new Date().toISOString(), ok: false, issues: qa.issues.map(say), fixed: drops.length, cents: qa.cents } };
      await dbx().from('unedit_episode_parts').update({ status: 'todo', attempts: 0, error: null, lease_until: null, blob_path: null }).eq('vlog_id', v.id);
      await dbx().from('unedit_vlogs').update({ episode_plan: { ...ep, graphics }, episode_path: null }).eq('id', v.id);
      await log('episode-qa', v.id, { issues: qa.issues.length, dropped: drops.length, refix: true });
      await release(v.id);
      return `Quality check: left out ${drops.length} graphic${drops.length === 1 ? '' : 's'}; rendering the episode again.`;
    }
    // What code already knows goes in first: a part that left graphics or captions out (it recorded why), and a
    // check that couldn't run. Neither may read as "passed" (a47f35a0 passed with part 2's graphics missing).
    const { data: gapRows } = await dbx().from('unedit_episode_parts').select('k, error').eq('vlog_id', v.id).eq('status', 'done').not('error', 'is', null);
    const left = [
      ...(gapRows ?? []).map((p) => `part ${Number(p.k) + 1}: ${String(p.error).split(':')[0]}`),
      ...(qa.failed ? [`the check didn't run (${qa.failed})`] : []),
      ...qa.issues.map(say),
    ];
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
/** Fluid compute sends concurrent requests to one instance, and its /tmp (~500 MB) is shared: two 4K parts on one
 *  instance ran out of disk (2026-11-17). Each part reserves the disk it will need (about three copies of its
 *  picture: the pieces, the joined part, the part with graphics); a part that doesn't fit beside the ones already
 *  running here is left untouched (no try spent) and the step starts it again within a minute or two. A part alone
 *  on an instance always runs. */
let reservedMB = 0;
export async function renderEpisodePart(id: string, k: number, origin: string): Promise<string> {
  const [{ data: row }, { data: vr }] = await Promise.all([
    dbx().from('unedit_episode_parts').select('segs').eq('vlog_id', id).eq('k', k).maybeSingle(),
    dbx().from('unedit_vlogs').select('episode_plan').eq('id', id).maybeSingle(),
  ]);
  const size = (vr?.episode_plan as EpisodePlan | null)?.size;
  const secs = ((row?.segs ?? []) as Part['segs']).reduce((a, s) => a + (s.to - s.from), 0);
  const need = partDiskMB(secs, size);
  if (reservedMB > 0) {
    const free = await tmpFreeMB();
    if (free != null && reservedMB + need > free) return `Part ${k + 1} waits for disk on this instance (${need} MB needed, ${free} MB free, ${reservedMB} MB held by parts running here).`;
  }
  reservedMB += need;
  try { return await renderEpisodePartHere(id, k, origin); } finally { reservedMB -= need; }
}
/** The disk a part needs while it renders, in MB: ~5 MB a second at 3000x2160 (CRF 19), three copies, plus room. */
export function partDiskMB(secs: number, size?: { width: number; height: number } | null): number {
  const px = (size?.width ?? 3840) * (size?.height ?? 2160);
  return Math.ceil(3 * secs * (px / 1.3e6)) + 40;
}
async function renderEpisodePartHere(id: string, k: number, origin: string): Promise<string> {
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
    const pic = `${dir(v)}/episode/pic-${String(k).padStart(3, '0')}-${picKey(part, { ...v.episode_plan, light: !v.faceless }, motion)}.mp4`;
    let out: { file: string; dir: string; secs: number };
    const kept = await head(pic).catch(() => null);
    if (kept) {
      const d = await fs.mkdtemp(path.join(os.tmpdir(), 'unedit-ep-'));
      const r = await fetch(await presigned(pic, 30), { signal: AbortSignal.timeout(120_000) });
      if (!r.ok) throw new Error(`the stored picture didn't download (${r.status})`);
      await fs.writeFile(path.join(d, 'part.mp4'), Buffer.from(await r.arrayBuffer()));
      out = { file: path.join(d, 'part.mp4'), dir: d, secs: part.segs.reduce((a, s) => a + (s.to - s.from), 0) };
    } else {
      // The framing and each finished piece are kept beside the picture, so a try killed for time resumes instead of
      // starting over (8K parts of ~20 s took 12-13 min, at the edge of the 800 s limit; 2026-11-16).
      const base = pic.replace(/.mp4$/, '');
      const fetchKept = async (p: string) => { if (!(await head(p).catch(() => null))) return null; const r = await fetch(await presigned(p, 30), { signal: AbortSignal.timeout(120_000) }); return r.ok ? Buffer.from(await r.arrayBuffer()) : null; };
      const keptCrops = await fetchKept(`${base}-crops.json`).catch(() => null);
      let crops: Awaited<ReturnType<typeof shotCrops>>['crops'];
      if (keptCrops) crops = JSON.parse(keptCrops.toString('utf8'));
      else {
        const r = await shotCrops(src, part, v.episode_plan);
        await spend(id, r.cents, `episode part ${k + 1} framing (Claude)`);
        crops = r.crops;
        await put(`${base}-crops.json`, JSON.stringify(crops), { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true });
      }
      out = await renderPart(src, part, crops, { ...v.episode_plan, light: !v.faceless }, motion, {
        get: (i) => fetchKept(`${base}-p${String(i).padStart(3, '0')}.mp4`),
        put: async (i, b) => { await put(`${base}-p${String(i).padStart(3, '0')}.mp4`, b, { access: 'private', contentType: 'video/mp4', addRandomSuffix: false, allowOverwrite: true, abortSignal: AbortSignal.timeout(120_000) }); },
      });
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
      // Anything this part had to go without is kept on its row (status done, error set) and shown on the card.
      let left: string | null = null;
      const caps = CAPTIONS_ON() ? await writePartCaptions(v, out.dir, p0, out.secs, g && !g.error ? g.items : []).catch((e) => { left = `captions left out: ${e instanceof Error ? e.message : e}`; console.error(`[unedit] ${id} part ${k} ${left}`); return false; }) : false;
      // The graphics reel's stretches for this part's place in the episode.
      if (g?.reels?.length && g.reels.every((r) => r.path) && !g.error && g.items.length) {
        const overlays = partOverlays(g.items, g.reels, p0, p0 + out.secs);
        const urls = await Promise.all(g.reels.map((r) => presigned(r.path!, 120)));
        // Text behind the speaker only on a first try and while the part has time for it (a retry, or a slow part,
        // lays those graphics in front instead). The budget counts from when the overlay starts.
        if (overlays.length || caps) await overlayPart(out.dir, urls, overlays, v.episode_plan.size, tries === 1 ? Math.min(t0 + CUTOUT_BUDGET_MS, Date.now() + CUTOUT_ALONE_MS) : 0, caps).catch(async (e) => {
          // One pass decodes every graphic at once (plus the cut-out matte): a part with five graphics in 14 s ran out
          // of memory (a47f35a0 part 2, 2026-11-18). Lay them two at a time instead, text in front of the speaker
          // (no cut-out), the captions on the last pass; only the graphics that still won't lay are left out.
          const why = e instanceof Error ? e.message : String(e);
          console.error(`[unedit] ${id} part ${k} graphics in one pass failed (${why}); laying them two at a time`);
          let lost = 0, capsOn = false;
          for (let j = 0; j < overlays.length; j += 2) {
            const last = j + 2 >= overlays.length;
            const ok = await overlayPart(out.dir, urls, overlays.slice(j, j + 2), v.episode_plan!.size, 0, caps && last).then(() => true, (e2) => { console.error(`[unedit] ${id} part ${k} graphics ${j + 1}-${j + 2}: ${e2 instanceof Error ? e2.message : e2}`); return false; });
            if (!ok) lost += overlays.slice(j, j + 2).length; else if (caps && last) capsOn = true;
          }
          // The captions alone are worth their own pass: a part should never lose them to a graphic that won't lay.
          if (caps && !capsOn) capsOn = await overlayPart(out.dir, [], [], v.episode_plan!.size, 0, true).then(() => true, () => false);
          if (lost || (caps && !capsOn)) left = [lost ? `${lost} of ${overlays.length} graphics left out` : '', caps && !capsOn ? 'captions left out' : ''].filter(Boolean).join(', ') + `: ${why}`;
          if (left) console.error(`[unedit] ${id} part ${k} ${left}`);
        });
      } else if (caps) await overlayPart(out.dir, [], [], v.episode_plan.size, 0, true).catch((e) => { left = `captions left out: ${e instanceof Error ? e.message : e}`; console.error(`[unedit] ${id} part ${k} ${left}`); });
      const path_ = partPath(v, k);
      // Parts keep their name across re-renders, so they are cached only briefly (never an old part in the join).
      await put(path_, await fs.readFile(out.file), { access: 'private', contentType: 'video/mp4', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60, abortSignal: AbortSignal.timeout(180_000) });
      // The card's light copy of this part (lib/unedit-review.ts), made while the file is still here; a part without
      // one loses any older copy, so the review join can never show a stale part (the review worker remakes it).
      await makePartReview(out.file, path_).catch(async (e) => { console.error(`[unedit] ${id} part ${k} review copy: ${e instanceof Error ? e.message : e}`); await dropPartReview(path_); });
      await dbx().from('unedit_episode_parts').update({ status: 'done', blob_path: path_, secs: Math.round(out.secs * 100) / 100, ms: Date.now() - t0, error: left ? String(left).slice(0, 400) : null, lease_until: null }).eq('vlog_id', id).eq('k', k);
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
/** Rounds of the graphics reel render before the episode goes on without graphics. */
const REEL_TRIES = 3;
const BROLL_ON = () => process.env.UNEDIT_BROLL !== 'off';
const BROLL_CENTS = 80; // Veo 3.1 Fast through Runway: 10 credits a second, 8 s (the only length at 1080p)

// ---- the shot library (supabase/migrations/0107_unedit_assets.sql) ------------------------------------------------
/** The longest stretch of an episode without something new planned on screen before the pacing pass fills it. */
const GAP_MAX = 18;
/** After this many approved episodes, the director reuses approved shots that fit. */
const LIBRARY_AFTER = 3;
const STOP = new Set(['about', 'their', 'there', 'which', 'while', 'where', 'with', 'from', 'into', 'over', 'under', 'cinematic', 'shallow', 'depth', 'field', 'tungsten', 'shadows', 'natural', 'grain', 'camera', 'slow', 'light', 'warm', 'teal', 'shot', 'film', 'focus', 'frame', 'scene']);
/** A shot's topic words, for matching it to a later episode's talk. */
function assetTags(prompt: string): string[] {
  const n = new Map<string, number>();
  for (const w of prompt.toLowerCase().match(/[a-z][a-z-]{4,}/g) ?? []) if (!STOP.has(w)) n.set(w, (n.get(w) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w).slice(0, 14);
}
/** The approved shots the director may reuse for this episode (none until LIBRARY_AFTER episodes are approved): the
 *  ones whose topics best match the talk, never one made for or used in the last two episodes, at most 24. */
async function shotLibrary(v: Vlog, words: Word[]): Promise<{ id: string; code: string; prompt: string; path: string; uses: number }[]> {
  const { data } = await dbx().from('unedit_assets').select('id, vlog_id, blob_path, prompt, tags, uses, last_used_vlog, created_at, approved').eq('tenant_id', v.tenant_id).eq('kind', 'broll').or(`approved.eq.true,vlog_id.eq.${v.id}`).limit(400);
  const all = (data ?? []) as { id: string; vlog_id: string | null; blob_path: string; prompt: string; tags: string[]; uses: number; last_used_vlog: string | null; created_at: string; approved: boolean }[];
  // This episode's own shots (a re-plan): always offered, so a re-plan never pays for pictures it already has.
  const own = all.filter((r) => r.vlog_id === v.id).map((r, i) => ({ id: r.id, code: `O${i + 1}`, prompt: r.prompt, path: r.blob_path, uses: r.uses }));
  const rows = all.filter((r) => r.approved && r.vlog_id !== v.id);
  if (new Set(rows.map((r) => r.vlog_id).filter(Boolean)).size < LIBRARY_AFTER) return own;
  const { data: recent } = await dbx().from('unedit_vlogs').select('id').eq('tenant_id', v.tenant_id).neq('id', v.id).not('approved_at', 'is', null).order('approved_at', { ascending: false }).limit(2);
  const rest = new Set([v.id, ...(recent ?? []).map((r) => r.id as string)]); // other episodes' shots rest for two episodes
  const talk = new Set(words.map((w) => w.w.toLowerCase().replace(/[^a-z-]/g, '')).filter((w) => w.length >= 5));
  return rows.filter((r) => !rest.has(r.vlog_id ?? '') && !rest.has(r.last_used_vlog ?? ''))
    .map((r) => ({ r, score: r.tags.filter((t) => talk.has(t)).length - r.uses * 0.25 }))
    .filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 24)
    .map((x, i) => ({ id: x.r.id, code: `L${i + 1}`, prompt: x.r.prompt, path: x.r.blob_path, uses: x.r.uses }))
    .concat(own);
}

/** One B-roll shot: through the Studio's Runway Model Router, which picks the best eligible model for each shot (Kling,
 *  Seedance, Veo, ... as configured in Runway's dev portal) at 1080p, quoted first with a free dry run so the spend is
 *  the router's own estimate. If the router can't take it (no eligible model, a refusal), Veo 3.1 Fast directly.
 *  UNEDIT_BROLL_ROUTER=off goes straight to Veo. */
async function startBroll(prompt: string): Promise<{ id: string; cents: number; model: string }> {
  if (process.env.UNEDIT_BROLL_ROUTER !== 'off') {
    try {
      const router = (await getRouters(dbx())).production;
      const req = { router, prompt, images: [] as { uri: string; role: 'first' | 'last' | 'reference' }[], duration: 5, audio: false, resolution: '1080p' as const };
      const q = await runwayRoutedVideo({ ...req, dryRun: true });
      const credits = q.routing?.estimatedCost?.credits;
      // Guard: a routed shot never costs more than twice a Veo shot.
      if (credits != null && credits * CREDIT_CENTS > BROLL_CENTS * 2) throw new Error(`the router quoted ${credits} credits`);
      const r = await runwayRoutedVideo(req);
      return { id: r.id, cents: Math.round((r.routing?.estimatedCost?.credits ?? credits ?? 80) * CREDIT_CENTS), model: r.routing?.model ?? 'router' };
    } catch (e) {
      console.warn(`[unedit] B-roll router declined (${e instanceof Error ? e.message : e}); using Veo 3.1 Fast`);
    }
  }
  const job = await runwayTextVideo({ prompt, duration: 8 });
  return { id: job.id, cents: BROLL_CENTS, model: 'veo3.1_fast' };
}
/** Wait (up to ~4 minutes in all) for the episode's B-roll jobs, store each clip in Blob, and record it on the plan
 *  (mutating `g`). A job that fails or runs out of time leaves its slot empty: the speaker stays on screen. */
/** How long a B-roll shot may take from its order before the episode goes on without it. */
const BROLL_WAIT_MS = 15 * 60_000;
/** Collect the B-roll shots: true when every shot is settled (stored or failed); false when some are still generating
 *  and within BROLL_WAIT_MS of their order (the caller waits a step and asks again). */
async function settleBroll(v: Vlog, g: Graphics): Promise<boolean> {
  const timedOut = (f?: string) => Boolean(f && /^still /.test(f));
  const open = g.items.filter((x) => x.kind === 'broll' && x.broll?.task && !x.broll.path && (!x.broll.failed || timedOut(x.broll.failed)));
  if (!open.length) return true;
  const until = Date.now() + 120_000;
  await Promise.all(open.map(async (x, n) => {
    try {
      let t = await runwayTask(x.broll!.task!);
      while (!['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(t.status) && Date.now() < until) { await new Promise((r) => setTimeout(r, 6000)); t = await runwayTask(x.broll!.task!); }
      if (t.status !== 'SUCCEEDED' && !['FAILED', 'CANCELLED'].includes(t.status) && (x.broll!.at != null && Date.now() - x.broll!.at < BROLL_WAIT_MS)) return; // still coming: ask again next step
      if (t.status !== 'SUCCEEDED' || !t.output?.[0]) { x.broll!.failed = t.failure ?? `still ${t.status.toLowerCase()} after ${Math.round(BROLL_WAIT_MS / 60_000)} minutes`; return; }
      const r = await fetch(t.output[0], { signal: AbortSignal.timeout(90_000) });
      if (!r.ok) throw new Error(`download ${r.status}`);
      const p = `${dir(v)}/episode/broll-${n}-${Date.now()}.mp4`;
      await put(p, Buffer.from(await r.arrayBuffer()), { access: 'private', contentType: 'video/mp4', addRandomSuffix: false, allowOverwrite: true });
      x.broll!.path = p;
      x.broll!.failed = undefined;
      await dbx().from('unedit_assets').upsert({ tenant_id: v.tenant_id, vlog_id: v.id, kind: 'broll', blob_path: p, prompt: x.broll!.prompt, model: x.broll!.model ?? null, tags: assetTags(x.broll!.prompt), cents: x.broll!.model === 'veo3.1_fast' ? BROLL_CENTS : 0 }, { onConflict: 'blob_path' })
        .then(({ error }) => { if (error) console.error(`[unedit] ${v.id} B-roll not saved to the library: ${error.message}`); });
    } catch (e) { x.broll!.failed = (e instanceof Error ? e.message : String(e)).slice(0, 160); }
  }));
  const { data: cur } = await dbx().from('unedit_vlogs').select('episode_plan').eq('id', v.id).single();
  const ep = (cur?.episode_plan ?? v.episode_plan) as EpisodePlan;
  if (ep.graphics) await dbx().from('unedit_vlogs').update({ episode_plan: { ...ep, graphics: { ...ep.graphics, items: g.items } } }).eq('id', v.id);
  return !g.items.some((x) => x.kind === 'broll' && x.broll?.task && !x.broll.path && !x.broll.failed);
}

// ---- the episode's captions ------------------------------------------------------------------------------------
const CAPTIONS_ON = () => process.env.UNEDIT_EPISODE_CAPTIONS !== 'off';
/** Graphics that sit low in the frame or fill it: captions step aside while one is on screen. */
const CAPTION_CLEAR = new Set(['title', 'lower', 'kinetic', 'ticker', 'end', 'globe', 'chapter', 'article']);
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
  // The branded set (Signal, Newsroom, Documentary) from the best still; the classic looks if it can't be made.
  const branded = await brandedThumbs(v, src, at[order[0]], pre, lines).catch((e) => { console.error(`[unedit] ${v.id} branded thumbnails: ${e instanceof Error ? e.message : e}`); return null; });
  if (branded) { await dbx().from('unedit_vlogs').update({ thumbs: branded, thumb_pick: 0 }).eq('id', v.id); return; }
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

/** A thumbnail line as at most three short lines (one or two words each). */
/** A clip's cover line: the punchy head of its title (before the first colon, comma or "then"), at most six words, so
 *  it reads big on a phone ("Claimed vs established, then your plan" -> "Claimed vs established"). */
function coverLine(title: string): string {
  const t = title.replace(/\s+/g, ' ').trim();
  const head = t.split(/\s*(?:[:,;—–]|\s-\s|\bthen\b)\s*/i)[0].trim();
  const pick = head.split(' ').length >= 2 ? head : t;
  // Six words at most (what thumbLines sets), so a six-word head is never cut mid-phrase.
  return pick.split(' ').slice(0, 6).join(' ').replace(/[.,;:]+$/, '');
}
function thumbLines(text: string, max = 3): string[] {
  const w = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).slice(0, 6);
  if (w.length <= max) return w;
  const per = Math.ceil(w.length / max);
  return Array.from({ length: Math.ceil(w.length / per) }, (_, i) => w.slice(i * per, (i + 1) * per).join(' '));
}

/** The branded thumbnail set: the speaker cut out (MODNet, as the episodes use) from the best still, framed and
 *  graded like the episode, in three looks rendered at once in the Genovus Motion sandbox (ThumbSet):
 *    signal       ink and ember, the speaker large with an orange rim, three bold words, the topic chip (the pick)
 *    newsroom     the cited article tilted in a browser card beside the speaker, a WHAT WE KNOW tag
 *    documentary  full-bleed and studio-lit, one serif line, a quiet mark
 *  Null when the sandbox isn't configured (the classic looks are made instead). */
async function brandedThumbs(v: Vlog, src: string, t: number, pre: string, lines: string[]): Promise<Vlog['thumbs'] | null> {
  if (!proConfigured() || process.env.UNEDIT_THUMBS_BRANDED === 'off') return null;
  await sweepTmp();
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'unedit-thumbset-'));
  try {
    // Half a second at the still, framed and graded like the episode, 1920x1080.
    await ffmpeg(['-ss', Math.max(0, t - 0.1).toFixed(3), '-t', '0.5', '-i', src, '-vf', `${pre ? `${pre},` : ''}scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=30,format=yuv420p`, '-an', '-c:v', 'libx264', '-crf', '12', 'clip.mp4'], d);
    const m = await matte(path.join(d, 'clip.mp4'), 0, 0.5, d, 'm');
    await ffmpeg(['-i', 'clip.mp4', '-i', m, '-filter_complex', `${matteFilter('1:v', 1920, 1080, 'mm')};[0:v][mm]alphamerge,format=rgba`, '-frames:v', '1', 'cutout.png'], d);
    await ffmpeg(['-i', 'clip.mp4', '-frames:v', '1', 'frame.png'], d);
    const cutPath = `${dir(v)}/thumbs/cutout.png`, framePath = `${dir(v)}/thumbs/frame.png`;
    await put(cutPath, await fs.readFile(path.join(d, 'cutout.png')), { access: 'private', contentType: 'image/png', addRandomSuffix: false, allowOverwrite: true });
    await put(framePath, await fs.readFile(path.join(d, 'frame.png')), { access: 'private', contentType: 'image/png', addRandomSuffix: false, allowOverwrite: true });
    const title = String(v.episode?.title ?? v.title ?? '');
    const topic = title.split(/[:\-–—|]/)[0].trim().split(/\s+/).slice(0, 3).join(' ').toUpperCase().slice(0, 26);
    const article = (v.sources ?? []).find((e) => e.kind === 'article');
    const [l0, l1, l2] = [lines[0] ?? title, lines[1] ?? lines[0] ?? title, lines[2] ?? lines[0] ?? title];
    const one = thumbLines(l1, 2);
    const props = {
      cutout: await presigned(cutPath, 60), frame: await presigned(framePath, 60),
      signal: { lines: thumbLines(l0), accent: thumbLines(l0).length - 1, topic },
      newsroom: { lines: one, accent: one.length - 1, kicker: 'WHAT WE KNOW', ...(article ? { article: { publisher: String(article.who ?? ''), headline: String(article.title ?? '') } } : {}) },
      documentary: { lines: [l2.split(/\s+/).slice(0, 4).join(' ')], kicker: title.slice(0, 40) },
    };
    const mp4 = await renderOnSandbox('ThumbSet', props, { codec: 'h264', crf: 12 });
    await fs.writeFile(path.join(d, 'set.mp4'), mp4);
    const looks = ['signal', 'newsroom', 'documentary'] as const;
    const texts = [l0, l1, l2];
    const out: Vlog['thumbs'] = [];
    for (const [k, look] of looks.entries()) {
      await ffmpeg(['-i', 'set.mp4', '-vf', `select=eq(n\\,${k}),scale=1280:720`, '-frames:v', '1', '-q:v', '2', '-pix_fmt', 'yuvj420p', `t${k}.jpg`], d);
      const pth = `${dir(v)}/thumbs/${k + 1}-${look}.jpg`;
      await put(pth, await fs.readFile(path.join(d, `t${k}.jpg`)), { access: 'private', contentType: 'image/jpeg', addRandomSuffix: false, allowOverwrite: true });
      out.push({ blob: pth, text: texts[k], t, look });
    }
    return out;
  } finally { await fs.rm(d, { recursive: true, force: true }).catch(() => {}); }
}

/** Vertical covers for the clips (Instagram Reels, Facebook Reels, YouTube Shorts take a custom cover; until
 *  2026-11-18 they went out with none, so each network picked a frame). Each clip's speaker is cut out from a face
 *  shot of that clip, framed and graded like the episode, and every cover renders in one sandbox call (CoverSet in
 *  Genovus Motion: the clip's hook line over the speaker, all of it inside the 3:4 window the Instagram grid shows).
 *  A clip whose cover can't be made posts with a face frame of the clip as its cover instead (coverMs). */
async function makeClipCovers(v: Vlog, src: string): Promise<string> {
  if (!proConfigured() || process.env.UNEDIT_CLIP_COVERS === 'off') return 'covers off';
  const { data } = await dbx().from('unedit_clips').select('id, n, title, status, blob_path, features').eq('vlog_id', v.id).in('status', ['ready', 'approved']).order('n');
  type Row = { id: string; n: number; title: string; status: string; blob_path: string | null; features: { cover?: { path?: string; of: string; error?: string }; shots?: Shot[] } | null };
  const todo = ((data ?? []) as Row[]).filter((c) => c.blob_path && c.features?.cover?.of !== c.blob_path);
  if (!todo.length) return 'covers current';
  await sweepTmp();
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'unedit-covers-'));
  try {
    const src2 = { width: Number(v.width ?? 1920), height: Number(v.height ?? 1080) };
    const fr = v.look && v.episode_plan ? framing(v.look.face, src2, v.episode_plan.size, FILL.medium) : null;
    const pre = v.look ? [fr ? `crop=${fr.w}:${fr.h}:${fr.x}:${fr.y}` : '', v.look.sdr, gradeFilter(v.look.grade)].filter(Boolean).join(',') : '';
    const title = String(v.episode?.title ?? v.title ?? '');
    const topic = title.split(/[:\-–—|]/)[0].trim().split(/\s+/).slice(0, 3).join(' ').toUpperCase().slice(0, 26);
    const covers: { cutout: string; lines: string[]; topic: string }[] = [];
    for (const c of todo) {
      // The middle of the clip's first face shot (the hook's opening, by design a face), else a second in.
      const face = (c.features?.shots ?? []).find((x) => x.layout === 'face');
      const t = face ? (face.s + face.e) / 2 : Number((c as unknown as { start_s?: number }).start_s ?? 0) + 1;
      const k = c.n;
      await ffmpeg(['-ss', Math.max(0, t - 0.1).toFixed(3), '-t', '0.5', '-i', src, '-vf', `${pre ? `${pre},` : ''}scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=30,format=yuv420p`, '-an', '-c:v', 'libx264', '-crf', '12', `s${k}.mp4`], d);
      const m = await matte(path.join(d, `s${k}.mp4`), 0, 0.5, d, `m${k}`);
      await ffmpeg(['-i', `s${k}.mp4`, '-i', m, '-filter_complex', `${matteFilter('1:v', 1920, 1080, 'mm')};[0:v][mm]alphamerge,format=rgba`, '-frames:v', '1', `cut${k}.png`], d);
      const cutPath = `${dir(v)}/thumbs/clip-${k}-cutout.png`;
      await put(cutPath, await fs.readFile(path.join(d, `cut${k}.png`)), { access: 'private', contentType: 'image/png', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 });
      const line = coverLine(c.title || title);
      // The chip would only repeat a line that already names the topic.
      covers.push({ cutout: await presigned(cutPath, 60), lines: thumbLines(line, 4), topic: line.toUpperCase() === topic ? '' : topic });
    }
    const mp4 = await renderOnSandbox('CoverSet', { covers }, { codec: 'h264', crf: 12 });
    await fs.writeFile(path.join(d, 'covers.mp4'), mp4);
    for (const [i, c] of todo.entries()) {
      await ffmpeg(['-i', 'covers.mp4', '-vf', `select=eq(n\\,${i})`, '-frames:v', '1', '-q:v', '2', '-pix_fmt', 'yuvj420p', `c${i}.jpg`], d);
      // A new name per render: covers are fetched by outside services, and an overwritten name can be served from cache.
      const p = `${dir(v)}/thumbs/clip-${c.n}-cover-${Date.now()}.jpg`;
      await put(p, await fs.readFile(path.join(d, `c${i}.jpg`)), { access: 'private', contentType: 'image/jpeg', addRandomSuffix: false });
      const { data: now } = await dbx().from('unedit_clips').select('blob_path, features').eq('id', c.id).single();
      if (now?.blob_path === c.blob_path) await dbx().from('unedit_clips').update({ features: { ...((now.features as object) ?? {}), cover: { path: p, of: c.blob_path } } }).eq('id', c.id);
    }
    return `covers for clip${todo.length === 1 ? '' : 's'} ${todo.map((c) => c.n).join(', ')}`;
  } catch (e) {
    // Recorded so the step doesn't retry forever; the posts fall back to a face frame of the clip.
    const why = (e instanceof Error ? e.message : String(e)).slice(0, 200);
    for (const c of todo) {
      const { data: now } = await dbx().from('unedit_clips').select('blob_path, features').eq('id', c.id).single();
      if (now?.blob_path === c.blob_path) await dbx().from('unedit_clips').update({ features: { ...((now.features as object) ?? {}), cover: { of: c.blob_path, error: why } } }).eq('id', c.id);
    }
    return `covers failed (${why}); the posts use a face frame instead`;
  } finally { await fs.rm(d, { recursive: true, force: true }).catch(() => {}); }
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
  | { tool: 'tighten' }
  | { tool: 'post_longform' }
  | { tool: 'set_article_mode'; mode: 'bubble' | 'cutout' }
  | { tool: 'set_package'; pkg: string }
  | { tool: 'set_sources'; sheet: string }
  | { tool: 'draft_scenes'; url?: string; text?: string }
  | { tool: 'approve_scenes'; keep: number[] }
  | { tool: 'drop_graphic'; kind: string; text: string; T: number }
  | { tool: 'approve'; mode?: PostMode; rhythm?: Rhythm; at?: Record<string, string> }
  | { tool: 'move_post'; post: string; at: string }
  | { tool: 'cancel_post'; post: string };

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
      const frame = { face: ep.face, src: ep.src, size: ep.size, edit: vlog.edit };
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
      const graphics: Graphics = { ...gr, ...styled(base, gr.pkg ?? packageOf(null), { face: ep.face, src: ep.src, size: ep.size, edit: vlog.edit }, ep.secs), error: null, qa: undefined };
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
    case 'draft_scenes': {
      // The scene plan from the episode's article, checked against the article and this recording's own words.
      if (vlog.stage === 'published' || vlog.stage === 'publishing') throw new Error('This campaign is already approved.');
      if (!vlog.transcript_blob) throw new Error('Wait until the recording is transcribed.');
      const said = (await readWords(vlog)).map((w) => w.w).join(' ');
      const plan = await planRecording(vlog.tenant_id, { id, title: vlog.title, sources: vlog.sources ?? null }, said, { url: t.url, text: typeof t.text === 'string' ? t.text.slice(0, 120_000) : undefined }, by);
      await dbx().from('unedit_vlogs').update({ scene_plan: plan }).eq('id', id);
      await log('draft-scenes', id, { scenes: plan.scenes.length, cents: plan.cents, by });
      return plan.scenes.length ? `Helix proposes ${plan.scenes.length} ${plan.scenes.length === 1 ? 'scene' : 'scenes'} from the article. Pick the ones to add.` : `No scene passed the checks this time.${plan.notes.length ? ` ${plan.notes[0]}.` : ''}`;
    }
    case 'approve_scenes': {
      // Approved scenes become scene lines on the sheet, saved through set_sources (parse, replan, notes).
      if (!vlog.scene_plan) throw new Error('Draft the scene plan first.');
      const { entries, added } = withScenes(vlog.sources, vlog.scene_plan, (Array.isArray(t.keep) ? t.keep : []).map(Number).filter(Number.isInteger));
      const say = await tap(id, { tool: 'set_sources', sheet: sheetText(entries) }, by, origin);
      await dbx().from('unedit_vlogs').update({ scene_plan: { ...vlog.scene_plan, approved: { keep: t.keep, at: new Date().toISOString() } } }).eq('id', id);
      return `${added} ${added === 1 ? 'scene' : 'scenes'} on the sheet. ${say}`;
    }
    case 'set_article_mode': {
      // Article cut-ins: the speaker in a corner bubble, or cut out and standing beside the article. The reel and the
      // parts render again (the plan, words and pictures stay).
      inReview();
      const mode = t.mode === 'cutout' ? 'cutout' : 'bubble';
      const gr = vlog.episode_plan?.graphics;
      if (!vlog.episode_plan || !gr?.items.some((x) => x.kind === 'article' && x.bubble)) return 'This episode has no article cut-ins with the speaker.';
      const items = gr.items.map((x) => (x.kind === 'article' && x.bubble ? { ...x, bubble: { ...x.bubble, mode } } : x));
      await dbx().from('unedit_episode_parts').update({ status: 'todo', attempts: 0, error: null, lease_until: null, blob_path: null }).eq('vlog_id', id);
      const graphics = { ...gr, items, articleMode: mode, error: null, reelTries: 0, qa: undefined, reels: gr.reels?.map((x) => ({ from: x.from, to: x.to })) };
      await dbx().from('unedit_vlogs').update({ episode_plan: { ...vlog.episode_plan, graphics }, episode_path: null, stage: 'rendering', stage_at: new Date().toISOString(), lease_until: null }).eq('id', id);
      await log('article-mode', id, { mode });
      await kick(origin, id);
      return mode === 'cutout' ? 'Article cut-ins: you, cut out, beside the article. The episode renders again.' : 'Article cut-ins: you in a corner bubble. The episode renders again.';
    }
    case 'post_longform': {
      if (!(await deskById(vlog.tenant_id)).house) throw new Error('On an agency desk the full video goes out with the campaign, after the owner approves it.');
      // The full episode to YouTube on its own, before (or without) the clips: the polished episode when there is one,
      // else the recording as shot. The person's own click on the card; Approve later won't post it twice.
      if (!['review', 'publishing', 'published'].includes(vlog.stage)) throw new Error('The full video can be posted once it is ready for review.');
      if (vlog.episode_plan && !vlog.episode_plan.error && !vlog.episode_path) throw new Error('The polished episode is still rendering.');
      const { data: had } = await dbx().from('unedit_posts').select('id').eq('vlog_id', id).eq('platform', 'youtube').eq('kind', 'video').in('status', ['sent', 'posted']);
      if (had?.length) return 'The full video is already on its way to YouTube.';
      await dbx().from('unedit_posts').delete().eq('vlog_id', id).eq('platform', 'youtube').eq('kind', 'video').in('status', ['queued', 'error', 'skipped']);
      const ins = await dbx().from('unedit_posts').insert({ tenant_id: vlog.tenant_id, vlog_id: id, platform: 'youtube', kind: 'video', clip_id: null, title: vlog.episode.title || vlog.title || 'New video', body: vlog.episode.description ?? '', ai_label: Boolean(vlog.faceless) }).select('id').single();
      if (ins.error || !ins.data) throw new Error(ins.error?.message ?? 'The post was not created.');
      const r = await distribute(vlog, [ins.data.id as string]);
      await log('post-longform', id, { ...r, by });
      if (!r.sent) throw new Error(`It didn't go to YouTube: ${r.failed[0] ?? r.skipped[0] ?? 'unknown'}`);
      return `The full video is going to YouTube${r.live ? ' (it goes live in about 15 minutes; the link appears here)' : ' as a draft in Metricool'}.`;
    }
    case 'tighten': {
      // Tighten the edit (Studio Live): the dialogue editor runs again and the episode is re-cut and re-rendered.
      inReview();
      if (!vlog.edit || !vlog.episode_plan || vlog.episode_plan.error) return 'This recording has no episode to tighten.';
      await dbx().from('unedit_episode_parts').update({ status: 'todo', attempts: 0, error: null, lease_until: null, blob_path: null }).eq('vlog_id', id);
      await dbx().from('unedit_vlogs').update({ edit: { ...vlog.edit, reclean: true }, episode_path: null, stage: 'rendering', stage_at: new Date().toISOString(), lease_until: null }).eq('id', id);
      await log('tighten', id, {});
      await kick(origin, id);
      return 'Helix is tightening the edit: restarts, repeats and stumbles out, names checked. The episode renders again after.';
    }
    case 'retry_episode': {
      // The polished episode stopped (the clips went on to review): fresh tries for its failed parts, before approval.
      inReview();
      const gr = vlog.episode_plan?.graphics;
      if (vlog.episode_plan && gr?.error && gr.items.length) {
        // The episode finished (or stopped) without its graphics: render the reel again and lay it over every part. A
        // part that also failed gets its fresh tries here too, so one retry brings back both (a47f35a0, 2026-11-17).
        await dbx().from('unedit_episode_parts').update({ status: 'todo', attempts: 0, error: null, lease_until: null, blob_path: null }).eq('vlog_id', id);
        const graphics = { ...gr, error: null, reelTries: 0, reels: gr.reels?.map((r) => ({ from: r.from, to: r.to })) };
        await dbx().from('unedit_vlogs').update({ episode_plan: { ...vlog.episode_plan, error: null, graphics }, episode_path: null, stage: 'rendering', stage_at: new Date().toISOString(), lease_until: null }).eq('id', id);
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
      if (!vlog.episode_plan?.error) {
        // Parts that finished without some of their graphics or captions (the card says "check before approving"):
        // render just those again (their pictures are kept, so only the graphics are laid again), then join again.
        const { data: gaps } = await dbx().from('unedit_episode_parts').select('k').eq('vlog_id', id).eq('status', 'done').not('error', 'is', null);
        if (!gaps?.length) return 'The episode is fine.';
        await dbx().from('unedit_episode_parts').update({ status: 'todo', attempts: 0, error: null, lease_until: null, blob_path: null }).eq('vlog_id', id).in('k', gaps.map((g) => g.k));
        await dbx().from('unedit_vlogs').update({ episode_path: null, stage: 'rendering', stage_at: new Date().toISOString(), lease_until: null }).eq('id', id);
        await log('retry-episode', id, { gaps: gaps.map((g) => g.k) });
        await kick(origin, id);
        return `Rendering ${gaps.length === 1 ? 'part ' + (gaps[0].k + 1) : `${gaps.length} parts`} again with ${gaps.length === 1 ? 'its' : 'their'} graphics.`;
      }
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
      // One Approve: every clip that is ready goes, unless it was left out. A clip still being cut (or redone) holds
      // the Approve, so nobody approves a clip they haven't seen.
      const busyClip = clips.find((c) => c.status === 'rendering' || c.status === 'redo');
      if (busyClip) throw new Error(`Clip ${busyClip.n} is still being cut. Approve once it is ready.`);
      const approved = clips.filter((c) => c.status === 'approved' || c.status === 'ready');
      // A long-form already sent from the card (Post the full video) isn't posted again.
      const { data: lf } = await dbx().from('unedit_posts').select('id').eq('vlog_id', id).eq('platform', 'youtube').eq('kind', 'video').in('status', ['sent', 'posted']);
      const longform = !lf?.length;
      const rows = [
        ...approved.flatMap((c) => [
          { platform: 'instagram', kind: 'reel', clip_id: c.id, title: c.title, body: c.copy.instagram || c.caption },
          { platform: 'facebook', kind: 'reel', clip_id: c.id, title: c.title, body: c.copy.facebook || c.caption },
          { platform: 'youtube', kind: 'short', clip_id: c.id, title: c.copy.youtube || c.title, body: c.caption },
        ]),
        ...(longform ? [{ platform: 'youtube', kind: 'video', clip_id: null as string | null, title: vlog.episode.title || vlog.title || 'New video', body: vlog.episode.description ?? '' }] : []),
      ];
      // When each post goes out: now, Helix's plan, or the user's calendar (the times the card showed, checked here).
      const mode: PostMode = t.mode === 'plan' || t.mode === 'calendar' ? t.mode : 'now';
      const start = new Date();
      const plan = campaignPosts(approved.map((c) => ({ id: c.id, n: c.n, hook: c.hook_start_s != null })), longform);
      const ctx = mode === 'now' ? null : await postingContext(vlog);
      const rhythm: Rhythm | null = !ctx ? null : (t.rhythm && ['flood', 'drip', 'steady'].includes(t.rhythm) ? t.rhythm : ctx.rec.rhythm);
      const planned = !ctx || !rhythm ? nowTimes(plan, start) : planPosts(plan, { rhythm, start, busy: ctx.busy });
      const soonest = start.getTime() + 5 * 60_000, latest = start.getTime() + 60 * 86_400_000;
      const chosen = (key: string) => {
        const asked = t.at?.[key] ? Date.parse(t.at[key]) : NaN;
        // A time from the card is used when it is real and within 60 days; one already past goes out right away.
        if (mode !== 'now' && Number.isFinite(asked) && asked <= latest) return new Date(Math.max(asked, soonest)).toISOString();
        return planned[key] ?? new Date(soonest).toISOString();
      };
      // An agency desk: the copy check decides, its own Metricool brand must be connected, and nothing goes out until the
      // owner approves in his Approvals (decide_approval moves the posts to the calendar).
      const desk = await deskById(vlog.tenant_id);
      // An agency posts only to the networks connected on its own brand.
      if (desk.profile?.networks?.length) { const nets = desk.profile.networks; for (let i = rows.length - 1; i >= 0; i--) if (!nets.includes(rows[i].platform)) rows.splice(i, 1); }
      if (desk.profile && !rows.length) throw new Error(`${desk.name} has none of these networks connected on its Metricool brand.`);
      if (desk.profile) {
        const issues = checkAll(rows.flatMap((r) => [{ where: `${r.clip_id ? `clip ${approved.find((c) => c.id === r.clip_id)?.n ?? ''}` : 'full video'} ${r.platform} title`, text: r.title ?? '' }, { where: `${r.clip_id ? `clip ${approved.find((c) => c.id === r.clip_id)?.n ?? ''}` : 'full video'} ${r.platform} caption`, text: r.body ?? '' }]), desk.profile);
        if (issues.length) throw new Error(`Fix the copy first (${desk.name}'s rules): ${issues.slice(0, 3).map((i) => `${i.where}: “${i.match}” (${i.why})`).join('; ')}${issues.length > 3 ? ` and ${issues.length - 3} more` : ''}.`);
        await blogFor(vlog.tenant_id);
      }
      const posts = rows.map((p) => ({ ...p, tenant_id: vlog.tenant_id, vlog_id: id, ai_label: false, scheduled_at: chosen(postKey(p.clip_id, p.platform, p.kind)), ...(desk.profile ? { status: 'awaiting_owner' } : {}) }));
      // Ready clips are approved by this Approve (left-out clips stay out).
      const readyIds = approved.filter((c) => c.status === 'ready').map((c) => c.id);
      if (readyIds.length) await dbx().from('unedit_clips').update({ status: 'approved' }).in('id', readyIds).eq('status', 'ready');
      await dbx().from('unedit_posts').delete().eq('vlog_id', id).in('status', ['queued', 'awaiting_owner']);
      const ins = await dbx().from('unedit_posts').insert(posts);
      if (ins.error) throw new Error(ins.error.message);
      const postPlan = { mode, rhythm, why: rhythm && ctx && rhythm === ctx.rec.rhythm ? ctx.rec.why : null, by, at: start.toISOString() };
      // Posts due within the send window go now; the rest wait on the calendar and the cron sends each in its time.
      const dueNow = !desk.profile && posts.some((p) => Date.parse(p.scheduled_at) <= start.getTime() + SEND_AHEAD_MIN * 60_000);
      await dbx().from('unedit_vlogs').update({ stage: dueNow ? 'publishing' : 'published', stage_at: start.toISOString(), approved_by: by, approved_at: start.toISOString(), lease_until: null, post_plan: postPlan }).eq('id', id).eq('stage', 'review');
      await log('approve', id, { clips: approved.length, posts: posts.length, mode, rhythm, by });
      // Its B-roll joins the approved library (reused by later episodes once three are approved).
      await dbx().from('unedit_assets').update({ approved: true }).eq('vlog_id', id);
      if (dueNow) await kick(origin, id);
      const first = posts.map((p) => p.scheduled_at).sort()[0];
      const firstAt = first ? new Date(first).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : '';
      if (desk.profile) {
        // One approval for the whole campaign in the owner's Approvals: every clip with its copy and time.
        const nOf = new Map(approved.map((c) => [c.id, c.n]));
        const when = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
        await dbx().from('approvals').update({ status: 'changes_requested', decision_note: 'Replaced by a newer version of this campaign.', decided_at: new Date().toISOString() }).eq('unedit_vlog_id', id).eq('status', 'pending');
        const ap = await dbx().from('approvals').insert({
          tenant_id: vlog.tenant_id, subject_kind: 'post', lane: 'required', approver: 'client', unedit_vlog_id: id,
          title: `Your video: ${vlog.episode.title || vlog.title || 'New video'} · ${posts.length} posts`,
          body: { kind: 'unedit', recording: vlog.episode.title || vlog.title, clips: approved.map((c) => ({ n: c.n, title: c.title, caption: c.caption })),
            posts: posts.map((p) => ({ clip: p.clip_id ? nOf.get(p.clip_id) ?? null : null, network: p.platform, kind: p.kind, title: p.title, text: p.body, when: when(p.scheduled_at) })), first: firstAt, rhythm },
        });
        if (ap.error) throw new Error(ap.error.message);
        await log('sent-to-owner', id, { posts: posts.length, desk: desk.slug, by });
        return `Sent to ${desk.profile.host} for approval: ${posts.length} post${posts.length === 1 ? '' : 's'}${rhythm ? ` (${rhythm})` : ''}, the first ${firstAt}. Nothing goes out until he approves in his Genovus Approvals.`;
      }
      return mode === 'now'
        ? `Approved: ${posts.length} post${posts.length === 1 ? '' : 's'} going to Metricool${metricoolLive() ? '' : ' as drafts'} now.`
        : `Approved: ${posts.length} post${posts.length === 1 ? '' : 's'} on the calendar${rhythm ? ` (${rhythm})` : ''}, the first ${firstAt}. Move or cancel any of them until it goes out.`;
    }
    case 'move_post': case 'cancel_post': {
      const { data: p } = await dbx().from('unedit_posts').select('id, status').eq('id', t.post).eq('vlog_id', id).maybeSingle();
      if (!p) throw new Error('Post not found.');
      if (p.status !== 'queued' && p.status !== 'awaiting_owner') throw new Error('This post already went to Metricool, so it can no longer be changed here.');
      if (t.tool === 'cancel_post') {
        const r = await dbx().from('unedit_posts').update({ status: 'cancelled' }).eq('id', p.id).eq('status', 'queued').select('id');
        if (!r.data?.length) throw new Error('This post just went out; it can no longer be cancelled.');
        await log('cancel-post', id, { post: p.id, by });
        return 'Post taken off the calendar.';
      }
      const at = Date.parse(t.at);
      if (!Number.isFinite(at)) throw new Error('Pick a day and time.');
      if (at < Date.now() + LEAD_MIN * 60_000) throw new Error(`Pick a time at least ${LEAD_MIN} minutes from now.`);
      if (at > Date.now() + 60 * 86_400_000) throw new Error('Pick a time within the next 60 days.');
      const r = await dbx().from('unedit_posts').update({ scheduled_at: new Date(at).toISOString() }).eq('id', p.id).eq('status', 'queued').select('id');
      if (!r.data?.length) throw new Error('This post just went out; it can no longer be moved.');
      await log('move-post', id, { post: p.id, at: new Date(at).toISOString(), by });
      return `Moved to ${new Date(at).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })}.`;
    }
  }
}

// ---- distribution -----------------------------------------------------------------------------------------------
/** A calendar post is sent to Metricool this long before its time (Metricool copies the video when it is sent). */
export const SEND_AHEAD_MIN = 45;

/** What Helix plans from: the story behind the recording (the Newsroom production it was cut against, the story's
 *  heat in the latest morning brief that ranked it, and its age) and the brand's other posts already on the calendar. */
export async function postingContext(v: { id: string; tenant_id: string }): Promise<{ signal: Signal; rec: { rhythm: Rhythm; why: string }; busy: Busy[] }> {
  const signal: Signal = { headline: null, heat: null, ageH: null, fit: null };
  const { data: prod } = await dbx().from('newsroom_productions').select('story_id').eq('vlog_id', v.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (prod?.story_id) {
    const { data: st } = await dbx().from('newsroom_stories').select('headline, fit, published_on, created_at').eq('id', prod.story_id).maybeSingle();
    if (st) {
      signal.headline = st.headline; signal.fit = st.fit ?? null;
      const born = Date.parse(st.published_on ? `${st.published_on}T12:00:00Z` : st.created_at);
      if (Number.isFinite(born)) signal.ageH = Math.max(0, (Date.now() - born) / 3_600_000);
    }
    const { data: briefs } = await dbx().from('newsroom_briefs').select('hot').eq('tenant_id', v.tenant_id).order('day', { ascending: false }).limit(7);
    for (const b of briefs ?? []) {
      const h = ((b.hot ?? []) as { story_id?: string; heat?: number }[]).find((x) => x.story_id === prod.story_id && typeof x.heat === 'number');
      if (h) { signal.heat = Math.round(h.heat!); break; }
    }
  }
  const { data: later } = await dbx().from('unedit_posts').select('platform, scheduled_at').eq('tenant_id', v.tenant_id).neq('vlog_id', v.id).in('status', ['queued', 'sent']).gte('scheduled_at', new Date().toISOString()).limit(500);
  const busy: Busy[] = (later ?? []).filter((p) => p.scheduled_at).map((p) => ({ platform: p.platform, at: p.scheduled_at as string }));
  return { signal, rec: recommend(signal), busy };
}

/** Every minute (studio cron): recordings whose calendar posts are coming due go back to 'publishing', where the
 *  cron's next kick sends just those posts. The lease on each recording keeps two sends from overlapping. */
export async function sweepDuePosts(): Promise<number> {
  const dueBy = new Date(Date.now() + SEND_AHEAD_MIN * 60_000).toISOString();
  const { data } = await dbx().from('unedit_posts').select('vlog_id').eq('status', 'queued').lte('scheduled_at', dueBy).limit(200);
  const ids = [...new Set((data ?? []).map((p) => p.vlog_id as string))];
  let n = 0;
  for (const id of ids) {
    const r = await dbx().from('unedit_vlogs').update({ stage: 'publishing', stage_at: new Date().toISOString() }).eq('id', id).eq('stage', 'published').select('id');
    if (r.data?.length) { await log('due', id, {}); n++; }
  }
  return n;
}
/** Send the approved posts to Metricool on the Genovus brand. Media goes by presigned links (valid six days), which
 *  Metricool copies when it saves the post. Real footage: every AI flag is false. */
export async function distribute(v: Vlog, only?: string[]): Promise<{ sent: number; skipped: string[]; failed: string[]; live: boolean; left: number }> {
  const out = { sent: 0, skipped: [] as string[], failed: [] as string[], live: metricoolLive(), left: 0 };
  const t0 = Date.now();
  // Only the posts that are due: on the calendar, a post goes to Metricool SEND_AHEAD_MIN before its time (the rest
  // wait, and can be moved or cancelled until then). No time means as soon as possible.
  const dueBy = new Date(Date.now() + SEND_AHEAD_MIN * 60_000).toISOString();
  let q = dbx().from('unedit_posts').select('*').eq('vlog_id', v.id).eq('status', 'queued').or(`scheduled_at.is.null,scheduled_at.lte.${dueBy}`).order('scheduled_at', { ascending: true, nullsFirst: true });
  if (only?.length) q = q.in('id', only);
  const { data: rows } = await q;
  const posts = (rows ?? []) as UPost[];
  // The desk's own Metricool brand (an agency without one can't post: its due posts fail with the reason).
  let blog = '';
  try { blog = await blogFor(v.tenant_id); } catch (e) {
    if (posts.length) await dbx().from('unedit_posts').update({ status: 'error', mc_error: e instanceof Error ? e.message : 'No Metricool brand.' }).in('id', posts.map((p) => p.id)).eq('status', 'queued');
    out.failed.push(...posts.map((p) => p.id)); return out;
  }
  if (!metricoolConfigured()) {
    if (posts.length) await dbx().from('unedit_posts').update({ status: 'skipped', mc_error: 'Metricool is not connected on this deployment.' }).in('id', posts.map((p) => p.id)).eq('status', 'queued');
    out.skipped.push('Metricool is not connected');
    return out;
  }
  const { data: cs } = await dbx().from('unedit_clips').select('id, blob_path, features').eq('vlog_id', v.id);
  const clipPath = new Map((cs ?? []).map((c) => [c.id as string, c.blob_path as string | null]));
  // Each clip's vertical cover (makeClipCovers) when it was made for this render of the clip, else a face frame of it.
  type CF = { cover?: { path?: string; of: string }; shots?: Shot[] } | null;
  const clipCover = new Map((cs ?? []).map((c) => { const f = c.features as CF; return [c.id as string, f?.cover?.path && f.cover.of === c.blob_path ? f.cover.path : null]; }));
  const clipFaceMs = new Map((cs ?? []).map((c) => { const sh = (c.features as CF)?.shots ?? []; const i = sh.findIndex((x) => x.layout === 'face'); const at = i < 0 ? 1 : sh.slice(0, i).reduce((a, x) => a + (x.e - x.s), 0) + (sh[i].e - sh[i].s) / 2; return [c.id as string, at * 1000]; }));
  const thumb = v.thumbs?.[v.thumb_pick ?? 0]?.blob;
  const mins = 6 * 24 * 60;
  for (const p of posts) {
    // Its calendar time, or a few minutes from now when that has passed (Metricool needs time to copy the video).
    const when = new Date(Math.max(p.scheduled_at ? Date.parse(p.scheduled_at) : 0, Date.now() + 10 * 60_000));
    // Each post can take minutes (Metricool copies the video): stop starting new ones before the function's limit and
    // leave the rest queued for the next step.
    if (Date.now() - t0 > 9 * 60_000) { out.left++; continue; }
    // The full video is the polished episode when Episode Pro made one, else the recording as shot.
    const media = p.clip_id ? clipPath.get(p.clip_id) : (v.episode_path ?? v.blob_path);
    if (!media) { await dbx().from('unedit_posts').update({ status: 'skipped', mc_error: 'No video for this post.' }).eq('id', p.id); out.skipped.push(`${p.platform} ${p.kind}`); continue; }
    const r = await schedulePost({
      // A faceless video is narrated by an AI voice: the post says so and carries the platform's AI-content flag.
      blogId: blog, network: p.platform, text: v.faceless && !/AI voice/i.test(p.body) ? `${p.body}

Narrated by an AI voice.` : p.body, title: p.title ?? undefined, mediaUrl: await presigned(media, mins), when,
      vertical: p.kind !== 'video', aiGenerated: Boolean(v.faceless), format: p.platform === 'youtube' ? undefined : 'reel',
      // A link that answers HEAD as well as GET (lib/unedit-share.ts): storage links refuse HEAD, so YouTube never got it.
      // Every post carries a cover: the full video its chosen thumbnail, each clip its vertical cover (or a face frame).
      ...(await (async () => {
        const img = p.clip_id ? clipCover.get(p.clip_id) : p.kind === 'video' ? thumb : null;
        if (img) return { thumbnailUrl: thumbLink(img, mins) ?? await presigned(img, mins) };
        return p.clip_id ? { coverMs: clipFaceMs.get(p.clip_id) ?? 1000 } : {};
      })()),
    });
    // A timeout may still have created the post: look for it before calling it failed (never schedule twice).
    const found = !r.ok && /timeout|aborted/i.test(r.error) ? await findPostLike(blog, p.platform, p.body, when).catch(() => null) : null;
    if (r.ok || found) { await dbx().from('unedit_posts').update({ status: 'sent', mc_post_id: r.ok ? r.data.id : found!.id, mc_status: r.ok ? r.data.status : 'PENDING', mc_error: null }).eq('id', p.id); out.sent++; }
    else { await dbx().from('unedit_posts').update({ status: 'error', mc_error: r.error }).eq('id', p.id); out.failed.push(`${p.platform} ${p.kind}: ${r.error}`); }
  }
  return out;
}

/** Metricool reports a YouTube video whose custom thumbnail was refused as ERROR, "published with some warnings":
 *  the video IS live (every Unedit long-form until 2026-11-16 was marked failed this way). */
const publishedAnyway = (detail: string | null) => /published with (some )?warnings/i.test(detail ?? '');
/** The live link: Metricool's, else the YouTube watch link from the video id it reports. */
const liveUrl = (s: { url: string | null; networkId: string | null }) => s.url ?? (s.networkId && /^[\w-]{11}$/.test(s.networkId) ? `https://www.youtube.com/watch?v=${s.networkId}` : null);

/** Every minute: posts Metricool has published get their live link; failures are recorded. */
export async function syncUneditPosts(): Promise<{ checked: number; posted: number }> {
  const out = { checked: 0, posted: 0 };
  if (!metricoolConfigured()) return out;
  // Posts marked failed that actually went live (published with warnings) are looked at again for their link.
  const blogs = new Map<string, string>();
  const blogOf = async (t: string) => { if (!blogs.has(t)) blogs.set(t, await blogFor(t).catch(() => '')); return blogs.get(t)!; };
  const { data: warned } = await dbx().from('unedit_posts').select('id, mc_post_id, tenant_id').eq('status', 'error').ilike('mc_error', '%published with%warnings%').limit(10);
  for (const p of warned ?? []) {
    const b = await blogOf(p.tenant_id as string); if (!b) continue;
    const r = await postStatus(b, Number(p.mc_post_id));
    if (r.ok && (r.data.status === 'PUBLISHED' || publishedAnyway(r.data.detail))) { await dbx().from('unedit_posts').update({ status: 'posted', mc_status: 'PUBLISHED', posted_url: liveUrl(r.data) }).eq('id', p.id); out.posted++; }
  }
  const { data } = await dbx().from('unedit_posts').select('id, mc_post_id, mc_status, tenant_id').eq('status', 'sent').limit(25); // every in-flight state (SCHEDULED, PENDING, PUBLISHING, ...): 'sent' is never final
  for (const p of data ?? []) {
    out.checked++;
    const b = await blogOf(p.tenant_id as string); if (!b) continue;
    const r = await postStatus(b, Number(p.mc_post_id));
    if (!r.ok) continue;
    if (r.data.status === 'PUBLISHED') { await dbx().from('unedit_posts').update({ status: 'posted', mc_status: 'PUBLISHED', posted_url: r.data.url }).eq('id', p.id); out.posted++; }
    else if (r.data.status === 'ERROR' && publishedAnyway(r.data.detail)) { await dbx().from('unedit_posts').update({ status: 'posted', mc_status: 'PUBLISHED', posted_url: liveUrl(r.data), mc_error: r.data.detail }).eq('id', p.id); out.posted++; }
    else if (r.data.status === 'ERROR') await dbx().from('unedit_posts').update({ status: 'error', mc_status: 'ERROR', mc_error: r.data.detail ?? 'Metricool reported an error' }).eq('id', p.id);
    else if (r.data.status !== p.mc_status) await dbx().from('unedit_posts').update({ mc_status: r.data.status }).eq('id', p.id);
  }
  return out;
}
