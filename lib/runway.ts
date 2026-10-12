// Runway, the Studio's engine hub (StudioNext): one key reaches video (Seedance 2.5, Gen-4.5, Veo 3.1), images
// (Gen-4 Image with reference images for identity lock), performance (Act-Two), voices (ElevenLabs v4 with audio
// tags, custom voices from a description) and finishing. REST over fetch, no SDK; field names follow Runway's
// official SDK (@runwayml/sdk 4.21) and API version 2024-11-06. Server only; the key lives in Vercel.
// Every generation goes through the Studio budget before it is started (lib/studio-engines, next step).
import 'server-only';

// The operator saved the key as Genovus_Runway_API_Key; RUNWAYML_API_SECRET (Runway's own name) also works.
const KEY = () => (process.env.RUNWAYML_API_SECRET || process.env.Genovus_Runway_API_Key || '').trim();
const BASE = () => (process.env.RUNWAY_API_BASE || 'https://api.dev.runwayml.com/v1').replace(/\/$/, '');
export const runwayConfigured = () => Boolean(KEY());
/** Runway sells API credits at one cent each. */
export const CREDIT_CENTS = 1;

async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  if (!runwayConfigured()) throw new Error('Runway is not connected (RUNWAYML_API_SECRET).');
  const res = await fetch(`${BASE()}${path}`, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: { authorization: `Bearer ${KEY()}`, 'x-runway-version': '2024-11-06', ...(init.body ? { 'content-type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(30_000),
    cache: 'no-store',
  });
  if (res.status === 204) return undefined as T;
  const j = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!res.ok) throw new Error(`Runway: ${j.error ?? j.message ?? `HTTP ${res.status}`}`);
  return j;
}

/** Credit balance and tier limits: free to call, so the Studio can show what's left before anything spends. */
export async function runwayOrganization() {
  return call<{ creditBalance: number; tier?: { maxMonthlyCreditSpend?: number } }>('/organization');
}

export type RunwayTask = { id: string; status: 'PENDING' | 'THROTTLED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'; progress?: number; output?: string[]; failure?: string; failureCode?: string; estimatedCost?: { credits: number } };
export const runwayTask = (id: string) => call<RunwayTask>(`/tasks/${encodeURIComponent(id)}`);
export const cancelRunwayTask = (id: string) => call<void>(`/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });

type Img = { uri: string; position?: 'first' | 'last' };
/** Video from images: Seedance 2.5 (reference images keep the cast on-model; up to 30 s), Gen-4.5, Veo 3.1. */
export function runwayVideo(p: { model: 'seedance2_5' | 'gen4.5' | 'gen4_turbo' | 'veo3.1' | 'veo3.1_fast'; images: Img[]; prompt: string; ratio: string; duration?: number; audio?: boolean; seed?: number }) {
  const promptImage = p.images.length === 1 && !p.images[0].position && p.model !== 'seedance2_5' ? p.images[0].uri : p.images;
  return call<{ id: string }>('/image_to_video', { body: { model: p.model, promptImage, promptText: p.prompt, ratio: p.ratio, ...(p.duration ? { duration: p.duration } : {}), ...(p.audio != null ? { audio: p.audio } : {}), ...(p.seed != null ? { seed: p.seed } : {}) } });
}

/** A still from text plus tagged reference images (@marcus, @office…), for keyframes that keep identities locked. */
export function runwayImage(p: { model?: 'gen4_image' | 'gen4_image_turbo'; prompt: string; ratio: string; refs: { uri: string; tag?: string }[]; seed?: number }) {
  return call<{ id: string }>('/text_to_image', { body: { model: p.model ?? 'gen4_image', promptText: p.prompt, ratio: p.ratio, referenceImages: p.refs, ...(p.seed != null ? { seed: p.seed } : {}) } });
}

/** Act-Two: a reference performance (the director on a phone) drives a character image or video. */
export function runwayPerformance(p: { character: { type: 'image' | 'video'; uri: string }; reference: string; bodyControl?: boolean; expressionIntensity?: number; ratio?: string }) {
  return call<{ id: string }>('/character_performance', { body: { model: 'act_two', character: p.character, reference: { type: 'video', uri: p.reference }, ...(p.bodyControl != null ? { bodyControl: p.bodyControl } : {}), ...(p.expressionIntensity != null ? { expressionIntensity: p.expressionIntensity } : {}), ...(p.ratio ? { ratio: p.ratio } : {}) } });
}

/** A directed line read: ElevenLabs v4 through Runway, with audio tags ([warm], [pause], [whispers]) in the text. */
export function runwaySpeech(p: { text: string; voice: { type: 'runway-preset'; presetId: string } | { type: string; id: string }; previousText?: string; nextText?: string; seed?: number }) {
  return call<{ id: string }>('/text_to_speech', { body: { model: 'eleven_v4', promptText: p.text, voice: p.voice, ...(p.previousText ? { previousText: p.previousText } : {}), ...(p.nextText ? { nextText: p.nextText } : {}), ...(p.seed != null ? { seed: p.seed } : {}) } });
}
