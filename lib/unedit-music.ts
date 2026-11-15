// Unedit's music bed: an original instrumental score per series, composed by Runway (Seed Audio) on the server and
// approved by a person before any episode uses it. Drafts land in private Blob under studio/music/drafts/; the one
// staff pick becomes studio/music/bed.mp3, which every polished episode lays under the voice (ducked by the voice,
// lib/unedit-episode.ts soundtrack). UNEDIT_MUSIC still overrides it with another licensed track's path.
// Runway's terms (updated Oct 23, 2026): it claims no ownership of outputs and doesn't restrict their commercial use.
import 'server-only';
import { head, list, put } from '@vercel/blob';
import { adminDb } from '@/lib/supabase/admin';
import { businessToday } from '@/lib/billing';
import { CREDIT_CENTS, runwayConfigured, runwayOrganization, runwaySound, runwayTask } from '@/lib/runway';

export const BED_PATH = 'studio/music/bed.mp3';
const DRAFTS = 'studio/music/drafts/';

/** The series looks a draft can be composed in (more series join as their sets do). */
export const SCORE_STYLES: Record<string, { label: string; prompt: string }> = {
  signal: { label: 'Genovus Signal (news and tech)', prompt: 'Instrumental underscore for a tech and business news explainer. Modern, focused, a little tense but hopeful. 92 BPM, steady pulsing synth bass, a soft felt-piano motif, light electronic percussion, warm analog pads.' },
  documentary: { label: 'Documentary (power, history)', prompt: 'Instrumental underscore for a documentary-style segment about power and technology. Cinematic but restrained: low string ostinato, ticking hi-hat, deep sub pulses, a sparse glassy synth motif. 88 BPM, minor key, tension that never climaxes.' },
  founder: { label: 'Founder story (warm, upbeat)', prompt: 'Instrumental underscore for a founder telling a personal business story. Warm and optimistic: plucked guitar, soft kick, light claps, gentle Rhodes chords. 100 BPM, major key, unhurried.' },
};
const UNDER_VOICE = 'It sits under a speaking voice: no vocals, no lyrics, no lead melody competing with speech, mid-range kept clear, even energy throughout, loopable, about 60 seconds.';

/** The bed every episode uses: UNEDIT_MUSIC if set, else the approved bed, else none. */
export async function musicBed(): Promise<string | null> {
  const env = (process.env.UNEDIT_MUSIC || '').trim();
  if (env) return env;
  return (await head(BED_PATH).then(() => true, () => false)) ? BED_PATH : null;
}

export type Draft = { path: string; style: string; at: string };
export async function listDrafts(): Promise<{ bed: boolean; drafts: Draft[] }> {
  const [bed, l] = await Promise.all([head(BED_PATH).then(() => true, () => false), list({ prefix: DRAFTS, limit: 40 }).catch(() => ({ blobs: [] as { pathname: string; uploadedAt: Date }[] }))]);
  const drafts = l.blobs.map((b) => ({ path: b.pathname, style: b.pathname.split('/').pop()!.split('-')[0], at: new Date(b.uploadedAt).toISOString() }))
    .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
  return { bed, drafts };
}

/** Compose two drafts in one style, side by side; each is saved as soon as it finishes. Waits up to ~4 minutes. */
export async function composeDrafts(style: string, by: string | null): Promise<{ saved: string[]; failed: string[]; cents: number }> {
  if (!runwayConfigured()) throw new Error('Runway is not connected (Genovus_Runway_API_Key in Vercel).');
  const s = SCORE_STYLES[style];
  if (!s) throw new Error('Pick a series style.');
  const before = await runwayOrganization().then((o) => o.creditBalance).catch(() => null);
  const prompt = `${s.prompt} ${UNDER_VOICE}`;
  const stamp = Date.now();
  const saved: string[] = [], failed: string[] = [];
  await Promise.all([0, 1].map(async (n) => {
    try {
      const { id } = await runwaySound({ prompt });
      let t = await runwayTask(id);
      for (let i = 0; i < 48 && !['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(t.status); i++) { await new Promise((r) => setTimeout(r, 5000)); t = await runwayTask(id); }
      if (t.status !== 'SUCCEEDED' || !t.output?.[0]) throw new Error(t.failure ?? `still ${t.status.toLowerCase()} after 4 minutes`);
      const audio = await fetch(t.output[0], { signal: AbortSignal.timeout(60_000) });
      if (!audio.ok) throw new Error(`the draft didn't download (${audio.status})`);
      const path = `${DRAFTS}${style}-${stamp}-${n + 1}.mp3`;
      await put(path, Buffer.from(await audio.arrayBuffer()), { access: 'private', contentType: 'audio/mpeg', addRandomSuffix: false, allowOverwrite: true });
      saved.push(path);
    } catch (e) { failed.push(e instanceof Error ? e.message : String(e)); }
  }));
  const after = await runwayOrganization().then((o) => o.creditBalance).catch(() => null);
  const cents = before != null && after != null ? Math.max(0, before - after) * CREDIT_CENTS : 0;
  if (cents > 0) await adminDb().from('expenses').insert({ spent_on: businessToday(), category: 'ai', vendor: 'Runway', amount_cents: cents, note: `Unedit: ${saved.length} music drafts (${s.label})`, created_by: by });
  return { saved, failed, cents };
}

/** Make a draft the bed every episode uses (a copy, so the draft list can be tidied without touching it). */
export async function useDraft(path: string, presign: (p: string) => Promise<string>): Promise<void> {
  if (!path.startsWith(DRAFTS) || !/^[A-Za-z0-9._/-]+\.mp3$/.test(path)) throw new Error('Pick one of the drafts.');
  const r = await fetch(await presign(path), { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`That draft didn't load (${r.status}).`);
  await put(BED_PATH, Buffer.from(await r.arrayBuffer()), { access: 'private', contentType: 'audio/mpeg', addRandomSuffix: false, allowOverwrite: true });
}
