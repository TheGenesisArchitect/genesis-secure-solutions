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
export async function generateRef(id: string): Promise<{ ok: boolean; error?: string }> {
  const db = adminDb();
  const { data: r } = await db.from('studio_refs').select('*').eq('id', id).single();
  if (!r) return { ok: false, error: 'not found' };
  await db.from('studio_refs').update({ status: 'running', updated_at: now() }).eq('id', id);
  try {
    const res = await fetch(`${BASE()}/models/${encodeURIComponent(r.model)}:generateContent`, {
      method: 'POST', headers: headers(), signal: AbortSignal.timeout(110_000),
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `${SHEET_STYLE}\n\n${r.prompt}` }] }],
        generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '9:16', imageSize: '2K' } },
      }),
    });
    const j = (await res.json().catch(() => ({}))) as { candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] }; finishReason?: string }[]; error?: { message?: string }; promptFeedback?: { blockReason?: string } };
    if (!res.ok) throw new Error(j.error?.message || `HTTP ${res.status}`);
    const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!part?.inlineData?.data) throw new Error(j.promptFeedback?.blockReason ? `Blocked: ${j.promptFeedback.blockReason}` : `No image returned (${j.candidates?.[0]?.finishReason ?? 'unknown'})`);
    const ext = part.inlineData.mimeType === 'image/jpeg' ? 'jpg' : 'png';
    const path = `studio/refs/${id}.${ext}`;
    await put(path, Buffer.from(part.inlineData.data, 'base64'), { access: 'private', contentType: part.inlineData.mimeType ?? 'image/png', addRandomSuffix: false, allowOverwrite: true });
    await db.from('studio_refs').update({ status: 'ready', blob_path: path, updated_at: now() }).eq('id', id);
    await recordExpense(r.cost_cents, `Studio: character sheet for ${r.character} (${r.model})`, r.created_by);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 300) : 'failed';
    await db.from('studio_refs').update({ status: 'failed', error: msg, cost_cents: 0, updated_at: now() }).eq('id', id);
    return { ok: false, error: msg };
  }
}

/** Start a Veo take (already reserved): sends the shot prompt with the cast's canonical sheets as references. */
export async function startTake(id: string): Promise<{ ok: boolean; error?: string }> {
  const db = adminDb();
  const { data: t } = await db.from('studio_takes').select('*').eq('id', id).single();
  if (!t) return { ok: false, error: 'not found' };
  const refs: { image: { inlineData: { data: string; mimeType: string } }; referenceType: 'asset' }[] = [];
  if (t.ref_ids?.length) {
    const { data: rows } = await db.from('studio_refs').select('blob_path').in('id', t.ref_ids).eq('status', 'ready');
    for (const row of (rows ?? []).slice(0, 3)) {
      const img = row.blob_path ? await blobBase64(row.blob_path) : null;
      if (img) refs.push({ image: { inlineData: img }, referenceType: 'asset' });
    }
  }
  const call = async (withRefs: boolean) => fetch(`${BASE()}/models/${encodeURIComponent(t.model)}:predictLongRunning`, {
    method: 'POST', headers: headers(), signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      instances: [{ prompt: t.prompt, ...(withRefs && refs.length ? { referenceImages: refs } : {}) }],
      parameters: { aspectRatio: '9:16', durationSeconds: String(VIDEO_SECONDS), resolution: '1080p', personGeneration: withRefs && refs.length ? 'allow_adult' : 'allow_all' },
    }),
  });
  try {
    let res = await call(true);
    let j = (await res.json().catch(() => ({}))) as { name?: string; error?: { message?: string } };
    let note: string | null = null;
    if (!res.ok && refs.length) {
      // Reference images aren't accepted for this request: generate from the prompt alone and say so.
      note = `References not accepted (${j.error?.message ?? res.status}); generated from the prompt only.`;
      res = await call(false);
      j = (await res.json().catch(() => ({}))) as { name?: string; error?: { message?: string } };
    }
    if (!res.ok || !j.name) throw new Error(j.error?.message || `HTTP ${res.status}`);
    await db.from('studio_takes').update({ status: 'running', operation: j.name, error: note, params: { ...(t.params ?? {}), refs: note ? 0 : refs.length }, updated_at: now() }).eq('id', id);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 300) : 'failed';
    await db.from('studio_takes').update({ status: 'failed', error: msg, cost_cents: 0, updated_at: now() }).eq('id', id);
    return { ok: false, error: msg };
  }
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
    if (t.status === 'queued' && Date.now() - new Date(t.created_at).getTime() > 10 * 60_000) {
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
