// Studio generation, server only. Character sheets come from Nano Banana Pro (one call, a few seconds); shot takes
// come from Veo 3.1 Fast (a long-running operation, polled until done). Results are copied straight into private
// Blob storage (Google deletes generated videos after two days) and their cost is recorded as an expense.
// Reservation, budget and permission checks happen first, in the database (studio_reserve).
import 'server-only';
import { get, put } from '@vercel/blob';
import { adminDb } from '@/lib/supabase/admin';
import { businessToday } from '@/lib/billing';

const BASE = () => (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
const KEY = () => (process.env.GEMINI_API_KEY || '').trim();
export const IMAGE_MODEL = () => (process.env.STUDIO_IMAGE_MODEL || 'gemini-3-pro-image').trim();
export const VIDEO_MODEL = () => (process.env.STUDIO_VIDEO_MODEL || 'veo-3.1-fast-generate-preview').trim();
// Published prices (Gemini API, 2026-10): Nano Banana Pro $0.134 per 1K/2K image; Veo 3.1 Fast $0.12/s at 1080p.
export const IMAGE_CENTS = 14;
export const VIDEO_SECONDS = 8;
export const VIDEO_CENTS = 12 * VIDEO_SECONDS;
export const generationConfigured = () => Boolean(KEY());

const now = () => new Date().toISOString();
const headers = () => ({ 'x-goog-api-key': KEY(), 'content-type': 'application/json' });

async function blobBase64(path: string): Promise<{ data: string; mimeType: string } | null> {
  const res = await get(path, { access: 'private', useCache: false });
  if (!res || res.statusCode !== 200 || !res.stream) return null;
  const buf = Buffer.from(await new Response(res.stream).arrayBuffer());
  return { data: buf.toString('base64'), mimeType: path.endsWith('.jpg') ? 'image/jpeg' : 'image/png' };
}

async function recordExpense(cents: number, note: string, by: string | null) {
  if (cents <= 0) return;
  const { error } = await adminDb().from('expenses').insert({ spent_on: businessToday(), category: 'ai', vendor: 'Google Gemini', amount_cents: cents, note: note.slice(0, 300), created_by: by });
  if (error) console.error(`[studio] expense not recorded: ${error.message}`);
}

const SHEET_STYLE = 'Photoreal character reference sheet for a short film, vertical 9:16. Show the same person in a front view, three-quarter view, profile and a full-body view, plus three small expression close-ups, on a neutral light-gray studio background with soft even light. Consistent face, hair, wardrobe and proportions in every view. No text, no logos, no watermarks. Original character, not resembling any real person or celebrity.';

/** Generate one character sheet (already reserved). Runs to completion: a few seconds. */
const SLOT_ASPECT = (slot: string) => (/^(BODY|LOOK_)/.test(slot) || slot === 'ENS_SCALE' ? '9:16' : /^ENS_/.test(slot) ? '4:3' : '3:4');

/**
 * Generate one reference image (already reserved). Identity slots follow the bible's production order: the front
 * portrait comes from the character's identity prompt alone; every other slot is derived from the approved front
 * portrait; ensemble slots get every active character's approved front. Legacy sheets keep the multi-view style.
 */
export async function generateRef(id: string): Promise<{ ok: boolean; error?: string }> {
  const db = adminDb();
  const { data: r } = await db.from('studio_refs').select('*').eq('id', id).single();
  if (!r) return { ok: false, error: 'not found' };
  await db.from('studio_refs').update({ status: 'running', updated_at: now() }).eq('id', id);
  try {
    const parts: Record<string, unknown>[] = [];
    let basis: string | null = null; // what this image is made from (casting sheet or front portrait)
    let aspect = '9:16';
    if (!r.slot) {
      parts.push({ text: `${SHEET_STYLE}

${r.prompt}` });
    } else {
      aspect = SLOT_ASPECT(r.slot);
      parts.push({ text: r.prompt });
      if (r.ref_set === 'ensemble') {
        const { data: fronts } = await db.from('studio_refs').select('character, blob_path, studio_characters!inner(code, status, sort)').eq('series_id', r.series_id).eq('slot', 'FACE_FRONT').eq('approved', true).eq('studio_characters.status', 'active');
        for (const fr of fronts ?? []) {
          const img = fr.blob_path ? await blobBase64(fr.blob_path) : null;
          const code = (fr.studio_characters as unknown as { code: string }).code;
          if (img) parts.push({ text: `Reference portrait for ${fr.character} (${code.replace(/\d+$/, '')}): this exact person.` }, { inlineData: img });
        }
      } else if (r.character_id) {
        // The approved casting sheet (uploaded by the team) anchors the face, the build and the wardrobe.
        const { data: casting } = await db.from('studio_refs').select('id, blob_path').eq('character_id', r.character_id).eq('slot', 'CASTING').eq('approved', true).maybeSingle();
        const cast = casting?.blob_path ? await blobBase64(casting.blob_path) : null;
        if (r.slot === 'FACE_FRONT') {
          basis = casting?.id ?? null;
          if (cast) parts.push({ text: `Casting reference sheet for ${r.character}: produce ONE clean single portrait of exactly this person (same face, skin tone, hair, build and jewelry). Ignore the caption text and the panel layout of the sheet.` }, { inlineData: cast });
        } else {
          const { data: front } = await db.from('studio_refs').select('id, blob_path').eq('character_id', r.character_id).eq('slot', 'FACE_FRONT').eq('approved', true).maybeSingle();
          basis = front?.id ?? null;
          const img = front?.blob_path ? await blobBase64(front.blob_path) : null;
          if (!img) throw new Error('The approved front portrait is missing.');
          parts.push({ text: `Reference portrait of ${r.character}: this exact person.` }, { inlineData: img });
          if (cast) parts.push({ text: `Casting reference sheet for ${r.character} (same person, for build and proportions; ignore its caption text).` }, { inlineData: cast });
        }
      }
    }
    const out = await nanoImage(r.model, parts, aspect);
    const ext = out.mimeType === 'image/jpeg' ? 'jpg' : 'png';
    const path = `studio/refs/${id}.${ext}`;
    await put(path, Buffer.from(out.data, 'base64'), { access: 'private', contentType: out.mimeType, addRandomSuffix: false, allowOverwrite: true });
    await db.from('studio_refs').update({ status: 'ready', blob_path: path, basis_id: basis, updated_at: now() }).eq('id', id);
    await recordExpense(r.cost_cents, `Studio: ${r.asset_code ?? `character sheet for ${r.character}`} (${r.model})`, r.created_by);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 300) : 'failed';
    await db.from('studio_refs').update({ status: 'failed', error: msg, cost_cents: 0, updated_at: now() }).eq('id', id);
    return { ok: false, error: msg };
  }
}

/** One image from Nano Banana Pro: a prompt plus reference images (inline), at 9:16 2K. */
async function nanoImage(model: string, parts: Record<string, unknown>[], aspectRatio = '9:16'): Promise<{ data: string; mimeType: string }> {
  const res = await fetch(`${BASE()}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', headers: headers(), signal: AbortSignal.timeout(110_000),
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio, imageSize: '2K' } } }),
  });
  const j = (await res.json().catch(() => ({}))) as { candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] }; finishReason?: string }[]; error?: { message?: string }; promptFeedback?: { blockReason?: string } };
  if (!res.ok) throw new Error(j.error?.message || `HTTP ${res.status}`);
  const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part?.inlineData?.data) throw new Error(j.promptFeedback?.blockReason ? `Blocked: ${j.promptFeedback.blockReason}` : `No image returned (${j.candidates?.[0]?.finishReason ?? 'unknown'})`);
  return { data: part.inlineData.data, mimeType: part.inlineData.mimeType ?? 'image/png' };
}

/** A shot is vertical 9:16 (social) unless its prompt says "Widescreen 16:9" (the home page and other widescreen
 * cuts). Takes carry the shot's prompt (after the cast line), so the frame shape travels with it. */
export const shotAspect = (prompt: string | null | undefined): '9:16' | '16:9' => (/\bwidescreen 16:9\b/i.test(prompt ?? '') ? '16:9' : '9:16');

const KEYFRAME_STYLE = (aspect: '9:16' | '16:9') => `The FIRST FRAME of a cinematic ${aspect === '16:9' ? 'widescreen 16:9' : 'vertical 9:16'} film shot, 35mm film look, photoreal, natural skin texture, warm practical light. Compose exactly the moment described. The people in it must be the characters from the reference sheets provided: identical faces, hair, skin tone, build and wardrobe. No text, logos or watermarks.`;

type VeoImage = { bytesBase64Encoded: string; mimeType: string } | { inlineData: { data: string; mimeType: string } };
const asBytes = (i: { data: string; mimeType: string }): VeoImage => ({ bytesBase64Encoded: i.data, mimeType: i.mimeType });
const asInline = (i: { data: string; mimeType: string }): VeoImage => ({ inlineData: i });

/**
 * Start a Veo take (already reserved). Continuity first: when the shot names cast members, their faces must come
 * from the reference sheets. Route 1 sends the sheets as Veo reference images; if Veo refuses them, route 2 paints
 * the shot's first frame with Nano Banana Pro from the sheets and has Veo animate that exact frame. If neither is
 * accepted the take fails at no cost instead of inventing different people.
 */
export async function startTake(id: string): Promise<{ ok: boolean; error?: string; waiting?: boolean }> {
  const db = adminDb();
  const { data: t } = await db.from('studio_takes').select('*').eq('id', id).single();
  if (!t) return { ok: false, error: 'not found' };
  const sheets: { character: string; img: { data: string; mimeType: string } }[] = [];
  if (t.ref_ids?.length) {
    const { data: rows } = await db.from('studio_refs').select('character, blob_path').in('id', t.ref_ids).eq('status', 'ready');
    for (const row of (rows ?? []).slice(0, 3)) {
      const img = row.blob_path ? await blobBase64(row.blob_path) : null;
      if (img) sheets.push({ character: row.character, img });
    }
  }
  const aspect = shotAspect(t.prompt);
  const params = { aspectRatio: aspect, durationSeconds: VIDEO_SECONDS, resolution: '1080p' };
  const veo = async (instance: Record<string, unknown>, personGeneration: string) => {
    const res = await fetch(`${BASE()}/models/${encodeURIComponent(t.model)}:predictLongRunning`, {
      method: 'POST', headers: headers(), signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({ instances: [{ prompt: t.prompt, ...instance }], parameters: { ...params, personGeneration } }),
    });
    const j = (await res.json().catch(() => ({}))) as { name?: string; error?: { message?: string } };
    return (res.ok && j.name ? { name: j.name } : { error: j.error?.message ?? `HTTP ${res.status}` }) as { name: string } | { error: string };
  };
  const tried: string[] = [];
  try {
    let started: { name: string } | null = null;
    let method = 'prompt';
    let extraCents = 0;
    if (!sheets.length) {
      const r = await veo({}, 'allow_all');
      if ('error' in r) throw new Error(r.error);
      started = r;
    } else {
      // Route 1: the sheets as reference images (both image encodings the API has documented). A quota refusal
      // stops here: the take waits for quota instead of painting a keyframe that Veo would refuse anyway.
      for (const enc of [asBytes, asInline]) {
        const r = await veo({ referenceImages: sheets.map((s) => ({ image: enc(s.img), referenceType: 'asset' })) }, 'allow_adult');
        if ('name' in r) { started = r; method = 'references'; break; }
        if (isQuota(r.error)) throw new Error(r.error);
        tried.push(`references: ${r.error}`);
      }
      // Route 2: a keyframe painted from the sheets, animated by Veo.
      if (!started) {
        const parts: Record<string, unknown>[] = [{ text: `${KEYFRAME_STYLE(aspect)}

The shot: ${t.prompt}` }];
        for (const s of sheets) parts.push({ text: `Reference sheet for ${s.character}: match this person exactly.` }, { inlineData: s.img });
        const frame = await nanoImage(IMAGE_MODEL(), parts, aspect);
        extraCents = IMAGE_CENTS;
        await put(`studio/frames/${id}.${frame.mimeType === 'image/jpeg' ? 'jpg' : 'png'}`, Buffer.from(frame.data, 'base64'), { access: 'private', contentType: frame.mimeType, addRandomSuffix: false, allowOverwrite: true });
        for (const enc of [asBytes, asInline]) {
          const r = await veo({ image: enc(frame) }, 'allow_adult');
          if ('name' in r) { started = r; method = 'keyframe'; break; }
          tried.push(`keyframe: ${r.error}`);
        }
      }
      if (!started) throw new Error(`Veo wouldn't take the cast's reference images, so nothing was generated (no charge). ${tried.join(' | ')}`.slice(0, 600));
    }
    await db.from('studio_takes').update({
      status: 'running', operation: started.name, error: null, cost_cents: t.cost_cents + extraCents,
      params: { ...(t.params ?? {}), method, cast: sheets.map((s) => s.character), tried: tried.length ? tried : undefined }, updated_at: now(),
    }).eq('id', id);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 600) : 'failed';
    // Out of Gemini quota: the take keeps its reservation and waits; the Studio cron starts it again with backoff.
    const p = (t.params ?? {}) as { waiting_since?: string; attempts?: number };
    const since = p.waiting_since ?? now();
    if (isQuota(msg) && Date.now() - new Date(since).getTime() < QUOTA_GIVE_UP_MS) {
      const attempts = (p.attempts ?? 0) + 1;
      const nextAt = new Date(Date.now() + Math.min(30, 2 ** (attempts - 1)) * 60_000).toISOString();
      await db.from('studio_takes').update({ status: 'queued', error: 'Waiting for Gemini quota: starts on its own.', params: { ...p, tried, waiting_since: since, attempts, next_at: nextAt }, updated_at: now() }).eq('id', id);
      return { ok: true, waiting: true };
    }
    await db.from('studio_takes').update({ status: 'failed', error: isQuota(msg) ? 'Gemini quota stayed exhausted for 36 hours. Check the plan’s limits, then generate again.' : msg, cost_cents: 0, params: { ...(t.params ?? {}), tried }, updated_at: now() }).eq('id', id);
    return { ok: false, error: msg };
  }
}

/** Google's "out of quota" refusals (per-minute and per-day limits): worth waiting for, not a failed take. */
const isQuota = (msg: string) => /exceeded your current quota|resource[_ ]exhausted|rate limit|too many requests|\b429\b/i.test(msg);
const QUOTA_GIVE_UP_MS = 36 * 3_600_000;

/** Start the oldest take that is waiting for quota and due for a retry (the Studio cron calls this every minute). */
export async function retryWaitingTake(): Promise<{ id: string; status: string } | null> {
  const db = adminDb();
  const { data } = await db.from('studio_takes').select('id, params').eq('status', 'queued').not('params->>waiting_since', 'is', null).order('created_at').limit(50);
  const due = (data ?? []).find((t) => !(t.params as { next_at?: string })?.next_at || new Date((t.params as { next_at: string }).next_at).getTime() <= Date.now());
  if (!due) return null;
  const r = await startTake(due.id);
  return { id: due.id, status: r.ok ? ('waiting' in r && r.waiting ? 'waiting' : 'running') : 'failed' };
}

type Operation = {
  done?: boolean;
  error?: { message?: string };
  response?: { generateVideoResponse?: { generatedSamples?: { video?: { uri?: string } }[]; raiMediaFilteredReasons?: string[]; raiMediaFilteredCount?: number } };
};

/** Check a running take; when Google is done, copy the video into private storage. */
export async function pollTake(id: string): Promise<{ status: string; error?: string }> {
  const db = adminDb();
  const { data: t } = await db.from('studio_takes').select('*').eq('id', id).single();
  if (!t) return { status: 'missing' };
  if (t.status !== 'running' || !t.operation) {
    if (t.status === 'queued' && !(t.params as { waiting_since?: string } | null)?.waiting_since && Date.now() - new Date(t.created_at).getTime() > 10 * 60_000) {
      await db.from('studio_takes').update({ status: 'failed', error: 'Never started.', cost_cents: 0, updated_at: now() }).eq('id', id);
      return { status: 'failed' };
    }
    return { status: t.status };
  }
  const fail = async (msg: string) => {
    await db.from('studio_takes').update({ status: 'failed', error: msg.slice(0, 300), cost_cents: 0, updated_at: now() }).eq('id', id);
    return { status: 'failed', error: msg };
  };
  try {
    const res = await fetch(`${BASE()}/${t.operation}`, { headers: headers(), signal: AbortSignal.timeout(20_000) });
    const op = (await res.json().catch(() => ({}))) as Operation;
    if (!res.ok) {
      if (Date.now() - new Date(t.created_at).getTime() > 30 * 60_000) return fail(`Gave up: ${op.error?.message ?? res.status}`);
      return { status: 'running' };
    }
    if (!op.done) {
      if (Date.now() - new Date(t.created_at).getTime() > 30 * 60_000) return fail('Timed out after 30 minutes.');
      return { status: 'running' };
    }
    if (op.error) return fail(op.error.message ?? 'Generation failed.');
    const g = op.response?.generateVideoResponse;
    const uri = g?.generatedSamples?.[0]?.video?.uri;
    if (!uri) return fail(g?.raiMediaFilteredReasons?.[0] ? `Filtered by Google’s safety check: ${g.raiMediaFilteredReasons[0]}` : 'No video returned.');
    const vid = await fetch(uri, { headers: { 'x-goog-api-key': KEY() }, redirect: 'follow', signal: AbortSignal.timeout(60_000) });
    if (!vid.ok) return { status: 'running', error: `download ${vid.status}` };
    const path = `studio/takes/${id}.mp4`;
    await put(path, Buffer.from(await vid.arrayBuffer()), { access: 'private', contentType: 'video/mp4', addRandomSuffix: false, allowOverwrite: true });
    await db.from('studio_takes').update({ status: 'ready', blob_path: path, updated_at: now() }).eq('id', id);
    await recordExpense(t.cost_cents, `Studio: Veo take (${t.model}, ${VIDEO_SECONDS}s)`, t.created_by);
    return { status: 'ready' };
  } catch (e) {
    return { status: 'running', error: e instanceof Error ? e.message : 'poll failed' };
  }
}

const THUMB_STYLE = 'Key art for a vertical 9:16 social video thumbnail (YouTube Shorts, Instagram Reels, TikTok cover). Cinematic, 35mm film look, rich warm practical light with deep shadows and a touch of orange-gold rim light, shallow depth of field, one clear focal subject with an expressive, readable face, strong silhouette, uncluttered background. Leave the bottom third calmer for a title overlay. Absolutely no text, letters, logos, watermarks or UI in the image. Original characters only, not resembling any real person or celebrity.';

/** Generate one thumbnail key art (already reserved), using the cast's reference sheets for consistent faces. */
export async function generateThumb(id: string): Promise<{ ok: boolean; error?: string }> {
  const db = adminDb();
  const { data: a } = await db.from('studio_art').select('*').eq('id', id).single();
  if (!a) return { ok: false, error: 'not found' };
  await db.from('studio_art').update({ status: 'running', updated_at: now() }).eq('id', id);
  try {
    const parts: Record<string, unknown>[] = [{ text: `${THUMB_STYLE}\n\n${a.prompt}` }];
    if (a.ref_ids?.length) {
      const { data: rows } = await db.from('studio_refs').select('character, blob_path').in('id', a.ref_ids).eq('status', 'ready');
      for (const row of (rows ?? []).slice(0, 3)) {
        const img = row.blob_path ? await blobBase64(row.blob_path) : null;
        if (img) parts.push({ text: `Reference sheet for ${row.character}: match this person's face, hair and wardrobe exactly.` }, { inlineData: img });
      }
    }
    const res = await fetch(`${BASE()}/models/${encodeURIComponent(a.model)}:generateContent`, {
      method: 'POST', headers: headers(), signal: AbortSignal.timeout(110_000),
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '9:16', imageSize: '2K' } } }),
    });
    const j = (await res.json().catch(() => ({}))) as { candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] }; finishReason?: string }[]; error?: { message?: string }; promptFeedback?: { blockReason?: string } };
    if (!res.ok) throw new Error(j.error?.message || `HTTP ${res.status}`);
    const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!part?.inlineData?.data) throw new Error(j.promptFeedback?.blockReason ? `Blocked: ${j.promptFeedback.blockReason}` : `No image returned (${j.candidates?.[0]?.finishReason ?? 'unknown'})`);
    const ext = part.inlineData.mimeType === 'image/jpeg' ? 'jpg' : 'png';
    const path = `studio/art/${id}.${ext}`;
    await put(path, Buffer.from(part.inlineData.data, 'base64'), { access: 'private', contentType: part.inlineData.mimeType ?? 'image/png', addRandomSuffix: false, allowOverwrite: true });
    await db.from('studio_art').update({ status: 'ready', blob_path: path, updated_at: now() }).eq('id', id);
    // The first finished thumbnail of an episode becomes its thumbnail until someone picks another.
    const { count } = await db.from('studio_art').select('id', { count: 'exact', head: true }).eq('episode_id', a.episode_id).eq('chosen', true);
    if (!count) await db.from('studio_art').update({ chosen: true }).eq('id', id);
    await recordExpense(a.cost_cents, `Studio: thumbnail key art (${a.model})`, a.created_by);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 300) : 'failed';
    await db.from('studio_art').update({ status: 'failed', error: msg, cost_cents: 0, updated_at: now() }).eq('id', id);
    return { ok: false, error: msg };
  }
}

/** A private blob as a data URL (for composing the framed thumbnail). */
export async function blobDataUrl(path: string): Promise<string | null> {
  const img = await blobBase64(path);
  return img ? `data:${img.mimeType};base64,${img.data}` : null;
}
