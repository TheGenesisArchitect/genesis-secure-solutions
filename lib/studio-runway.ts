// StudioNext generation on Runway, server only. One path for every kind of Runway work on the production board:
//   line reads  → the shot's lines in each character's voice (ElevenLabs v4 preset with direction tags, or the
//                 character's designed voice through Seed Audio), one read per line per click
//   keyframes   → Gen-4 Image stills with the cast's identity references tagged (@marcus, @tasha, @julian)
//   takes       → Seedance 2.5 (hero) or Gen-4.5 (production), animated from the chosen keyframe or the identity
//                 references, guided by the chosen line reads so performance and mouths follow the read
//   voice design and the score → Runway's voice designer and Seed Audio
// Every job is reserved in the database first (studio_reserve_runway: the monthly cap, the admin threshold, one
// lock), then started; the Studio cron (and the board while open) polls Runway, copies results into private Blob
// storage (Runway's links expire) and records Runway's final credit cost as an expense.
import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';
import { get, put } from '@vercel/blob';
import { adminDb } from '@/lib/supabase/admin';
import { businessToday } from '@/lib/billing';
import { CREDIT_CENTS, runwayActTwo, runwayUpload, runwayRoutedImage, runwayRoutedVideo, runwayConfigured, runwayCustomSpeech, runwayImage, runwaySeedance, runwaySound, runwaySpeech, runwayTask, runwayVideo, runwayVoicePreview, runwayOrganization, type RunwayDoneTask } from '@/lib/runway';
import { billedSeconds, defaultDirection, engineFor, PRICE } from '@/lib/studio-board';

type Db = ReturnType<typeof adminDb>;
const now = () => new Date().toISOString();
export const SHEET: Record<string, string> = { MARCUS01: 'marcus', TASHA01: 'tasha', JULIAN01: 'julian' };
const TAG = (code: string) => SHEET[code] ?? code.replace(/\d+$/, '').toLowerCase();
const LOOK = 'Photoreal cinematic still from a premium workplace dramedy series, 35mm film look, soft natural light with warm practicals, charcoal office surfaces with restrained orange and amber accents, shallow depth of field. No text, no captions, no logos, no watermarks, no on-screen interface.';

// ---------- Inputs (Runway can't reach private storage or localhost, so inputs go as data URIs, up to 5 MB) ----------
const MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', wav: 'audio/wav', mp3: 'audio/mpeg', mp4: 'video/mp4' };
// Identity images are read for every keyframe; keep them in memory for a few minutes instead of re-downloading.
const uriCache = new Map<string, { at: number; uri: string }>();
export async function blobDataUri(p: string): Promise<string | null> {
  const hit = uriCache.get(p);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.uri;
  const uri = await readDataUri(p);
  if (uri && /^studio\/(casting|refs)\//.test(p)) uriCache.set(p, { at: Date.now(), uri });
  return uri;
}
async function readDataUri(p: string): Promise<string | null> {
  const res = await get(p, { access: 'private', useCache: false, abortSignal: AbortSignal.timeout(30_000) });
  if (!res || res.statusCode !== 200 || !res.stream) return null;
  const buf = Buffer.from(await new Response(res.stream).arrayBuffer());
  if (buf.length > 5 * 1024 * 1024) return null;
  return `data:${MIME[p.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream'};base64,${buf.toString('base64')}`;
}
/** The official cast sheet crop for a V2 character (public/studio/cast), read from disk or the site itself. */
export async function castSheetBytes(code: string, origin?: string): Promise<Buffer | null> {
  const file = SHEET[code];
  if (!file) return null;
  try { return await fs.readFile(path.join(process.cwd(), 'public', 'studio', 'cast', `${file}.jpg`)); } catch {}
  if (!origin) return null;
  const r = await fetch(`${origin}/studio/cast/${file}.jpg`, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
  return r?.ok ? Buffer.from(await r.arrayBuffer()) : null;
}

/** Is a character's identity locked (an approved front portrait or casting sheet)? A quick check, no download. */
export async function identityLocked(db: Db, characterId: string): Promise<boolean> {
  const { count } = await db.from('studio_refs').select('id', { count: 'exact', head: true }).eq('character_id', characterId).in('slot', ['FACE_FRONT', 'CASTING']).eq('approved', true).not('blob_path', 'is', null);
  return (count ?? 0) > 0;
}
// Runway's result links stay valid for a while; within that window the next step gets the link, not a re-upload.
const fresh = (at: string | null | undefined) => Boolean(at && Date.now() - new Date(at).getTime() < 12 * 3600_000);

/** A character's identity reference for the engines: the approved front portrait, else the approved casting sheet. */
export async function identityRef(db: Db, characterId: string): Promise<{ id: string; slot: string; uri: string } | null> {
  for (const slot of ['FACE_FRONT', 'CASTING']) {
    const { data } = await db.from('studio_refs').select('id, blob_path').eq('character_id', characterId).eq('slot', slot).eq('approved', true).maybeSingle();
    if (data?.blob_path) { const uri = await blobDataUri(data.blob_path); if (uri) return { id: data.id, slot, uri }; }
  }
  return null;
}

import { parseRead, type Line } from '@/lib/studio-read';
// ---------- Routers: one Runway Model Router per job, named in Studio settings ----------
export type Routers = { hero: string; production: string; draft: string; keyframe: string; image_fast: string };
export const DEFAULT_ROUTERS: Routers = { hero: 'genovus-video-hero', production: 'genovus-video-production', draft: 'genovus-video-draft', keyframe: 'genovus-image-keyframe', image_fast: 'genovus-image-fast' };
export async function getRouters(db: Db): Promise<Routers> {
  const { data } = await db.from('studio_budget').select('routers').eq('id', true).maybeSingle();
  return { ...DEFAULT_ROUTERS, ...((data?.routers as Partial<Routers>) ?? {}) };
}
export type Pass = 'draft' | 'final';

export { parseRead, type Line };
const plain = (t: string) => t.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();

type Shot = { id: string; n: number; episode_id: string; description: string; tool: string; tier: string | null; timing: string | null; log: Record<string, string> | null; cast_codes: string[] | null; studio_episodes: { code: string; title: string } };
async function loadShot(db: Db, id: string): Promise<Shot> {
  const { data, error } = await db.from('studio_shots').select('id, n, episode_id, description, tool, tier, timing, log, cast_codes, studio_episodes!inner(code, title)').eq('id', id).single();
  if (error || !data) throw new Error('Shot not found.');
  return data as unknown as Shot;
}
async function activeCast(db: Db) {
  const { data } = await db.from('studio_characters').select('id, code, name, voice, profile').eq('status', 'active').order('sort');
  return (data ?? []) as { id: string; code: string; name: string; voice: Record<string, string> | null; profile: Record<string, string> | null }[];
}
const directionOf = (s: Shot) => ({
  acting: s.log?.acting ?? defaultDirection(s.studio_episodes.code, s.n)?.acting ?? '',
  read: s.log?.read ?? defaultDirection(s.studio_episodes.code, s.n)?.read ?? '',
  camera: s.log?.camera ?? '',
});

// ---------- Estimates (cents), from Runway's published rates; Runway's final cost replaces them on completion ----------
export const ESTIMATE = {
  line: PRICE.lineRead,
  keyframe: PRICE.keyframe,
  design: 10,
  score: 20,
  take: (tool: string, tier: string | null, timing: string | null) => { const e = engineFor(tool, tier); const d = takeSeconds(tool, tier, timing); return e ? d * e.perSec : 0; },
};
/** Seconds a take is generated for: the shot's length inside each engine's range (Seedance 4–15 s, Gen-4.5 2–10 s). */
export function takeSeconds(_tool: string, tier: string | null, timing: string | null) {
  return billedSeconds(tier, timing);
}

export type Started = { ok: true; ids: string[]; note: string } | { ok: false; error: string };
type Reserve = (p: { kind: string; shot: string | null; character: string | null; text: string; model: string; cents: number; params?: Record<string, unknown>; refs?: string[] }) => Promise<string>;

async function markFailed(db: Db, table: string, id: string, msg: string) {
  await db.from(table).update({ status: 'failed', error: msg.slice(0, 300), cost_cents: 0, ...(table === 'studio_voice_clips' ? {} : { updated_at: now() }) }).eq('id', id);
}

/** Read every line of a shot once, each in its speaker's Runway voice. */
export async function startLines(reserve: Reserve, shotId: string): Promise<Started> {
  const db = adminDb();
  const s = await loadShot(db, shotId);
  const cast = await activeCast(db);
  const lines = parseRead(directionOf(s).read, cast);
  if (!lines.length) return { ok: false, error: 'This shot has no spoken lines. Write the line read with the speaker’s name, like “TASHA: [warm] Got questions?”.' };
  // Only lines whose wording or voice changed (or that were never read) get a new read.
  const { data: existing } = await db.from('studio_voice_clips').select('slot, text, voice_name, status').eq('shot_id', s.id).eq('kind', 'line').in('status', ['ready', 'queued', 'running']);
  const ids: string[] = [];
  let read = 0;
  for (const l of lines) {
    const c = cast.find((x) => x.code === l.code)!;
    const custom = c.voice?.runway_engine === 'custom' && c.voice?.runway_design;
    const preset = c.voice?.runway_preset || c.voice?.runway_voice || 'Kiana';
    const voiceName = custom ? `design:${c.voice!.runway_design}` : preset;
    if ((existing ?? []).some((x) => x.slot === l.slot && x.text === l.text && x.voice_name === voiceName)) continue;
    read++;
    const id = await reserve({ kind: 'line', shot: s.id, character: c.id, text: l.text, model: custom ? 'seed_audio' : 'eleven_v4', cents: ESTIMATE.line, params: { slot: l.slot, voice: custom ? `design:${c.voice!.runway_design}` : preset, style: directionOf(s).acting } });
    try {
      let task: { id: string };
      if (custom) {
        const { data: clip } = await db.from('studio_voice_clips').select('blob_path').eq('id', c.voice!.runway_design).single();
        const ref = clip?.blob_path ? await blobDataUri(clip.blob_path) : null;
        if (!ref) throw new Error(`${c.name}’s designed voice clip is missing.`);
        task = await runwayCustomSpeech({ text: plain(l.text), voiceClip: ref });
      } else {
        task = await runwaySpeech({ text: l.text, voice: { type: 'runway-preset', presetId: preset } });
      }
      await db.from('studio_voice_clips').update({ status: 'running', task_id: task.id }).eq('id', id);
      ids.push(id);
    } catch (e) { await markFailed(db, 'studio_voice_clips', id, e instanceof Error ? e.message : 'Runway refused it.'); return { ok: false, error: e instanceof Error ? e.message : 'Runway refused it.' }; }
  }
  if (!read) return { ok: true, ids, note: 'Every line already has a current read.' };
  return { ok: true, ids, note: `Reading ${read} line${read === 1 ? '' : 's'}… about 10–30 seconds.` };
}

/** Two keyframe candidates for a shot, with the cast's identity references tagged in. */
export async function startKeyframes(reserve: Reserve, shotId: string, count = 2, opts: { pass?: Pass } = {}): Promise<Started> {
  const pass = opts.pass ?? 'final';
  const db = adminDb();
  const s = await loadShot(db, shotId);
  const cast = await activeCast(db);
  const inShot = cast.filter((c) => (s.cast_codes ?? []).includes(c.code));
  const refs: { id: string; uri: string; tag: string; name: string }[] = [];
  for (const c of inShot) {
    const r = await identityRef(db, c.id);
    if (!r) return { ok: false, error: `Lock ${c.name}’s identity first: approve the casting sheet on the board’s cast panel.` };
    refs.push({ id: r.id, uri: r.uri, tag: TAG(c.code), name: c.name });
  }
  const d = directionOf(s);
  const who = refs.map((r) => `@${r.tag} is ${r.name}`).join('; ');
  const prompt = `${who ? who + '. ' : ''}${s.description.replace(/\b(Marcus|Tasha|Julian)\b/g, (n) => `@${n.toLowerCase()}`)}${d.acting ? ` Performance: ${d.acting}.` : ''}${d.camera ? ` Camera: ${d.camera}.` : ''} ${LOOK} Keep every person exactly as in their reference: face, skin tone, hair, beard, glasses, build and accessories.`;
  // Routed image requests don't take @tags, so the routed prompt names each reference image in order.
  const routedPrompt = `${refs.map((r, i) => `Reference image ${i + 1} is ${r.name}`).join('; ')}${refs.length ? '. ' : ''}${s.description}${d.acting ? ` Performance: ${d.acting}.` : ''}${d.camera ? ` Camera: ${d.camera}.` : ''} ${LOOK} Keep every person exactly as in their reference image: face, skin tone, hair, beard, glasses, build and accessories.`;
  const router = (await getRouters(db))[pass === 'draft' ? 'image_fast' : 'keyframe'];
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    // Quote the exact request with Runway's free dry run; reserve that. No eligible model → the direct engine.
    const routed = { router, prompt: routedPrompt, refs: refs.map((x) => x.uri), resolution: (pass === 'draft' ? '1k' : '2k') as '1k' | '2k' };
    let estimate = pass === 'draft' ? PRICE.keyframeFast : ESTIMATE.keyframe;
    let useRouter = Boolean(router);
    if (router) { try { const q = await runwayRoutedImage({ ...routed, dryRun: true }); if (q.routing?.estimatedCost?.credits != null) estimate = Math.max(1, Math.round(q.routing.estimatedCost.credits * CREDIT_CENTS)); } catch (e) { useRouter = false; console.warn(`[studio-runway] dry run: ${router} has no eligible model for shot ${s.n}'s keyframe: ${e instanceof Error ? e.message : e}`); } }
    const id = await reserve({ kind: 'keyframe', shot: s.id, character: null, text: prompt, model: useRouter ? 'router' : 'gen4_image', cents: useRouter ? estimate : ESTIMATE.keyframe, refs: refs.map((r) => r.id) });
    await db.from('studio_art').update({ estimate_cents: useRouter ? estimate : ESTIMATE.keyframe }).eq('id', id);
    if (useRouter) {
      try {
        const r = await runwayRoutedImage(routed);
        await db.from('studio_art').update({ status: 'running', task_id: r.id, router, model: `runway:${r.routing?.model ?? 'router'}`, runway_status: 'PENDING', ...(r.routing?.estimatedCost?.credits != null ? { cost_cents: Math.round(r.routing.estimatedCost.credits * CREDIT_CENTS) } : {}), updated_at: now() }).eq('id', id);
        ids.push(id);
        continue;
      } catch (e) { console.warn(`[studio-runway] router ${router} refused keyframe for shot ${s.n}: ${e instanceof Error ? e.message : e}; using gen4_image`); }
    }
    try {
      const task = await runwayImage({ prompt, ratio: '1920:1080', refs: refs.map((r) => ({ uri: r.uri, tag: r.tag })), seed: Math.floor(Math.random() * 4_000_000_000) });
      await db.from('studio_art').update({ status: 'running', task_id: task.id, model: 'runway:gen4_image', runway_status: 'PENDING', updated_at: now() }).eq('id', id);
      ids.push(id);
    } catch (e) { await markFailed(db, 'studio_art', id, e instanceof Error ? e.message : 'Runway refused it.'); return { ok: false, error: e instanceof Error ? e.message : 'Runway refused it.' }; }
  }
  return { ok: true, ids, note: `Drawing ${count} keyframes… about 20–40 seconds.` };
}

/**
 * One take: the chosen keyframe (or the identity references) animated, guided by the chosen line reads. It goes
 * through the Studio's Runway Model Router, which picks the best eligible model (and skips one at capacity); if
 * routing itself is refused, the shot's own engine is called directly. A retry (attempt 2) leaves the audio out,
 * since an audio reference is the input models most often refuse.
 */
/** A take blocked by a model provider's own safety filter (e.g. Seedance on photoreal faces), not by Runway. */
export const MODERATED = /SAFETY\.THIRD_PARTY|provider's content moderation/i;
export async function startRunwayTake(reserve: Reserve, shotId: string, opts: { attempt?: number; pass?: Pass; moderated?: boolean; direct?: boolean } = {}): Promise<Started> {
  const attempt = opts.attempt ?? 1;
  const pass = opts.pass ?? 'final';
  // Once a provider's safety filter has blocked this shot's cast, render on Runway's own Gen-4.5 (first-party,
  // no third-party filter) from the keyframe; the line read is mixed in the edit instead of lip-synced.
  const firstParty = Boolean(opts.moderated);
  // A routed model that keeps returning bad output (INTERNAL.BAD_OUTPUT) is skipped: the shot goes straight to Gen-4.5.
  const skipRouter = firstParty || Boolean(opts.direct);
  const db = adminDb();
  const s = await loadShot(db, shotId);
  const eng = engineFor(s.tool, s.tier);
  if (!eng) return { ok: false, error: 'This shot isn’t made on Runway.' };
  const d = directionOf(s);
  const { data: frame } = await db.from('studio_art').select('id, blob_path, source_url, source_at').eq('shot_id', s.id).eq('kind', 'frame').eq('role', 'start').eq('chosen', true).eq('status', 'ready').maybeSingle();
  const frameUri = frame ? (fresh(frame.source_at) && frame.source_url ? frame.source_url : frame.blob_path ? await blobDataUri(frame.blob_path) : null) : null;
  const cast = await activeCast(db);
  const refs: { id: string; uri: string }[] = [];
  if (!frameUri && (firstParty || eng.model !== 'seedance2_5')) return { ok: false, error: 'Pick a keyframe first: Gen-4.5 animates from a starting frame.' };
  if (!firstParty) for (const c of cast.filter((x) => (s.cast_codes ?? []).includes(x.code))) {
    const r = await identityRef(db, c.id);
    if (!r) { if (!frameUri) return { ok: false, error: `Lock ${c.name}’s identity first, or pick a keyframe.` }; continue; }
    refs.push({ id: r.id, uri: r.uri });
  }
  // The chosen read for each line (or the newest ready one), in line order.
  const { data: clips } = await db.from('studio_voice_clips').select('id, slot, blob_path, approved, created_at, source_url, source_at').eq('shot_id', s.id).eq('kind', 'line').eq('status', 'ready').order('created_at', { ascending: false });
  const bySlot = new Map<string, { id: string; blob_path: string; approved: boolean; source_url?: string | null; source_at?: string | null }>();
  for (const c of (clips ?? []) as { id: string; slot: string; blob_path: string; approved: boolean; source_url?: string | null; source_at?: string | null }[]) { const cur = bySlot.get(c.slot); if (!cur || (c.approved && !cur.approved)) bySlot.set(c.slot, c); }
  const audio: string[] = [];
  if (eng.model === 'seedance2_5' && attempt < 2 && !skipRouter) for (const slot of [...bySlot.keys()].sort()) { const c = bySlot.get(slot)!; const u = fresh(c.source_at) && c.source_url ? c.source_url : await blobDataUri(c.blob_path); if (u) audio.push(u); }
  const seconds = firstParty ? Math.min(10, Math.max(2, takeSeconds(s.tool, s.tier, s.timing))) : takeSeconds(s.tool, s.tier, s.timing);
  // Seedance can't combine audio references with a positioned keyframe: with audio, every image (the keyframe and
  // the cast's identity references) goes in as an unpositioned reference. Without audio, the keyframe opens the shot.
  const images: { uri: string; role: 'first' | 'reference' }[] = audio.length
    ? [...(frameUri ? [{ uri: frameUri, role: 'reference' as const }] : []), ...refs.map((x) => ({ uri: x.uri, role: 'reference' as const }))]
    : frameUri ? [{ uri: frameUri, role: 'first' }] : refs.map((x) => ({ uri: x.uri, role: 'reference' as const }));
  const prompt = `${s.description}${d.acting ? ` Performance: ${d.acting}.` : ''}${d.camera ? ` Camera: ${d.camera}.` : ''}${audio.length ? ` The characters speak the attached dialogue on camera with natural, accurate lip movement and the delivery of the read.` : ''} ${LOOK} Keep every person exactly as in the references.`;
  const routers = await getRouters(db);
  const router = skipRouter ? '' : pass === 'draft' ? routers.draft : s.tier === 'hero' ? routers.hero : routers.production;
  // With routers in use, the direct fallback is Runway's own Gen-4.5 (the routers decide which outside models are
  // allowed; Seedance was removed from the hero router because its filter blocks our photoreal cast).
  const direct = skipRouter || router ? 'gen4.5' : eng.model;
  let routedReq = { router, prompt, images, audioRefs: audio, duration: seconds, audio: audio.length > 0, resolution: (pass === 'draft' ? '720p' : '1080p') as '720p' | '1080p' };
  let audioDropped = false;
  const directCents = seconds * (firstParty ? PRICE.gen45PerSec : direct === 'seedance2_5' ? PRICE.seedancePerSec : PRICE.gen45PerSec);
  let estimate = seconds * (pass === 'draft' ? PRICE.draftPerSec : eng.perSec);
  let routeError: string | null = null;
  if (router) {
    const quote = async (req: typeof routedReq) => { const q = await runwayRoutedVideo({ ...req, dryRun: true }); if (q.routing?.estimatedCost?.credits != null) estimate = Math.max(1, Math.round(q.routing.estimatedCost.credits * CREDIT_CENTS)); };
    try { await quote(routedReq); }
    catch (e) {
      routeError = e instanceof Error ? e.message : String(e);
      // No allowed model takes the line read as audio: ask again without it (the keyframe opens the shot). The
      // shot is then honestly "mixed in the edit", not audio-guided.
      if (audio.length) {
        const plainReq = { ...routedReq, audioRefs: [] as string[], audio: false, images: frameUri ? [{ uri: frameUri, role: 'first' as const }] : routedReq.images, prompt: routedReq.prompt.replace(/ The characters speak the attached dialogue[^.]*\./, '') };
        try { await quote(plainReq); routedReq = plainReq; audioDropped = true; routeError = null; console.warn(`[studio-runway] ${router}: no model takes the read as audio for shot ${s.n}; rendering without it (dialogue mixed in the edit)`); }
        catch (e2) { routeError = e2 instanceof Error ? e2.message : String(e2); }
      }
      if (routeError) console.warn(`[studio-runway] dry run: ${router} has no eligible model for shot ${s.n}: ${routeError}; using ${direct}`);
    }
  }
  const useRouter = Boolean(router) && !routeError;
  const id = await reserve({ kind: 'take', shot: s.id, character: null, text: prompt, model: useRouter ? 'router' : direct, cents: useRouter ? estimate : directCents, params: { first_party: firstParty || direct === 'gen4.5' && !router, audio_dropped: audioDropped, method: audio.length && !audioDropped ? 'references+audio' : frameUri ? 'keyframe' : 'references', seconds, attempt, pass, audio: audio.length > 0 && !audioDropped, lines: [...bySlot.values()].map((c) => c.id), frame: frame?.id ?? null }, refs: refs.map((r) => r.id) });
  await db.from('studio_takes').update({ estimate_cents: useRouter ? estimate : directCents }).eq('id', id);
  const seed = Math.floor(Math.random() * 4_000_000_000);
  if (useRouter) {
    try {
      const r = await runwayRoutedVideo({ ...routedReq, seed });
      const { data: cur } = await db.from('studio_takes').select('params').eq('id', id).single();
      await db.from('studio_takes').update({ status: 'running', operation: r.id, model: `runway:${r.routing?.model ?? 'router'}`, runway_status: 'PENDING',
        ...(r.routing?.estimatedCost?.credits != null ? { cost_cents: Math.round(r.routing.estimatedCost.credits * CREDIT_CENTS) } : {}),
        params: { ...((cur?.params as object) ?? {}), routing: { router, model: r.routing?.model ?? null, provider: r.routing?.provider ?? null, credits: r.routing?.estimatedCost?.credits ?? null, capacity_fallback: Boolean(r.routing?.capacityFallback) } }, updated_at: now() }).eq('id', id);
      return { ok: true, ids: [id], note: `Rendering a ${seconds}s ${pass === 'draft' ? 'draft' : 'take'} on ${r.routing?.model ?? 'the routed model'}…` };
    } catch (e) {
      routeError = e instanceof Error ? e.message : String(e);
      console.warn(`[studio-runway] router ${router} refused shot ${s.n}: ${routeError}; calling ${direct} directly`);
    }
  }
  try {
    const task = direct === 'seedance2_5'
      ? await runwaySeedance({ images: images.map((x) => (x.role === 'first' ? { uri: x.uri, position: 'first' as const } : { uri: x.uri })), prompt, ratio: '1920:1080', duration: seconds, audio: audio.length > 0, audioRefs: audio, seed })
      : await runwayVideo({ model: 'gen4.5', images: [{ uri: frameUri!, position: 'first' }], prompt, ratio: '1280:720', duration: Math.min(10, Math.max(2, seconds)), seed });
    await db.from('studio_takes').update({ status: 'running', operation: task.id, model: `runway:${direct}`, runway_status: 'PENDING', ...(routeError ? { error: `Router: ${routeError.slice(0, 200)} · used ${direct}` } : {}), updated_at: now() }).eq('id', id);
    return { ok: true, ids: [id], note: `Rendering a ${seconds}s take on ${direct === 'gen4.5' ? 'Gen-4.5' : eng.label}… usually 1–4 minutes.` };
  } catch (e) { console.warn(`[studio-runway] take start refused for shot ${s.n}: ${e instanceof Error ? e.message : e}`); await markFailed(db, 'studio_takes', id, e instanceof Error ? e.message : 'Runway refused it.'); return { ok: false, error: e instanceof Error ? e.message : 'Runway refused it.' }; }
}

/** Read a private file's bytes (for uploading a take or a phone recording to Runway). */
async function blobBytes(p: string): Promise<Buffer | null> {
  const res = await get(p, { access: 'private', useCache: false, abortSignal: AbortSignal.timeout(60_000) });
  if (!res || res.statusCode !== 200 || !res.stream) return null;
  return Buffer.from(await new Response(res.stream).arrayBuffer());
}

/**
 * Finish a scene's dialogue with Act-Two: the approved take is the character video, and a phone recording of
 * someone saying or mouthing the line in time with the read drives the character's face, so the lips match the
 * read. The result becomes the scene's take (marked lip-synced); the character's voice stays the line read.
 */
export async function startFinishDialogue(reserve: Reserve, shotId: string, recording: string, intensity = 3): Promise<Started> {
  const db = adminDb();
  const s = await loadShot(db, shotId);
  const { data: take } = await db.from('studio_takes').select('id, blob_path, params').eq('shot_id', s.id).eq('chosen', true).eq('status', 'ready').maybeSingle();
  if (!take?.blob_path) return { ok: false, error: 'This scene needs a picked take before its dialogue can be finished.' };
  const [takeBytes, recBytes] = await Promise.all([blobBytes(take.blob_path), blobBytes(recording)]);
  if (!takeBytes) return { ok: false, error: 'The take’s file is missing.' };
  if (!recBytes) return { ok: false, error: 'The recording didn’t arrive. Record it again.' };
  const secs = Number((take.params as { seconds?: number } | null)?.seconds ?? 8);
  const id = await reserve({ kind: 'take', shot: s.id, character: null, text: `Act-Two: finish the dialogue on ${s.description}`.slice(0, 900), model: 'act_two', cents: Math.max(1, Math.ceil(Math.min(30, Math.max(3, secs)) * PRICE.actTwoPerSec)), params: { method: 'act_two', lipsync: true, base_take: take.id, recording, seconds: secs } });
  try {
    const ext = recording.split('.').pop()?.toLowerCase() ?? 'mp4';
    const [character, reference] = await Promise.all([
      runwayUpload(takeBytes, `take-${take.id}.mp4`, 'video/mp4'),
      runwayUpload(recBytes, `performance.${ext}`, ext === 'webm' ? 'video/webm' : ext === 'mov' ? 'video/quicktime' : 'video/mp4'),
    ]);
    const task = await runwayActTwo({ character, reference, expressionIntensity: Math.min(5, Math.max(1, Math.round(intensity))) });
    await db.from('studio_takes').update({ status: 'running', operation: task.id, model: 'runway:act_two', runway_status: 'PENDING', updated_at: now() }).eq('id', id);
    await db.rpc('studio_shot_produce_patch', { p_shot: s.id, p_patch: { stage: 'syncing', force: true, note: 'Finishing the dialogue with Act-Two…', last_error: null } });
    return { ok: true, ids: [id], note: 'Finishing the dialogue: Act-Two is matching the lips to the read (about a minute or two).' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Runway refused it.';
    await markFailed(db, 'studio_takes', id, msg);
    return { ok: false, error: msg };
  }
}

/** A designed voice for a character, from the bible's voice description. Runway returns the sample immediately. */
export async function designVoice(reserve: Reserve, characterId: string): Promise<Started> {
  const db = adminDb();
  const c = (await activeCast(db)).find((x) => x.id === characterId);
  if (!c) return { ok: false, error: 'Pick an active cast member.' };
  const prompt = `${c.name}, ${c.profile?.age ? c.profile.age + ', ' : ''}an American agency professional in a workplace dramedy. ${c.voice?.direction ?? ''} ${c.voice?.timing ?? ''} Natural, conversational studio recording, no music.`.replace(/\s+/g, ' ').trim();
  const id = await reserve({ kind: 'design', shot: null, character: c.id, text: prompt, model: 'eleven_ttv_v3', cents: ESTIMATE.design, params: { slot: 'VOICE_DESIGN', voice: 'designed' } });
  try {
    const before = await runwayOrganization().then((o) => o.creditBalance).catch(() => null);
    const p = await runwayVoicePreview(prompt);
    const audio = await fetch(p.url, { signal: AbortSignal.timeout(30_000) });
    if (!audio.ok) throw new Error(`Could not fetch the sample (${audio.status}).`);
    const file = `studio/voice/design-${id}.mp3`;
    await put(file, Buffer.from(await audio.arrayBuffer()), { access: 'private', contentType: 'audio/mpeg', addRandomSuffix: false, allowOverwrite: true, abortSignal: AbortSignal.timeout(60_000) });
    const after = await runwayOrganization().then((o) => o.creditBalance).catch(() => null);
    const cents = before != null && after != null ? Math.max(0, before - after) * CREDIT_CENTS : ESTIMATE.design;
    await db.from('studio_voice_clips').update({ status: 'ready', blob_path: file, cost_cents: cents }).eq('id', id);
    await expense(cents, `Studio: ${c.name} voice design (Runway)`, null);
    return { ok: true, ids: [id], note: `${c.name}’s voice sample is ready. Listen, then use it or design another.` };
  } catch (e) { await markFailed(db, 'studio_voice_clips', id, e instanceof Error ? e.message : 'Runway refused it.'); return { ok: false, error: e instanceof Error ? e.message : 'Runway refused it.' }; }
}

/** An original score cue for an episode, composed by Seed Audio from the episode's cue sheet. */
export async function startScore(reserve: Reserve, episodeId: string, cue: string): Promise<Started> {
  const db = adminDb();
  const { data: first } = await db.from('studio_shots').select('id').eq('episode_id', episodeId).order('n').limit(1).maybeSingle();
  const prompt = `Original instrumental trailer score, no vocals, no lyrics. ${cue}`.trim();
  const id = await reserve({ kind: 'score', shot: first?.id ?? null, character: null, text: prompt, model: 'seed_audio', cents: ESTIMATE.score, params: { slot: 'SCORE', voice: 'score' } });
  try {
    const task = await runwaySound({ prompt });
    await db.from('studio_voice_clips').update({ status: 'running', task_id: task.id }).eq('id', id);
    return { ok: true, ids: [id], note: 'Composing the score cue… about a minute.' };
  } catch (e) { await markFailed(db, 'studio_voice_clips', id, e instanceof Error ? e.message : 'Runway refused it.'); return { ok: false, error: e instanceof Error ? e.message : 'Runway refused it.' }; }
}

async function expense(cents: number, note: string, by: string | null, sourceRef?: string) {
  if (cents <= 0) return;
  const { error } = await adminDb().from('expenses').insert({ spent_on: businessToday(), category: 'ai', vendor: 'Runway', amount_cents: cents, note: note.slice(0, 300), created_by: by, ...(sourceRef ? { source_ref: sourceRef } : {}) });
  // A duplicate source_ref means another poller already recorded this task's expense: that's the guard working.
  if (error && !/duplicate key|expenses_source_ref/i.test(error.message)) console.error(`[studio-runway] expense not recorded: ${error.message}`);
}

// ---------- Polling: finish every running Runway job ----------
const TABLES = [
  { table: 'studio_voice_clips', task: 'task_id', ext: (k: string) => (k === 'line' || k === 'score' ? 'mp3' : 'mp3'), dir: 'voice', label: 'line read' },
  { table: 'studio_art', task: 'task_id', ext: () => 'png', dir: 'frames', label: 'keyframe' },
  { table: 'studio_takes', task: 'operation', ext: () => 'mp4', dir: 'takes', label: 'take' },
] as const;
const TYPE: Record<string, string> = { mp3: 'audio/mpeg', png: 'image/png', mp4: 'video/mp4' };

/**
 * Check every running Runway job (optionally only one shot's) and complete the finished ones. Completion is claimed
 * first (a conditional update), so overlapping pollers (cron, board, a run's kick) never copy or expense the same
 * result twice; the expense itself is unique per Runway task. Downloads run three at a time.
 */
export async function pollRunwayJobs(shotId?: string): Promise<Record<string, number>> {
  if (!runwayConfigured()) return {};
  const db = adminDb();
  const out: Record<string, number> = {};
  const bump = (k: string) => { out[k] = (out[k] ?? 0) + 1; };
  const jobs: { T: (typeof TABLES)[number]; row: Record<string, string | number | null> }[] = [];
  for (const T of TABLES) {
    let q = db.from(T.table).select(`id, ${T.task}, cost_cents, created_at, created_by, ${T.table === 'studio_voice_clips' ? 'kind, shot_id' : T.table === 'studio_takes' ? 'shot_id, params' : 'shot_id'}`).eq('status', 'running').not(T.task, 'is', null).limit(25);
    if (T.table !== 'studio_voice_clips') q = q.like('model', 'runway:%');
    if (shotId) q = q.eq('shot_id', shotId);
    const { data } = await q;
    for (const row of (data ?? []) as unknown as Record<string, string | number | null>[]) jobs.push({ T, row });
  }
  const one = async ({ T, row }: (typeof jobs)[number]) => {
    const id = String(row.id);
    const isActTwo = T.table === 'studio_takes' && (row.params as unknown as { method?: string } | null)?.method === 'act_two';
    const stamp = T.table === 'studio_voice_clips' ? {} : { updated_at: now() };
    try {
      const t = (await runwayTask(String(row[T.task]))) as RunwayDoneTask;
      if (t.status === 'SUCCEEDED' && t.output?.[0]) {
        // Claim the completion: only one poller proceeds (a stale claim from a crashed poller expires in 5 minutes).
        const stale = new Date(Date.now() - 5 * 60_000).toISOString();
        const { data: claimed } = await db.from(T.table).update({ runway_status: 'COMPLETING', done_at: now() })
          .eq('id', id).eq('status', 'running').or(`runway_status.is.null,runway_status.neq.COMPLETING,done_at.lt.${stale}`).select('id');
        if (!claimed?.length) { bump('claimed_elsewhere'); return; }
        const file = await fetch(t.output[0], { signal: AbortSignal.timeout(60_000) });
        if (!file.ok) { await db.from(T.table).update({ runway_status: 'SUCCEEDED' }).eq('id', id); bump('download_wait'); return; }
        const ext = T.ext(String(row.kind ?? ''));
        const path = `studio/${T.dir}/${id}.${ext}`;
        await put(path, Buffer.from(await file.arrayBuffer()), { access: 'private', contentType: TYPE[ext], addRandomSuffix: false, allowOverwrite: true, abortSignal: AbortSignal.timeout(60_000) });
        const cents = t.cost?.credits != null ? Math.round(t.cost.credits * CREDIT_CENTS) : Number(row.cost_cents ?? 0);
        await db.from(T.table).update({ status: 'ready', blob_path: path, cost_cents: cents, runway_status: 'SUCCEEDED', runway_progress: 1, done_at: now(), refund_status: 'n/a', ...stamp, ...(T.table === 'studio_takes' ? {} : { source_url: t.output[0], source_at: now() }) }).eq('id', id);
        await expense(cents, `Studio: Runway ${T.label}`, (row.created_by as string) ?? null, `runway:${row[T.task]}`);
        if (isActTwo) {
          await db.rpc('studio_auto_choose_take', { p_id: id });
          await db.rpc('studio_shot_produce_patch', { p_shot: row.shot_id, p_patch: { stage: 'review', force: true, dialogue_open: false, note: 'Dialogue lip-synced with Act-Two.' } });
        }
        bump('ready');
      } else if (t.status === 'FAILED' || t.status === 'CANCELLED') {
        console.warn(`[studio-runway] ${T.label} ${id.slice(0, 8)} ${t.status}: ${t.failure ?? ''} ${t.failureCode ?? ''}`);
        if (isActTwo) await db.rpc('studio_shot_produce_patch', { p_shot: row.shot_id, p_patch: { stage: 'review', force: true, last_error: `Finish dialogue failed: ${t.failure ?? t.status}`.slice(0, 300) } });
        // Runway reports the final charge on terminal tasks; without it, the reservation keeps counting (unconfirmed).
        const billed = t.cost?.credits != null ? Math.round(t.cost.credits * CREDIT_CENTS) : null;
        await db.from(T.table).update({ status: 'failed', runway_status: t.status, done_at: now(), error: `${t.failure ?? t.status}${t.failureCode ? ` (${t.failureCode})` : ''}`.slice(0, 300), cost_cents: billed ?? Number(row.cost_cents ?? 0), refund_status: billed === 0 ? 'refunded' : billed == null ? 'unconfirmed' : 'n/a', ...stamp }).eq('id', id).eq('status', 'running');
        if (billed && billed > 0) await expense(billed, `Studio: Runway ${T.label} (failed, billed)`, (row.created_by as string) ?? null, `runway:${row[T.task]}`);
        bump('failed');
      } else if (Date.now() - new Date(String(row.created_at)).getTime() > 45 * 60_000) {
        await db.from(T.table).update({ status: 'failed', error: 'Timed out after 45 minutes.', refund_status: 'unconfirmed', done_at: now(), ...stamp }).eq('id', id).eq('status', 'running');
        bump('failed');
      } else {
        await db.from(T.table).update({ runway_status: t.status, runway_progress: typeof t.progress === 'number' ? t.progress : null }).eq('id', id).eq('status', 'running');
        bump('running');
      }
    } catch (e) {
      bump('errors');
      console.error(`[studio-runway] poll ${T.table}/${id}: ${e instanceof Error ? e.message : e}`);
    }
  };
  for (let i = 0; i < jobs.length; i += 3) await Promise.all(jobs.slice(i, i + 3).map(one));
  return out;
}
