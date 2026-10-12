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
import { CREDIT_CENTS, runwayConfigured, runwayCustomSpeech, runwayImage, runwaySeedance, runwaySound, runwaySpeech, runwayTask, runwayVideo, runwayVoicePreview, runwayOrganization, type RunwayDoneTask } from '@/lib/runway';
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
  const res = await get(p, { access: 'private', useCache: false });
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
  const ids: string[] = [];
  for (const l of lines) {
    const c = cast.find((x) => x.code === l.code)!;
    const custom = c.voice?.runway_engine === 'custom' && c.voice?.runway_design;
    const preset = c.voice?.runway_preset || c.voice?.runway_voice || 'Kiana';
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
  return { ok: true, ids, note: `Reading ${lines.length} line${lines.length === 1 ? '' : 's'}… about 10–30 seconds.` };
}

/** Two keyframe candidates for a shot, with the cast's identity references tagged in. */
export async function startKeyframes(reserve: Reserve, shotId: string, count = 2): Promise<Started> {
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
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = await reserve({ kind: 'keyframe', shot: s.id, character: null, text: prompt, model: 'gen4_image', cents: ESTIMATE.keyframe, refs: refs.map((r) => r.id) });
    try {
      const task = await runwayImage({ prompt, ratio: '1920:1080', refs: refs.map((r) => ({ uri: r.uri, tag: r.tag })), seed: Math.floor(Math.random() * 4_000_000_000) });
      await db.from('studio_art').update({ status: 'running', task_id: task.id, updated_at: now() }).eq('id', id);
      ids.push(id);
    } catch (e) { await markFailed(db, 'studio_art', id, e instanceof Error ? e.message : 'Runway refused it.'); return { ok: false, error: e instanceof Error ? e.message : 'Runway refused it.' }; }
  }
  return { ok: true, ids, note: `Drawing ${count} keyframes… about 20–40 seconds.` };
}

/** One take: the chosen keyframe (or the identity references) animated, guided by the chosen line reads. */
export async function startRunwayTake(reserve: Reserve, shotId: string): Promise<Started> {
  const db = adminDb();
  const s = await loadShot(db, shotId);
  const eng = engineFor(s.tool, s.tier);
  if (!eng) return { ok: false, error: 'This shot isn’t made on Runway.' };
  const d = directionOf(s);
  const { data: frame } = await db.from('studio_art').select('id, blob_path, source_url, source_at').eq('shot_id', s.id).eq('kind', 'frame').eq('role', 'start').eq('chosen', true).eq('status', 'ready').maybeSingle();
  const frameUri = frame ? (fresh(frame.source_at) && frame.source_url ? frame.source_url : frame.blob_path ? await blobDataUri(frame.blob_path) : null) : null;
  const cast = await activeCast(db);
  const refs: { id: string; uri: string }[] = [];
  if (!frameUri) {
    if (eng.model !== 'seedance2_5') return { ok: false, error: 'Pick a keyframe first: Gen-4.5 animates from a starting frame.' };
    for (const c of cast.filter((x) => (s.cast_codes ?? []).includes(x.code))) {
      const r = await identityRef(db, c.id);
      if (!r) return { ok: false, error: `Lock ${c.name}’s identity first, or pick a keyframe.` };
      refs.push({ id: r.id, uri: r.uri });
    }
  }
  // The chosen read for each line (or the newest ready one), in line order.
  const { data: clips } = await db.from('studio_voice_clips').select('id, slot, blob_path, approved, created_at, source_url, source_at').eq('shot_id', s.id).eq('kind', 'line').eq('status', 'ready').order('created_at', { ascending: false });
  const bySlot = new Map<string, { id: string; blob_path: string; approved: boolean; source_url?: string | null; source_at?: string | null }>();
  for (const c of (clips ?? []) as { id: string; slot: string; blob_path: string; approved: boolean; source_url?: string | null; source_at?: string | null }[]) { const cur = bySlot.get(c.slot); if (!cur || (c.approved && !cur.approved)) bySlot.set(c.slot, c); }
  const audio: string[] = [];
  if (eng.model === 'seedance2_5') for (const slot of [...bySlot.keys()].sort()) { const c = bySlot.get(slot)!; const u = fresh(c.source_at) && c.source_url ? c.source_url : await blobDataUri(c.blob_path); if (u) audio.push(u); }
  const seconds = takeSeconds(s.tool, s.tier, s.timing);
  const prompt = `${s.description}${d.acting ? ` Performance: ${d.acting}.` : ''}${d.camera ? ` Camera: ${d.camera}.` : ''}${audio.length ? ` The characters speak the attached dialogue on camera with natural, accurate lip movement and the delivery of the read.` : ''} ${LOOK} Keep every person exactly as in the references.`;
  const id = await reserve({ kind: 'take', shot: s.id, character: null, text: prompt, model: eng.model, cents: seconds * eng.perSec, params: { method: frameUri ? 'keyframe' : 'references', seconds, lines: [...bySlot.values()].map((c) => c.id), frame: frame?.id ?? null }, refs: refs.map((r) => r.id) });
  try {
    const seed = Math.floor(Math.random() * 4_000_000_000);
    const task = eng.model === 'seedance2_5'
      ? await runwaySeedance({ images: frameUri ? [{ uri: frameUri, position: 'first' }] : refs.map((r) => ({ uri: r.uri })), prompt, ratio: '1920:1080', duration: seconds, audio: audio.length > 0, audioRefs: audio, seed })
      : await runwayVideo({ model: 'gen4.5', images: [{ uri: frameUri!, position: 'first' }], prompt, ratio: '1280:720', duration: seconds, seed });
    await db.from('studio_takes').update({ status: 'running', operation: task.id, updated_at: now() }).eq('id', id);
    return { ok: true, ids: [id], note: `Rendering a ${seconds}s take on ${eng.label}… usually 1–4 minutes.` };
  } catch (e) { console.warn(`[studio-runway] take start refused for shot ${s.n}: ${e instanceof Error ? e.message : e}`); await markFailed(db, 'studio_takes', id, e instanceof Error ? e.message : 'Runway refused it.'); return { ok: false, error: e instanceof Error ? e.message : 'Runway refused it.' }; }
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
    await put(file, Buffer.from(await audio.arrayBuffer()), { access: 'private', contentType: 'audio/mpeg', addRandomSuffix: false, allowOverwrite: true });
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

async function expense(cents: number, note: string, by: string | null) {
  if (cents <= 0) return;
  const { error } = await adminDb().from('expenses').insert({ spent_on: businessToday(), category: 'ai', vendor: 'Runway', amount_cents: cents, note: note.slice(0, 300), created_by: by });
  if (error) console.error(`[studio-runway] expense not recorded: ${error.message}`);
}

// ---------- Polling: finish every running Runway job ----------
const TABLES = [
  { table: 'studio_voice_clips', task: 'task_id', ext: (k: string) => (k === 'line' || k === 'score' ? 'mp3' : 'mp3'), dir: 'voice', label: 'line read' },
  { table: 'studio_art', task: 'task_id', ext: () => 'png', dir: 'frames', label: 'keyframe' },
  { table: 'studio_takes', task: 'operation', ext: () => 'mp4', dir: 'takes', label: 'take' },
] as const;
const TYPE: Record<string, string> = { mp3: 'audio/mpeg', png: 'image/png', mp4: 'video/mp4' };

/** Check every running Runway job (optionally only one shot's); copy finished outputs into storage. */
export async function pollRunwayJobs(shotId?: string): Promise<Record<string, number>> {
  if (!runwayConfigured()) return {};
  const db = adminDb();
  const out: Record<string, number> = {};
  for (const T of TABLES) {
    let q = db.from(T.table).select(`id, ${T.task}, cost_cents, created_at, created_by, ${T.table === 'studio_voice_clips' ? 'kind' : 'shot_id'}`).eq('status', 'running').not(T.task, 'is', null).limit(25);
    if (T.table === 'studio_takes') q = q.like('model', 'runway:%');
    if (T.table === 'studio_art') q = q.like('model', 'runway:%');
    if (shotId) q = q.eq('shot_id', shotId);
    const { data } = await q;
    for (const row of (data ?? []) as unknown as Record<string, string | number | null>[]) {
      const id = String(row.id);
      try {
        const t = (await runwayTask(String(row[T.task]))) as RunwayDoneTask;
        if (t.status === 'SUCCEEDED' && t.output?.[0]) {
          const file = await fetch(t.output[0], { signal: AbortSignal.timeout(60_000) });
          if (!file.ok) { out.download_wait = (out.download_wait ?? 0) + 1; continue; }
          const ext = T.ext(String(row.kind ?? ''));
          const p = `studio/${T.dir}/${id}.${ext}`;
          await put(p, Buffer.from(await file.arrayBuffer()), { access: 'private', contentType: TYPE[ext], addRandomSuffix: false, allowOverwrite: true });
          const cents = t.cost?.credits != null ? Math.round(t.cost.credits * CREDIT_CENTS) : Number(row.cost_cents ?? 0);
          await db.from(T.table).update({ status: 'ready', blob_path: p, cost_cents: cents, ...(T.table === 'studio_takes' ? { updated_at: now() } : { source_url: t.output[0], source_at: now(), ...(T.table === 'studio_art' ? { updated_at: now() } : {}) }) }).eq('id', id);
          await expense(cents, `Studio: Runway ${T.label}`, (row.created_by as string) ?? null);
          out.ready = (out.ready ?? 0) + 1;
        } else if (t.status === 'FAILED' || t.status === 'CANCELLED') {
          console.warn(`[studio-runway] ${T.label} ${id.slice(0, 8)} ${t.status}: ${t.failure ?? ''} ${t.failureCode ?? ''}`);
          await db.from(T.table).update({ status: 'failed', error: (t.failure ?? t.status).slice(0, 300), cost_cents: t.cost?.credits != null ? Math.round(t.cost.credits * CREDIT_CENTS) : 0, ...(T.table === 'studio_voice_clips' ? {} : { updated_at: now() }) }).eq('id', id);
          out.failed = (out.failed ?? 0) + 1;
        } else if (Date.now() - new Date(String(row.created_at)).getTime() > 45 * 60_000) {
          await markFailed(db, T.table, id, 'Timed out after 45 minutes.');
          out.failed = (out.failed ?? 0) + 1;
        } else out.running = (out.running ?? 0) + 1;
      } catch (e) {
        out.errors = (out.errors ?? 0) + 1;
        console.error(`[studio-runway] poll ${T.table}/${id}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  return out;
}
