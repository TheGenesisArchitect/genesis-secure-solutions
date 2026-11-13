// Unedit Pro's graphics pass, server only. ffmpeg cuts a clean 9:16 clip (no captions); Remotion Lambda renders the
// UneditPro composition from Genovus Motion over it (layouts per planned shot, real screen-library inserts, the
// Genovus captions); the result comes back into private Blob as the clip, so the card and Metricool are unchanged.
// Off until the Remotion env is set (REMOTION_AWS_ACCESS_KEY_ID / _SECRET_ACCESS_KEY, REMOTION_SERVE_URL,
// REMOTION_FUNCTION_NAME, REMOTION_AWS_REGION); then a failed pass falls back to the plain clip, never a stuck job.
// The composition's Remotion version must match @remotion/lambda here exactly (both 4.0.533).
import 'server-only';
import { getRenderProgress, presignUrl, renderMediaOnLambda, type AwsRegion } from '@remotion/lambda/client';
import assets from '@/data/screen-library-assets.json';
import { presigned, wordsForSpans, type Span, type Word } from '@/lib/unedit-media';
import type { Shot } from '@/lib/unedit-shots';

const REGION = () => ((process.env.REMOTION_AWS_REGION || 'us-east-1').trim()) as AwsRegion;
export const proConfigured = () => Boolean(process.env.REMOTION_AWS_ACCESS_KEY_ID && process.env.REMOTION_AWS_SECRET_ACCESS_KEY && process.env.REMOTION_SERVE_URL && process.env.REMOTION_FUNCTION_NAME);

type ProShot = { s: number; e: number; layout: Shot['layout']; accent: string | null; figure: string | null; screen: { still: string; clip: string | null } | null };
export type ProProps = { src: string; secs: number; words: Word[]; shots: ProShot[]; serif: boolean };

const ENTRIES = (assets as { entries: Record<string, { clip?: string; still?: string }> }).entries ?? {};

/** A library screen as presigned links: the phone capture (it fills a 9:16 panel), else the desktop one. */
async function screenLinks(code: string): Promise<ProShot['screen']> {
  const a = ENTRIES[`${code}:phone`] ?? ENTRIES[`${code}:desktop`];
  if (!a?.still) return null;
  return { still: await presigned(a.still, 120), clip: a.clip ? await presigned(a.clip, 120) : null };
}

/** The composition's props: words and shots moved onto the clip's own timeline (spans play back to back, the hook
 *  first). Shots arrive in play order, so each takes the next span that holds it. */
export async function proProps(src: string, words: Word[], spans: Span[], shots: Shot[], accents: number[]): Promise<ProProps> {
  const marks = new Set(accents);
  const timed = wordsForSpans(words.map((w, i) => (marks.has(i) ? { ...w, a: true } : w)), spans);
  const secs = spans.reduce((a, s) => a + (s.to - s.from), 0);
  const out: ProShot[] = [];
  let k = 0, offset = 0;
  for (const sh of shots) {
    while (k < spans.length && !(sh.s >= spans[k].from - 0.2 && sh.s < spans[k].to)) { offset += spans[k].to - spans[k].from; k++; }
    if (k >= spans.length) break;
    const sp = spans[k];
    out.push({
      s: Math.max(0, offset + sh.s - sp.from), e: Math.min(secs, offset + Math.min(sh.e, sp.to) - sp.from), layout: sh.layout,
      accent: sh.accent != null ? words[sh.accent]?.w ?? null : null, figure: sh.figure,
      screen: sh.screen ? await screenLinks(sh.screen) : null,
    });
  }
  if (out[0]) out[0].s = 0;
  return { src, secs, words: timed, shots: out.length ? out : [{ s: 0, e: secs, layout: 'face', accent: null, figure: null, screen: null }], serif: false };
}

/** Render on Remotion Lambda and return the MP4 bytes (polls until done; throws on a render error or after 9 min). */
export async function renderPro(props: ProProps): Promise<Buffer> {
  const region = REGION();
  const functionName = process.env.REMOTION_FUNCTION_NAME!.trim();
  const { renderId, bucketName } = await renderMediaOnLambda({
    region, functionName, serveUrl: process.env.REMOTION_SERVE_URL!.trim(), composition: 'UneditPro',
    inputProps: props as unknown as Record<string, unknown>, codec: 'h264', crf: 20, privacy: 'private', maxRetries: 1, downloadBehavior: null,
  });
  const until = Date.now() + 9 * 60_000;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 4000));
    const p = await getRenderProgress({ renderId, bucketName, functionName, region });
    if (p.fatalErrorEncountered) throw new Error(`Remotion: ${p.errors[0]?.message?.slice(0, 200) ?? 'render failed'}`);
    if (p.done && p.outKey) {
      const url = await presignUrl({ region, bucketName, objectKey: p.outKey, expiresInSeconds: 600 });
      const r = await fetch(url, { signal: AbortSignal.timeout(180_000) });
      if (!r.ok) throw new Error(`Remotion output download failed (${r.status}).`);
      return Buffer.from(await r.arrayBuffer());
    }
  }
  throw new Error('Remotion render took longer than 9 minutes.');
}
