// The Production Monitor: where each shot's steps are (line reads, keyframe, take), how long each has taken, what
// Runway last said (queued, throttled, running and how far), why a step failed, and whether a step has taken longer
// than it should. Pure functions over rows the episode page already loads; no network calls.

export type Job = { id: string; shot_id: string | null; status: string; error: string | null; created_at: string; done_at?: string | null; runway_status?: string | null; runway_progress?: number | null; model?: string | null; params?: Record<string, unknown> | null; slot?: string | null; kind?: string };
export type StepKey = 'lines' | 'keyframe' | 'take';
export type Step = { key: StepKey; label: string; state: 'waiting' | 'running' | 'done' | 'failed'; secs: number; status: string | null; progress: number | null; error: string | null; model: string | null; stuck: boolean };

// How long a step should take before the board flags it (seconds). Runway's queue can add time on busy days.
export const STUCK_AFTER: Record<StepKey, number> = { lines: 120, keyframe: 180, take: 480 };
const LABEL: Record<StepKey, string> = { lines: 'Lines', keyframe: 'Keyframe', take: 'Take' };
const MODEL_NAME: Record<string, string> = { seedance2_5: 'Seedance 2.5', 'gen4.5': 'Gen-4.5', gen4_image: 'Gen-4 Image', eleven_v4: 'ElevenLabs v4', seed_audio: 'Seed Audio', 'veo3.1': 'Veo 3.1', 'veo3.1_fast': 'Veo 3.1 Fast' };
export const modelName = (m: string | null | undefined) => { const k = String(m ?? '').replace(/^runway:/, ''); return k ? MODEL_NAME[k] ?? k : null; };

const t = (s: string | null | undefined) => (s ? new Date(s).getTime() : 0);
function step(key: StepKey, jobs: Job[], now: number): Step | null {
  if (!jobs.length) return null;
  const busy = jobs.filter((j) => j.status === 'running' || j.status === 'queued');
  const failed = jobs.filter((j) => j.status === 'failed');
  const ready = jobs.filter((j) => j.status === 'ready');
  const start = Math.min(...jobs.map((j) => t(j.created_at)));
  const latest = [...jobs].sort((a, b) => t(b.created_at) - t(a.created_at))[0];
  const state: Step['state'] = busy.length ? 'running' : key === 'lines' ? (failed.length && !ready.length ? 'failed' : 'done') : latest.status === 'failed' ? 'failed' : latest.status === 'ready' ? 'done' : 'waiting';
  const end = state === 'running' ? now : Math.max(...jobs.map((j) => t(j.done_at) || t(j.created_at)));
  const secs = Math.max(0, Math.round((end - start) / 1000));
  const live = busy[0] ?? latest;
  const routed = (live.params as { routing?: { model?: string } } | null)?.routing?.model;
  return {
    key, label: LABEL[key], state, secs,
    status: state === 'running' ? live.runway_status ?? 'PENDING' : null,
    progress: state === 'running' && typeof live.runway_progress === 'number' ? live.runway_progress : null,
    error: state === 'failed' ? (latest.error ?? 'Runway didn’t say why.') : null,
    model: modelName(routed ?? live.model),
    stuck: state === 'running' && secs > STUCK_AFTER[key],
  };
}

/** A shot's steps since its current production pass started (`since`), oldest first. */
export function shotSteps(p: { since: string | null; clips: Job[]; frames: Job[]; takes: Job[] }, now = Date.now()): Step[] {
  // This pass's jobs, plus anything still running (a stuck job must never drop out of sight).
  const after = (j: Job) => !p.since || t(j.created_at) >= t(p.since) - 2000 || j.status === 'running' || j.status === 'queued';
  // A redo keeps reads whose wording didn't change: show those (done) rather than dropping the step.
  const lines = p.clips.filter(after).length ? p.clips.filter(after) : p.clips.filter((c) => c.status === 'ready');
  return [step('lines', lines, now), step('keyframe', p.frames.filter(after), now), step('take', p.takes.filter(after), now)].filter((x): x is Step => Boolean(x));
}

export const clock = (secs: number) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
const STATUS: Record<string, string> = { PENDING: 'queued at Runway', THROTTLED: 'waiting for a Runway slot', RUNNING: 'rendering' };
export const statusText = (s: Step) => (s.status ? `${STATUS[s.status] ?? s.status.toLowerCase()}${s.progress != null ? ` ${Math.round(s.progress * 100)}%` : ''}` : '');
