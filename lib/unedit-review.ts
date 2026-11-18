// Review copies: what the card plays. The masters are heavy (the 3.7-min "California Sues OpenAI" episode is
// 3000x2160 at 33 Mbps, its Pro clips 17-23 Mbps), more than a typical connection streams, so review stuttered
// throughout. Each episode and clip gets a light 1080p copy (capped near 3.5 Mbps, moov up front, steady 2 s
// keyframes) that plays smoothly and seeks instantly. The masters stay what posts, the quality check and
// "Full quality" use; a review copy is only ever shown on the card.
//
// The episode copy is built per part (each part's copy is made right after the part renders, or here from its
// blob for older episodes) and joined without re-encoding (about 20 min fits the scratch disk), with the master's own soundtrack. Every part copy is
// encoded with the same settings, so the joins are seamless. Work is resumable: a copy that exists is reused.
import 'server-only';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { put, head, del } from '@vercel/blob';
import { adminDb } from '@/lib/supabase/admin';
import { ffmpeg, presigned, tmpFreeMB } from '@/lib/unedit-media';
import { siteOrigin } from '@/lib/cron';

const dbx = () => adminDb();
const WEB = ['-protocol_whitelist', 'file,http,https,tcp,tls,crypto'];
/** One encode for every review copy: identical streams are what let parts join with -c copy. */
const VIDEO = ['-vf', "scale='if(gt(iw,ih),-2,1080)':'if(gt(iw,ih),1080,-2)':flags=lanczos,fps=30,format=yuv420p",
  '-c:v', 'libx264', '-preset', 'fast', '-profile:v', 'high', '-level:v', '4.1', '-crf', '23', '-maxrate', '3500k', '-bufsize', '7000k',
  '-g', '60', '-keyint_min', '60', '-sc_threshold', '0', '-bf', '2', '-video_track_timescale', '15360'];
const MBPS = 3; // a safe rate under the 3.5 Mbps cap plus audio, for disk estimates

export const reviewOf = (p: string) => p.replace(/\.mp4$/, '') + '-review.mp4';

async function exists(p: string): Promise<boolean> {
  return head(p).then(() => true, () => false);
}
async function upload(p: string, file: string): Promise<void> {
  await put(p, await fs.readFile(file), { access: 'private', contentType: 'video/mp4', addRandomSuffix: false, allowOverwrite: true, multipart: true, abortSignal: AbortSignal.timeout(300_000) });
}

/** The light copy of one episode part (video only; the soundtrack comes from the master at the join). `input` is a
 *  local file (right after the part renders) or a link (older parts). */
export async function makePartReview(input: string, partPath: string): Promise<void> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'unedit-rv-'));
  try {
    await ffmpeg([...WEB, '-i', input, '-map', '0:v:0', '-an', ...VIDEO, '-movflags', '+faststart', 'r.mp4'], d, 300_000);
    await upload(reviewOf(partPath), path.join(d, 'r.mp4'));
  } finally { await fs.rm(d, { recursive: true, force: true }).catch(() => {}); }
}
/** A part re-rendered without its copy must not keep the old one (the join would show the old part). */
export async function dropPartReview(partPath: string): Promise<void> {
  await del(reviewOf(partPath)).catch(() => {});
}

async function clipReview(clipPath: string): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'unedit-rvc-'));
  try {
    await ffmpeg([...WEB, '-i', await presigned(clipPath, 60), '-map', '0:v:0', '-map', '0:a:0?', ...VIDEO, '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', 'r.mp4'], d, 300_000);
    const out = reviewOf(clipPath);
    await upload(out, path.join(d, 'r.mp4'));
    return out;
  } finally { await fs.rm(d, { recursive: true, force: true }).catch(() => {}); }
}

/** Join the part copies with the master's soundtrack. Normal MP4 with the index up front (seeks well everywhere);
 *  an episode too long for the scratch disk is streamed up as fragmented MP4 instead. */
async function joinEpisode(episodePath: string, partPaths: string[], secs: number): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'unedit-rvj-'));
  const out = reviewOf(episodePath);
  try {
    const urls = await Promise.all(partPaths.map((p) => presigned(reviewOf(p), 60)));
    await fs.writeFile(path.join(d, 'parts.txt'), urls.map((u) => `file '${u.split("'").join("'\\''")}'`).join('\n'));
    const master = await presigned(episodePath, 60);
    const needMB = Math.ceil((secs * MBPS) / 8) + 60;
    const free = await tmpFreeMB();
    const join = [...WEB, '-f', 'concat', '-safe', '0', '-i', 'parts.txt', ...WEB, '-i', master, '-map', '0:v', '-map', '1:a', '-c', 'copy', '-shortest'];
    // About 20 min of episode fits; past that the card keeps playing the master, and the reason is logged.
    if (free != null && free < needMB) throw new Error(`not enough scratch disk for the review copy (${free} MB free, ${needMB} MB needed)`);
    await ffmpeg([...join, '-movflags', '+faststart', 'r.mp4'], d, 600_000);
    await upload(out, path.join(d, 'r.mp4'));
    return out;
  } finally { await fs.rm(d, { recursive: true, force: true }).catch(() => {}); }
}

type Rv = { path: string; of: string };
type VlogRow = { id: string; stage: string; episode_path: string | null; episode_plan: { secs?: number; review?: Rv } | null };
type ClipRow = { id: string; n: number; status: string; blob_path: string | null; features: { review?: Rv } | null };

const clipNeeds = (c: ClipRow) => Boolean(c.blob_path && ['ready', 'approved'].includes(c.status) && c.features?.review?.of !== c.blob_path);
const episodeNeeds = (v: VlogRow) => Boolean(v.episode_path && v.episode_plan?.review?.of !== v.episode_path);

/** Recordings on the review desk (or just posted) whose card still plays a heavy master. */
export async function reviewDue(limit = 2): Promise<string[]> {
  const { data } = await dbx().from('unedit_vlogs').select('id, stage, episode_path, episode_plan').in('stage', ['review', 'publishing']).limit(40);
  const out: string[] = [];
  for (const v of (data ?? []) as VlogRow[]) {
    if (out.length >= limit) break;
    if (episodeNeeds(v)) { out.push(v.id); continue; }
    const { data: cl } = await dbx().from('unedit_clips').select('id, n, status, blob_path, features').eq('vlog_id', v.id);
    if (((cl ?? []) as ClipRow[]).some(clipNeeds)) out.push(v.id);
  }
  return out;
}

/** Make whatever review copies a recording is missing, until `deadline`; the next tick picks up the rest. A lock
 *  blob keeps two workers off the same recording (a stale one, from a worker that died, is ignored after 14 min). */
export async function ensureReview(id: string, deadline: number): Promise<string> {
  const lock = `studio/vlogs/${id}/review.lock`;
  const held = await head(lock).catch(() => null);
  if (held && Date.now() - new Date(held.uploadedAt).getTime() < 14 * 60_000) return 'review copies: another worker has it';
  await put(lock, String(Date.now()), { access: 'private', contentType: 'text/plain', addRandomSuffix: false, allowOverwrite: true });
  const done: string[] = [];
  try {
    const { data: v } = await dbx().from('unedit_vlogs').select('id, stage, episode_path, episode_plan').eq('id', id).single();
    const vlog = v as VlogRow | null;
    if (!vlog) return 'review copies: no such recording';
    // Clips first: short, and what the reviewer opens most.
    const { data: cl } = await dbx().from('unedit_clips').select('id, n, status, blob_path, features').eq('vlog_id', id).order('n');
    for (const c of ((cl ?? []) as ClipRow[]).filter(clipNeeds)) {
      if (Date.now() > deadline - 90_000) return `review copies: ${done.join(', ') || 'none'} so far; more next time`;
      const of = c.blob_path!;
      const p = await clipReview(of).catch((e) => { console.error(`[unedit] ${id} clip ${c.n} review copy: ${e instanceof Error ? e.message : e}`); return null; });
      if (!p) continue;
      // Only if the clip wasn't redone meanwhile; features are re-read so nothing else in them is lost.
      const { data: now } = await dbx().from('unedit_clips').select('blob_path, features').eq('id', c.id).single();
      if (now?.blob_path === of) await dbx().from('unedit_clips').update({ features: { ...((now.features as object) ?? {}), review: { path: p, of } } }).eq('id', c.id);
      done.push(`clip ${c.n}`);
    }
    if (episodeNeeds(vlog)) {
      const of = vlog.episode_path!;
      const { data: parts } = await dbx().from('unedit_episode_parts').select('k, status, blob_path').eq('vlog_id', id).order('k');
      const ps = (parts ?? []) as { k: number; status: string; blob_path: string | null }[];
      if (!ps.length || ps.some((p) => p.status !== 'done' || !p.blob_path)) return `review copies: ${done.join(', ') || 'none'}; the episode's parts aren't all there`;
      for (const p of ps) {
        if (await exists(reviewOf(p.blob_path!))) continue;
        if (Date.now() > deadline - 120_000) return `review copies: ${done.join(', ') || 'none'} so far; more next time`;
        await makePartReview(await presigned(p.blob_path!, 60), p.blob_path!);
      }
      if (Date.now() > deadline - 120_000) return `review copies: parts ready; joining next time`;
      const out = await joinEpisode(of, ps.map((p) => p.blob_path!), Number(vlog.episode_plan?.secs ?? 0) || 600);
      const { data: now } = await dbx().from('unedit_vlogs').select('episode_path, episode_plan').eq('id', id).single();
      if (now?.episode_path === of) await dbx().from('unedit_vlogs').update({ episode_plan: { ...((now.episode_plan as object) ?? {}), review: { path: out, of } } }).eq('id', id);
      done.push('episode');
    }
    return `review copies: ${done.join(', ') || 'nothing needed'}`;
  } finally { await del(lock).catch(() => {}); }
}

/** Start the review worker for a recording (the same public-domain rule as lib/unedit.ts kick). */
export async function kickReview(origin: string, id: string): Promise<void> {
  if (!process.env.CRON_SECRET) return;
  const base = process.env.VERCEL_ENV === 'production' ? siteOrigin() : origin;
  const r = await fetch(`${base}/api/studio/unedit/${id}/review`, { method: 'POST', redirect: 'manual', headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, signal: AbortSignal.timeout(20_000) })
    .catch((e) => { console.error(`[unedit] ${id} review kick failed: ${e instanceof Error ? e.message : e}`); return null; });
  if (r && !r.ok) console.error(`[unedit] ${id} review kick answered ${r.status} from ${base}`);
}
