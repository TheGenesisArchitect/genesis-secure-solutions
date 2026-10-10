// SWIS™ Creative Court: a strict director and continuity supervisor that watches every generated take against
// its own Shot Contract (the timed performance, states, composition, continuity and negatives), the cast's
// reference sheets and the approved start frame, then scores it before any person reviews it.
// Weights: performance 30, story 20, character 15, cinematography 15, continuity 10, sound 5, brand 5.
// The Court ranks; it does not block. Only a hard fail rejects a take. Verdicts come from bars calibrated on our
// own scored takes (production = our median, hero = our 85th percentile, never above the targets 85 and 92), so
// the bars rise as the work does. The best take without a hard fail is the Court's pick; overrides calibrate it.
import 'server-only';
import { adminDb } from '@/lib/supabase/admin';
import { blobBase64, recordExpense } from '@/lib/studio-gen';
import type { ShotContract } from '@/lib/studio-direct';
import season from '@/data/studio-season1.json';
import castData from '@/data/studio-cast.json';

export const COURT_MODEL = () => (process.env.STUDIO_COURT_MODEL || 'gemini-3.1-pro-preview').trim();
// Published price (Gemini API, 2026-10): gemini-3.1-pro-preview $2.00 / 1M input, $12.00 / 1M output incl. thinking.
const PRICE_IN = 2.0, PRICE_OUT = 12.0;
const BASE = () => (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
const KEY = () => (process.env.GEMINI_API_KEY || '').trim();
const now = () => new Date().toISOString();

export const WEIGHTS = { performance: 30, story: 20, character: 15, cinematography: 15, continuity: 10, sound: 5, brand: 5 } as const;
export type Dimension = keyof typeof WEIGHTS;
export const HARD_FAILS = ['wrong_character_face', 'malformed_hands_or_anatomy', 'major_wardrobe_drift', 'broken_lip_sync', 'major_continuity_violation', 'unwanted_camera_movement', 'legible_text_or_invented_ui', 'visible_model_artifact', 'extra_people'] as const;
export const FAILURES = ['CHARACTER_DRIFT', 'FACE_DRIFT', 'WARDROBE_DRIFT', 'PROP_DRIFT', 'TIMING_MISS', 'PERFORMANCE_OVERACT', 'PERFORMANCE_UNDERACT', 'CAMERA_DRIFT', 'LIGHTING_DRIFT', 'ANATOMY_ERROR', 'TEMPORAL_ARTIFACT', 'LIP_SYNC_ERROR', 'VOICE_ERROR', 'CONTINUITY_ERROR', 'PRODUCT_UI_ERROR'] as const;
export type Verdict = 'reject' | 'review' | 'production' | 'hero';
export const VERDICT_LABEL: Record<Verdict, string> = { reject: 'Reject', review: 'Director review', production: 'Production acceptable', hero: 'Hero candidate' };

export type CourtRecord = {
  model: string;
  scores: Record<Dimension, number>;
  notes: Partial<Record<Dimension, string>>;
  total: number;
  verdict: Verdict;
  passes_tier: boolean;
  hard_fails: string[];
  failures: string[];
  beats: { expected: string; observed: string; hit: boolean; note?: string }[];
  usable: { in: number; out: number } | null;
  best_moment: string | null;
  summary: string;
  retry_advice: string;
  override?: { verdict: Verdict; reason: string; at: string };
};

export type Bars = { production: number; hero: number; calibrated: boolean; sample: number };
export const TARGET_BARS = { production: 85, hero: 92 };
const CALIBRATE_AFTER = 30;

/** Bars from our own scored takes once there are enough; until then the targets (shown, never blocking). */
export async function courtBars(): Promise<Bars> {
  const { data } = await adminDb().from('studio_takes').select('court_score').eq('court_status', 'scored').not('court_score', 'is', null).order('court_at', { ascending: false }).limit(300);
  const s = (data ?? []).map((r) => r.court_score as number).sort((a, b) => a - b);
  if (s.length < CALIBRATE_AFTER) return { ...TARGET_BARS, calibrated: false, sample: s.length };
  const pct = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { production: Math.min(TARGET_BARS.production, pct(0.5)), hero: Math.min(TARGET_BARS.hero, pct(0.85)), calibrated: true, sample: s.length };
}

/** Only a hard fail rejects; otherwise the bars place the take. */
export function verdictFor(total: number, hardFails: string[], bars: Pick<Bars, 'production' | 'hero'> = TARGET_BARS): Verdict {
  if (hardFails.length) return 'reject';
  if (total >= bars.hero) return 'hero';
  if (total >= bars.production) return 'production';
  return 'review';
}
export const tierBar = (tier: string | null | undefined, bars: Pick<Bars, 'production' | 'hero'> = TARGET_BARS) => (tier === 'hero' ? bars.hero : bars.production);

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    scores: { type: 'OBJECT', properties: Object.fromEntries(Object.keys(WEIGHTS).map((k) => [k, { type: 'INTEGER' }])), required: Object.keys(WEIGHTS) },
    notes: { type: 'OBJECT', properties: Object.fromEntries(Object.keys(WEIGHTS).map((k) => [k, { type: 'STRING' }])) },
    hard_fails: { type: 'ARRAY', items: { type: 'STRING', enum: [...HARD_FAILS] } },
    failures: { type: 'ARRAY', items: { type: 'STRING', enum: [...FAILURES] } },
    beats: { type: 'ARRAY', items: { type: 'OBJECT', properties: { expected: { type: 'STRING' }, observed: { type: 'STRING' }, hit: { type: 'BOOLEAN' }, note: { type: 'STRING' } }, required: ['expected', 'observed', 'hit'] } },
    usable_in: { type: 'NUMBER' },
    usable_out: { type: 'NUMBER' },
    best_moment: { type: 'STRING' },
    summary: { type: 'STRING' },
    retry_advice: { type: 'STRING' },
  },
  required: ['scores', 'hard_fails', 'failures', 'beats', 'summary', 'retry_advice'],
};

function brief(contract: ShotContract, tier: string): string {
  const genome = (season.series as { genome?: { forbidden?: string[] } }).genome;
  const dna = (castData.characters as { code: string; name: string; performance_dna?: { pace: string; reaction_order: string[]; never: string[] } }[])
    .filter((c) => Object.keys(contract.states.start).includes(c.code) && c.performance_dna)
    .map((c) => `${c.name.split(' ')[0]} (@${c.code}): ${c.performance_dna!.pace}; reacts: ${c.performance_dna!.reaction_order.join(' → ')}; never: ${c.performance_dna!.never.join(', ')}.`).join('\n');
  return [
    'You are the SWIS Creative Court for Genovus Studio: a strict film director, continuity supervisor and comedy editor. Judge this generated take against its Shot Contract. Be exact and unsentimental: score what is on screen, not what was intended. Watch it at full length with sound.',
    `RENDER CLASS: ${tier}. Score honestly against the full scale; the Studio calibrates its bars from these scores.`,
    `SHOT FUNCTION: ${contract.function}`,
    `INTENDED CUT LENGTH: ${contract.duration_s}s inside the 8s take.`,
    `COMPOSITION: ${contract.composition}. CAMERA: ${contract.camera}`,
    `CONTINUITY: ${contract.continuity.join('; ')}.`,
    `TIMED PERFORMANCE (the contract):\n${contract.timeline.map((b) => `${b.t[0].toFixed(1)}–${b.t[1].toFixed(1)}s: ${b.who ? `@${b.who} ` : ''}${b.do}`).join('\n')}`,
    dna ? `CHARACTER DNA:\n${dna}` : '',
    `NEGATIVE DIRECTION: ${[...contract.negative, ...(genome?.forbidden ?? [])].join('; ')}.`,
    `REFERENCE IMAGES: the cast reference sheets (labelled) define each face and wardrobe; the approved start frame (if labelled) is where the take must begin.`,
    `SCORE each dimension as whole points out of its maximum:
- performance (0–30): beat timing against the contract, reaction delays, eye-before-head order, holds and silences, expression size (no overacting), line delivery and cadence.
- story (0–20): is the shot's function readable without explanation; does the joke setup or reaction land.
- character (0–15): faces, hair, build and wardrobe match the reference sheets; behaviour matches the DNA.
- cinematography (0–15): composition, lens feel, camera behaviour (locked when locked), light, depth, framing.
- continuity (0–10): props, positions, wardrobe and set state match the contract and the start frame.
- sound (0–5): dialogue clarity and sync, room tone, no artifacts.
- brand (0–5): restrained, warm, human tone; no logos, no legible text or invented interface.`,
    `HARD FAILS (list any that occur): ${HARD_FAILS.join(', ')}.`,
    'BEATS: for each contract beat, give expected (its window) and observed (when it actually happens, in seconds), hit = within 0.25s for dialogue and important beats, and a short note when missed.',
    'USABLE: usable_in/usable_out = the best continuous window in seconds for the cut (about the intended cut length). best_moment = M:SS.s of the strongest frame.',
    'SUMMARY: two sentences a director can act on. RETRY_ADVICE: if the take falls short, the single most effective change to the contract or frames (e.g. tighten a beat, strengthen a face reference, lock the camera harder).',
  ].filter(Boolean).join('\n\n');
}

/** Put a video in front of the model: inline when small, otherwise through the Files API (deleted afterwards). */
async function videoPart(b64: string): Promise<{ part: Record<string, unknown>; cleanup: () => Promise<void> }> {
  const bytes = Buffer.from(b64, 'base64');
  if (bytes.length <= 14 * 1024 * 1024) return { part: { inlineData: { mimeType: 'video/mp4', data: b64 } }, cleanup: async () => {} };
  const root = BASE().replace(/\/v1beta$/, '');
  const start = await fetch(`${root}/upload/v1beta/files`, {
    method: 'POST',
    headers: { 'x-goog-api-key': KEY(), 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start', 'X-Goog-Upload-Header-Content-Length': String(bytes.length), 'X-Goog-Upload-Header-Content-Type': 'video/mp4', 'content-type': 'application/json' },
    body: JSON.stringify({ file: { display_name: 'court-take' } }),
  });
  const url = start.headers.get('x-goog-upload-url');
  if (!url) throw new Error(`Files API refused the upload (HTTP ${start.status})`);
  const up = await fetch(url, { method: 'POST', headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize', 'content-length': String(bytes.length) }, body: bytes });
  const f = ((await up.json().catch(() => ({}))) as { file?: { name: string; uri: string; state?: string } }).file;
  if (!f) throw new Error('Files API upload failed');
  for (let i = 0; i < 30 && f.state !== 'ACTIVE'; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const s = (await (await fetch(`${BASE()}/${f.name}`, { headers: { 'x-goog-api-key': KEY() } })).json().catch(() => ({}))) as { state?: string };
    f.state = s.state;
    if (s.state === 'FAILED') throw new Error('Files API could not process the video');
  }
  return { part: { fileData: { mimeType: 'video/mp4', fileUri: f.uri } }, cleanup: async () => { await fetch(`${BASE()}/${f.name}`, { method: 'DELETE', headers: { 'x-goog-api-key': KEY() } }).catch(() => {}); } };
}

/** Score one take. Safe to re-run (a fresh score replaces the old one; an override is kept). */
export async function scoreTake(id: string): Promise<{ ok: boolean; score?: number; verdict?: Verdict; error?: string }> {
  const db = adminDb();
  const { data: t } = await db.from('studio_takes').select('id, status, kind, blob_path, ref_ids, params, created_by, court, studio_shots(contract, tier)').eq('id', id).single();
  if (!t) return { ok: false, error: 'not found' };
  const shot = t.studio_shots as unknown as { contract: ShotContract | null; tier: string } | null;
  if (t.status !== 'ready' || !t.blob_path || !shot?.contract?.timeline?.length) {
    await db.from('studio_takes').update({ court_status: 'skipped', court_at: now() }).eq('id', id);
    return { ok: false, error: 'Only finished takes on shots with a Shot Contract go to the Court.' };
  }
  await db.from('studio_takes').update({ court_status: 'running', court_at: now() }).eq('id', id);
  let cleanup = async () => {};
  try {
    const video = await blobBase64(t.blob_path);
    if (!video) throw new Error('The take file is missing.');
    const vp = await videoPart(video.data);
    cleanup = vp.cleanup;
    const parts: Record<string, unknown>[] = [{ text: brief(shot.contract, shot.tier) }];
    if (t.ref_ids?.length) {
      const { data: rows } = await db.from('studio_refs').select('character, blob_path').in('id', t.ref_ids).eq('status', 'ready');
      for (const row of (rows ?? []).slice(0, 3)) {
        const img = row.blob_path ? await blobBase64(row.blob_path) : null;
        if (img) parts.push({ text: `Reference sheet: ${row.character}` }, { inlineData: img });
      }
    }
    const startId = (t.params as { start_frame?: string } | null)?.start_frame;
    if (startId) {
      const { data: fr } = await db.from('studio_art').select('blob_path').eq('id', startId).maybeSingle();
      const img = fr?.blob_path ? await blobBase64(fr.blob_path) : null;
      if (img) parts.push({ text: 'Approved start frame (the take must begin here):' }, { inlineData: img });
    }
    parts.push({ text: 'The take to judge:' }, vp.part);
    const res = await fetch(`${BASE()}/models/${encodeURIComponent(COURT_MODEL())}:generateContent`, {
      method: 'POST', headers: { 'x-goog-api-key': KEY(), 'content-type': 'application/json' }, signal: AbortSignal.timeout(170_000),
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, mediaResolution: 'MEDIA_RESOLUTION_HIGH' } }),
    });
    const j = (await res.json().catch(() => ({}))) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }; error?: { message?: string } };
    if (!res.ok) throw new Error(j.error?.message || `HTTP ${res.status}`);
    const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    const raw = JSON.parse(text) as { scores: Record<string, number>; notes?: Record<string, string>; hard_fails: string[]; failures: string[]; beats: CourtRecord['beats']; usable_in?: number; usable_out?: number; best_moment?: string; summary: string; retry_advice: string };
    const scores = Object.fromEntries((Object.keys(WEIGHTS) as Dimension[]).map((k) => [k, Math.max(0, Math.min(WEIGHTS[k], Math.round(Number(raw.scores?.[k]) || 0)))])) as Record<Dimension, number>;
    const total = Object.values(scores).reduce((a, b) => a + b, 0);
    const hard = (raw.hard_fails ?? []).filter((h) => (HARD_FAILS as readonly string[]).includes(h));
    const bars = await courtBars();
    const verdict = verdictFor(total, hard, bars);
    const u = j.usageMetadata ?? {};
    const cents = Math.max(1, Math.ceil(((u.promptTokenCount ?? 0) * PRICE_IN + ((u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0)) * PRICE_OUT) / 10_000));
    const prior = (t.court ?? {}) as Partial<CourtRecord>;
    const record: CourtRecord = {
      model: COURT_MODEL(), scores, notes: raw.notes ?? {}, total, verdict, passes_tier: verdict !== 'reject' && total >= tierBar(shot.tier, bars), hard_fails: hard,
      failures: (raw.failures ?? []).filter((f) => (FAILURES as readonly string[]).includes(f)), beats: (raw.beats ?? []).slice(0, 20),
      usable: Number.isFinite(raw.usable_in) && Number.isFinite(raw.usable_out) ? { in: Number(raw.usable_in), out: Number(raw.usable_out) } : null,
      best_moment: raw.best_moment ?? null, summary: String(raw.summary ?? '').slice(0, 800), retry_advice: String(raw.retry_advice ?? '').slice(0, 600),
      ...(prior.override ? { override: prior.override } : {}),
    };
    await db.from('studio_takes').update({ court: record, court_score: total, court_status: 'scored', court_cost_cents: cents, court_at: now() }).eq('id', id);
    await recordExpense(cents, `Studio: Creative Court review (${COURT_MODEL()})`, t.created_by);
    return { ok: true, score: total, verdict };
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 300) : 'failed';
    await db.from('studio_takes').update({ court_status: 'failed', court: { error: msg }, court_at: now() }).eq('id', id);
    return { ok: false, error: msg };
  } finally {
    await cleanup();
  }
}

/** Every minute: score finished takes that have not been to the Court yet (oldest first). */
export async function courtPending(limit = 2): Promise<{ scored: number; failed: number; paused?: string }> {
  const db = adminDb();
  // Court reviews count against the monthly Studio budget: pause them at the cap like every other generation.
  const [{ data: spent }, { data: b }] = await Promise.all([db.rpc('studio_spent_cents'), db.from('studio_budget').select('monthly_cap_cents').maybeSingle()]);
  if (b && Number(spent ?? 0) + 10 > b.monthly_cap_cents) return { scored: 0, failed: 0, paused: 'monthly Studio budget reached' };
  const { data } = await db.from('studio_takes').select('id, studio_shots!inner(contract)').eq('kind', 'video').eq('status', 'ready').is('court_status', null).order('created_at').limit(20);
  const due = ((data ?? []) as unknown as { id: string; studio_shots: { contract: { timeline?: unknown[] } | null } }[]).filter((t) => t.studio_shots?.contract?.timeline?.length).slice(0, limit);
  let scored = 0, failed = 0;
  for (const t of due) { const r = await scoreTake(t.id); if (r.ok) scored++; else failed++; }
  return { scored, failed };
}
