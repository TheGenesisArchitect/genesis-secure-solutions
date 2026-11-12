// Unedit (Studio): one take in, a campaign out. Server only.
//   uploaded     → read the recording, pull its audio, transcribe it (words with times)       → finding
//   finding      → Claude picks the clips and writes the copy, the episode title, thumb lines   → rendering
//   rendering    → each clip rendered 9:16 with word captions; then three thumbnails            → review
//   review       → the card: Approve or Redo each clip, pick a thumbnail, Approve the campaign   → publishing
//   publishing   → Metricool drafts (or scheduled posts when METRICOOL_MODE=publish)           → published
// One step at a time, under a lease, run by /api/studio/unedit/[id]/step (kicked by the Studio cron and right after
// an upload or a tap). A failed step keeps its files, records the error and waits for Retry; nothing loops.
// Every cost goes through unedit_spend, which refuses past the monthly Studio budget. Nothing posts without the
// Approve tap, and real footage is never labeled AI-generated.
import 'server-only';
import fs from 'node:fs/promises';
import { put } from '@vercel/blob';
import { adminDb } from '@/lib/supabase/admin';
import { siteOrigin } from '@/lib/cron';
import { extractAudio, frames, presigned, probe, renderClip, type Probe, type Span, type Word } from '@/lib/unedit-media';
import { costCents, defaultProvider, transcribe, type Provider } from '@/lib/unedit-transcribe';
import { pickStills, planVlog, redoClip, type Pick } from '@/lib/unedit-moments';
import { LOOKS, renderThumb } from '@/lib/unedit-thumb';
import { GENOVUS_BLOG_ID, metricoolConfigured, metricoolLive, postStatus, schedulePost } from '@/lib/metricool';

export type Stage = 'uploaded' | 'transcribing' | 'finding' | 'rendering' | 'review' | 'publishing' | 'published' | 'failed';
export type Vlog = {
  id: string; tenant_id: string; title: string | null; file_name: string | null; blob_path: string; blob_url: string; bytes: number; fingerprint: string;
  duration_s: number | null; width: number | null; height: number | null; rotation: number | null; vcodec: string | null;
  stage: Stage; stage_at: string; lease_until: string | null; attempts: number; error: string | null; provider: Provider | 'mock' | null;
  transcript_blob: string | null; words: number | null; episode: { title?: string; description?: string; tags?: string[]; dropped?: string[] };
  thumbs: { blob: string; text: string; t: number; look: string }[]; thumb_pick: number | null; cost_cents: number; created_at: string; approved_at: string | null;
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
      const mp3 = await extractAudio(src);
      const t = await transcribe(mp3, p.duration, provider);
      const path = `${dir(v)}/transcript-${provider}.json`;
      await put(path, JSON.stringify({ provider, words: t.words }), { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true });
      await advance(v.id, 'finding', { provider, transcript_blob: path, words: t.words.length });
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
      await advance(v.id, 'rendering', { title: plan.episode.title, episode: { ...plan.episode, dropped: plan.dropped, thumb_lines: plan.thumbs } });
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
        const spans: Span[] = [...(next.hook_start_s != null && next.hook_end_s != null ? [{ from: Number(next.hook_start_s), to: Number(next.hook_end_s) }] : []), { from: Number(next.start_s), to: Number(next.end_s) }];
        const out = await renderClip(src, spans, words, probeOf(v));
        try {
          const bytes = await fs.readFile(out.file);
          const path = `${dir(v)}/clips/${next.n}-${Date.now()}.mp4`;
          await put(path, bytes, { access: 'private', contentType: 'video/mp4', addRandomSuffix: false, allowOverwrite: true, abortSignal: AbortSignal.timeout(180_000) });
          await dbx().from('unedit_clips').update({ blob_path: path, secs: Math.round(out.secs * 10) / 10, status: 'ready', error: null }).eq('id', next.id);
        } finally { await fs.rm(out.dir, { recursive: true, force: true }).catch(() => {}); }
        await release(v.id); // the route kicks the next clip right away, in a fresh function
        return `Rendered clip ${next.n}.`;
      }
      if (!v.thumbs?.length) {
        await makeThumbs(v, src);
      }
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

/** Three thumbnail options: Claude picks the three best stills of the speaker from eight, each gets a line and a look. */
async function makeThumbs(v: Vlog, src: string) {
  const dur = Number(v.duration_s ?? 60);
  const at = Array.from({ length: 8 }, (_, i) => Math.round(((i + 0.5) / 8) * dur * 10) / 10);
  const small = await frames(src, at, 512);
  const { order, cents } = await pickStills(small);
  await spend(v.id, cents, 'thumbnail stills (Claude)');
  const lines = ((v.episode as { thumb_lines?: string[] }).thumb_lines ?? []).concat([v.episode.title ?? v.title ?? 'New video']).filter(Boolean);
  const big = await frames(src, order.map((i) => at[i]), 1280);
  const thumbs: Vlog['thumbs'] = [];
  for (const [k, still] of big.entries()) {
    const look = LOOKS[k % LOOKS.length];
    const text = lines[k % lines.length];
    const jpg = await renderThumb(still, text, look);
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
    case 'retry': {
      if (!vlog.error) return 'Nothing to retry.';
      await dbx().from('unedit_vlogs').update({ error: null, lease_until: null }).eq('id', id);
      await dbx().from('unedit_clips').update({ status: 'rendering', error: null }).eq('vlog_id', id).eq('status', 'failed');
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
    const media = p.clip_id ? clipPath.get(p.clip_id) : v.blob_path;
    if (!media) { await dbx().from('unedit_posts').update({ status: 'skipped', mc_error: 'No video for this post.' }).eq('id', p.id); out.skipped.push(`${p.platform} ${p.kind}`); continue; }
    const r = await schedulePost({
      blogId: GENOVUS_BLOG_ID(), network: p.platform, text: p.body, title: p.title ?? undefined, mediaUrl: await presigned(media, mins), when,
      vertical: p.kind !== 'video', aiGenerated: false, format: p.platform === 'youtube' ? undefined : 'reel',
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
