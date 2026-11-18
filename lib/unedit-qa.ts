// The quality check: before the card shows a finished episode, Claude looks at it the way a finishing editor does.
// One still per graphic, from the finished episode (footage + graphics together), checked for what code can't see:
// text over the face, text that doesn't read against the footage, text cut off by the frame, two graphics colliding.
// The geometry rules already ran in code (lib/unedit-style.ts); this is the second pass. Fixed actions only: a graphic
// that fails is dropped and the episode re-renders ONCE; anything after that is reported on the card, never looped.
import { jsonMatch } from '@/lib/json-reply';
import 'server-only';
import { frames } from '@/lib/unedit-media';
import type { EpGraphic } from '@/lib/unedit-episode';

const MODEL = () => (process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5').trim();
const BASE = () => (process.env.ANTHROPIC_API_BASE || 'https://api.anthropic.com').replace(/\/$/, '');
const PRICE = { in: 300, out: 1500 }; // cents per million tokens
const PER_CALL = 14; // stills per request
const MAX_STILLS = 56; // every graphic of a long episode (four requests at most)

export type QaIssue = { i: number; problem: string; drop: boolean };
/** `failed`: why the check couldn't run (then nothing was checked, and the card must not call it passed). */
export type QaResult = { checked: number; issues: QaIssue[]; cents: number; failed?: string };

/** Which graphics to check: everything on screen over the speaker (full-frame closes own the frame, so they are skipped). */
export function qaTargets(items: EpGraphic[]): number[] {
  return items.map((g, i) => ({ g, i })).filter(({ g }) => g.style ? !/^end\./.test(g.style) : g.kind !== 'end').map(({ i }) => i).slice(0, MAX_STILLS);
}

const describe = (g: EpGraphic) => `${g.kind}${g.style ? ` (${g.style}${g.layer === 'behind' ? ', behind the speaker' : ''})` : ''}: "${g.text}"`;

/** Check the finished episode's graphics: every one of them (it used to stop at the first 14, so a long episode's
 *  later graphics were never looked at, 2026-11-18), in requests of PER_CALL stills. Never throws: a check that
 *  can't run says so in `failed` instead of passing. */
export async function qaEpisode(episodeUrl: string, items: EpGraphic[]): Promise<QaResult> {
  const k = (process.env.ANTHROPIC_API_KEY || '').trim();
  const targets = qaTargets(items);
  if (!targets.length) return { checked: 0, issues: [], cents: 0 };
  if (!k) return { checked: 0, issues: [], cents: 0, failed: 'no Claude key' };
  const out: QaResult = { checked: 0, issues: [], cents: 0 };
  for (let j = 0; j < targets.length; j += PER_CALL) {
    const r = await qaBatch(k, episodeUrl, items, targets.slice(j, j + PER_CALL));
    out.cents += r.cents; out.checked += r.checked; out.issues.push(...r.issues);
    if (r.failed) out.failed = r.failed;
  }
  return out;
}

async function qaBatch(k: string, episodeUrl: string, items: EpGraphic[], targets: number[]): Promise<QaResult> {
  try {
    // Each still lands where the graphic is fully on (past its entrance, before its exit).
    const at = targets.map((i) => items[i].T + Math.min(items[i].D * 0.55, 1.6));
    const stills = await frames(episodeUrl, at, 1280);
    if (stills.length !== targets.length) return { checked: 0, issues: [], cents: 0, failed: 'stills could not be taken' };
    const content = [
      ...stills.flatMap((b, n) => [{ type: 'text', text: `Still ${n} — ${describe(items[targets[n]])}` }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b.toString('base64') } }]),
      { type: 'text', text: [
        'You are the finishing editor on a premium YouTube episode. Each still shows one on-screen graphic over real footage of the speaker.',
        'Flag a still ONLY for a real defect a viewer would notice: text covering the speaker\'s eyes, nose or mouth (text behind the speaker\'s head, with the head in front of it, is intended and fine); text that does not read against the footage; text cut off by the frame edge; two graphics overlapping each other.',
        'Also flag a still whose described graphic is NOT visible at all (only the speaker or plain footage where the graphic should be): problem "missing", "drop": false. A missing graphic is a defect even when the frame looks clean.',
        'For each defect, say in under 12 words what is wrong, and "drop": true if leaving that graphic out fixes it.',
        'Return only JSON: {"issues":[{"still":<n>,"problem":"…","drop":true}]} (an empty list when everything is clean).',
      ].join('\n') },
    ];
    const r = await fetch(`${BASE()}/v1/messages`, {
      method: 'POST',
      headers: { 'x-api-key': k, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL(), max_tokens: 800, messages: [{ role: 'user', content }] }),
      signal: AbortSignal.timeout(120_000),
    });
    const j = (await r.json().catch(() => ({}))) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
    const cents = Math.ceil(((j.usage?.input_tokens ?? 0) * PRICE.in + (j.usage?.output_tokens ?? 0) * PRICE.out) / 1_000_000);
    if (!r.ok) return { checked: 0, issues: [], cents, failed: `Claude answered ${r.status}` };
    const m = jsonMatch((j.content ?? []).map((b) => b.text ?? '').join(''));
    const raw = (m ? (JSON.parse(m[0]).issues as unknown[]) : []) ?? [];
    const issues: QaIssue[] = [];
    for (const x of Array.isArray(raw) ? raw : []) {
      const o = x as { still?: number; problem?: string; drop?: boolean };
      const n = Number(o.still);
      if (!Number.isInteger(n) || n < 0 || n >= targets.length) continue;
      const problem = String(o.problem ?? '').replace(/\s+/g, ' ').trim().slice(0, 90);
      if (problem) issues.push({ i: targets[n], problem, drop: o.drop === true });
    }
    return { checked: targets.length, issues, cents };
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    console.error(`[unedit] quality check: ${why}`);
    return { checked: 0, issues: [], cents: 0, failed: why.slice(0, 120) };
  }
}
