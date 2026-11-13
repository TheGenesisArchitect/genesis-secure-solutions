// Unedit Pro's graphics pass, server only. ffmpeg cuts a clean 9:16 clip (no captions); Remotion renders the
// UneditPro composition from Genovus Motion over it inside a Vercel Sandbox (layouts per planned shot, real
// screen-library inserts, the Genovus captions); this function reads the MP4 back out of the sandbox and stores it in
// private Blob as the clip, so the card and Metricool are unchanged and the Blob token never enters the sandbox.
// No AWS: the sandbox signs in with this deployment's Vercel OIDC token. Off unless UNEDIT_PRO=on; then any failure
// falls back to the plain clip, never a stuck job. The bundle (remotion/unedit-pro) is built from Genovus Motion with
// scripts/bundle-pro.mjs and must use the same Remotion version as @remotion/vercel here (4.0.533).
import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';
import assets from '@/data/screen-library-assets.json';
import type { Cue } from '@/lib/unedit-cues';
import { presigned, wordsForSpans, type Span, type Word } from '@/lib/unedit-media';
import type { Shot } from '@/lib/unedit-shots';

export const proConfigured = () => (process.env.UNEDIT_PRO ?? '').trim() === 'on';

type ProShot = { s: number; e: number; layout: Shot['layout']; accent: string | null; figure: string | null; screen: { still: string; clip: string | null; wide: boolean } | null };
/** A cue on the clip's own timeline (lib/unedit-cues.ts), for Genovus Motion's cue layer. */
export type ProCue = { t: number; end: number; kind: Cue['kind']; text: string; icon?: string; items?: { text: string; t: number }[]; value?: number; prefix?: string; suffix?: string; screen?: ProShot['screen']; sound: Cue['sound']; cam: Cue['cam'] };
export type ProProps = { src: string; secs: number; words: Word[]; shots: ProShot[]; cues: ProCue[]; serif: boolean; sfx: boolean };

const ENTRIES = (assets as { entries: Record<string, { clip?: string; still?: string }> }).entries ?? {};

/** A library screen as presigned links: the phone capture (it fills a 9:16 panel), else the desktop one. */
export async function screenLinks(code: string): Promise<ProShot['screen']> {
  const phone = ENTRIES[`${code}:phone`];
  const a = phone ?? ENTRIES[`${code}:desktop`];
  if (!a?.still) return null;
  return { still: await presigned(a.still, 120), clip: a.clip ? await presigned(a.clip, 120) : null, wide: !phone };
}

/** The composition's props: words and shots moved onto the clip's own timeline (spans play back to back, the hook
 *  first). Shots arrive in play order, so each takes the next span that holds it. */
export async function proProps(src: string, words: Word[], spans: Span[], shots: Shot[], accents: number[], cues: Cue[] = []): Promise<ProProps> {
  const marks = new Set(accents);
  const timed = wordsForSpans(words.map((w, i) => (marks.has(i) ? { ...w, a: true } : w)), spans);
  const secs = spans.reduce((a, s) => a + (s.to - s.from), 0);
  const out: ProShot[] = [];
  let k = 0, offset = 0;
  // A span owns a shot that starts inside it, or in the cut just before it (Episode Pro removes "um"s and pauses, so a
  // sentence can start in a gap); across the hook-to-moment jump only a small lead counts.
  const owns = (sh: Shot, i: number) => {
    const lead = i > 0 && spans[i - 1].to <= spans[i].from ? spans[i - 1].to : spans[i].from - 0.2;
    return sh.s >= lead && sh.s < spans[i].to;
  };
  for (const sh of shots) {
    while (k < spans.length && !owns(sh, k)) { offset += spans[k].to - spans[k].from; k++; }
    if (k >= spans.length) break;
    const sp = spans[k];
    out.push({
      s: offset + Math.max(0, sh.s - sp.from), e: Math.min(secs, offset + Math.min(sh.e, sp.to) - sp.from), layout: sh.layout,
      accent: sh.accent != null ? words[sh.accent]?.w ?? null : null, figure: sh.figure,
      screen: sh.screen ? await screenLinks(sh.screen) : null,
    });
  }
  if (out[0]) out[0].s = 0;
  // Cues: each lands where its word plays in the clip (the first time, if the hook repeats it); a cue whose word the
  // edit cut is dropped. List items appear as each is said.
  const at = (t: number) => { let off = 0; for (const sp of spans) { if (t >= sp.from - 0.02 && t <= sp.to + 0.02) return off + Math.max(0, t - sp.from); off += sp.to - sp.from; } return null; };
  const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9$%']/g, '');
  const outCues: ProCue[] = [];
  for (const c of cues) {
    const t = at(c.s);
    if (t == null) continue;
    const end = Math.min(secs, (at(c.e) ?? t + 2.5) + 0.4);
    const items = c.items?.map((it) => {
      const first = norm(it.split(' ')[0]);
      const k = words.findIndex((w, i) => i >= c.w && norm(w.w) === first);
      return { text: it, t: k >= 0 ? at(words[k].s) ?? t : t };
    });
    outCues.push({ t, end: Math.max(end, t + 1.2, ...(items ?? []).map((x) => x.t + 1)), kind: c.kind, text: c.text, icon: c.icon, items, value: c.value, prefix: c.prefix, suffix: c.suffix, screen: c.screen ? await screenLinks(c.screen) : null, sound: c.sound, cam: c.cam });
  }
  // A big word or figure card is a beat, not a scene: after 2.4 s it hands back to the speaker's face.
  for (let i = 0; i < out.length; i++) {
    const sh = out[i];
    if ((sh.layout === 'word' || sh.layout === 'number') && sh.e - sh.s > 3.2) {
      out.splice(i + 1, 0, { s: sh.s + 2.4, e: sh.e, layout: 'face', accent: null, figure: null, screen: null });
      sh.e = sh.s + 2.4;
    }
  }
  // One graphic at a time: while a cue is on screen, the shot under it is the speaker's face (no figure card, big
  // word or second screen competing with it). A whip is only a camera move, so it changes nothing.
  for (const sh of out) {
    if (sh.layout === 'face') continue;
    if (outCues.some((c) => c.kind !== 'whip' && c.t < sh.e && c.end > sh.s)) Object.assign(sh, { layout: 'face', figure: null, screen: null });
  }
  return { src, secs, words: timed, shots: out.length ? out : [{ s: 0, e: secs, layout: 'face', accent: null, figure: null, screen: null }], cues: outCues, serif: true, sfx: process.env.UNEDIT_SFX !== 'off' };
}

/** Render a clip's graphics pass (UneditPro, H.264) in a fresh Vercel Sandbox. */
export async function renderPro(props: ProProps): Promise<Buffer> {
  return renderOnSandbox('UneditPro', props as unknown as Record<string, unknown>, { codec: 'h264', crf: 20 });
}

/** Render one Genovus Motion composition in a fresh Vercel Sandbox and return the file's bytes. The sandbox lives
 *  at most 13 minutes and is stopped when done; setup (system packages, Chrome) is part of each render for now.
 *  The episode's graphics reel renders transparent: VP8 with alpha (yuva420p, PNG frames). */
export async function renderOnSandbox(compositionId: string, inputProps: Record<string, unknown>, out: { codec: 'h264' | 'vp8'; crf?: number; alpha?: boolean; frameRange?: [number, number] }): Promise<Buffer> {
  // ESM-only package: loaded on demand, so a server bundle that requires its externals still works.
  const { addBundleToSandbox, createSandbox, renderMediaOnVercel } = await import('@remotion/vercel');
  const sandbox = await createSandbox({ timeoutInMilliseconds: 13 * 60_000 });
  try {
    // addBundleToSandbox makes the bundle's subfolders but not its root (@remotion/vercel 4.0.533).
    await sandbox.mkDir('remotion-bundle').catch(() => {});
    const bundleDir = path.join(process.cwd(), 'remotion/unedit-pro');
    await addBundleToSandbox({ sandbox, bundleDir });
    // The renderer opens bundle.js.map before it picks the composition, but the deployed function doesn't carry .map
    // files (file tracing drops them), so the first production renders failed with ENOENT. Send the map if this
    // copy has it, else a valid empty one (it only improves error stack traces).
    const map = await fs.readFile(path.join(bundleDir, 'bundle.js.map')).catch(() => Buffer.from('{"version":3,"sources":[],"names":[],"mappings":""}'));
    await sandbox.writeFiles([{ path: 'remotion-bundle/bundle.js.map', content: map }]);
    const { sandboxFilePath } = await renderMediaOnVercel({
      sandbox, compositionId, inputProps, codec: out.codec, crf: out.crf ?? null, timeoutInMilliseconds: 8 * 60_000,
      ...(out.alpha ? { pixelFormat: 'yuva420p' as const, imageFormat: 'png' as const } : {}),
      ...(out.frameRange ? { frameRange: out.frameRange } : {}),
    });
    const bytes = await sandbox.readFileToBuffer({ path: sandboxFilePath }, { signal: AbortSignal.timeout(180_000) });
    if (!bytes?.length) throw new Error('The render finished without a video file.');
    return bytes;
  } finally {
    await sandbox.stop().catch(() => {});
  }
}
