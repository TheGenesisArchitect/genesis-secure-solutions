// The canonical episode timeline (StudioNext v3): one derivation of what the episode is, read by the board's preview
// (the Screening Room), the export (lib/studio-render.ts) and validation. Nothing keeps its own copy, so a line edited
// on the board is the line that's voiced, captioned and exported.
//   Picture   the picked take (else the newest ready one), the shot's Screen Library clips, or a code card
//   Dialogue  the shot's current lines (direction read → parseRead) with the read picked for each, matched by text
//   Captions  the same lines, without the direction tags
//   Score     the newest ready score draft, under the whole episode
// Positions come from each shot's timing, so the timeline matches the board.
import 'server-only';
import { adminDb } from '@/lib/supabase/admin';
import { parseRead } from '@/lib/studio-read';
import { defaultDirection, shotSeconds } from '@/lib/studio-board';
import { V2_EPISODES } from '@/lib/studio-board';

export type CutFormat = 'wide' | 'vertical';
export type Caption = { t0: number; t1: number; who: string; text: string };
export type Voice = { src: string; at: number; clipId: string; lineSlot: string };
export type CutItem = {
  shotId: string;
  code: string;
  label: string;
  kind: 'video' | 'card';
  status: 'picked' | 'best' | 'draft' | 'missing' | 'card';
  src?: string;
  /** Library screens: more than one clip shares the shot's slot. */
  clips?: { src: string; dur: number }[];
  in: number;
  dur: number;
  start: number;
  card?: { style: 'helix' | 'end' | 'placeholder' | 'title' | 'packages'; title: string; body?: string };
  captions: Caption[];
  voice: Voice[];
  score?: number | null;
  speaking?: boolean;
};
export type Cut = { format: CutFormat; total: number; items: CutItem[]; music?: { src: string; clipId: string } | null; counts: { picked: number; drafts: number; missing: number; cards: number } };
export type Problem = { shot: string; label: string; kind: 'missing_picture' | 'missing_read' | 'stale_read' | 'screen_unresolved' | 'sync_unverified'; detail: string };

const startOf = (timing: string | null) => { const m = String(timing ?? '').match(/^(\d+):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const plain = (t: string) => t.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();

type ShotRow = { id: string; n: number; shot_code: string | null; tool: string; shot_kind: string | null; timing: string | null; description: string; log: Record<string, string> | null; screens: string[] | null; cast_codes: string[] | null; produce: Record<string, unknown> | null };
type TakeRow = { id: string; shot_id: string; status: string; chosen: boolean; court_score: number | null; params: Record<string, unknown> | null; created_at: string };
type ClipRow = { id: string; shot_id: string | null; slot: string; text: string; status: string; approved: boolean; kind: string; created_at: string };

/** Build the episode's timeline from the Studio's data. */
/** `only`: a Short, the listed shot numbers laid end to end (their own timings, not the master's positions). */
export async function buildTimeline(episodeId: string, format: CutFormat = 'wide', only?: number[]): Promise<Cut & { problems: Problem[] }> {
  const db = adminDb();
  const { data: ep } = await db.from('studio_episodes').select('code').eq('id', episodeId).single();
  const code = String(ep?.code ?? '');
  const [{ data: shotRows }, { data: castRows }, { data: screenRows }] = await Promise.all([
    db.from('studio_shots').select('id, n, shot_code, tool, shot_kind, timing, description, log, screens, cast_codes, produce').eq('episode_id', episodeId).order('n'),
    db.from('studio_characters').select('code, name').eq('status', 'active'),
    db.from('studio_screens').select('code, device, secs, clip_path').not('clip_path', 'is', null),
  ]);
  const shots = (shotRows ?? []) as ShotRow[];
  const ids = shots.map((s) => s.id);
  const [{ data: takeRows }, { data: clipRows }] = await Promise.all([
    db.from('studio_takes').select('id, shot_id, status, chosen, court_score, params, created_at').in('shot_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']).eq('status', 'ready'),
    db.from('studio_voice_clips').select('id, shot_id, slot, text, status, approved, kind, created_at').or(`shot_id.in.(${ids.join(',') || '00000000-0000-0000-0000-000000000000'}),kind.eq.score`).eq('status', 'ready').order('created_at', { ascending: false }),
  ]);
  const takes = (takeRows ?? []) as TakeRow[];
  const clips = (clipRows ?? []) as ClipRow[];
  const cast = (castRows ?? []) as { code: string; name: string }[];
  const library = new Map((screenRows ?? []).map((r) => [`${r.code}:${r.device}`, Number(r.secs ?? 8)]));
  const problems: Problem[] = [];
  const items: CutItem[] = [];
  let at = 0;
  for (const s of shots) {
    if (only && !only.includes(s.n)) continue;
    const label = `${shots.indexOf(s) + 1} · ${s.description.split(':')[0].slice(0, 48)}`;
    const dur = Math.max(1, shotSeconds(s.timing) || 3);
    const start = only ? at : (startOf(s.timing) ?? at);
    // Dialogue: the current lines, each with its picked read (or the newest read of that exact wording).
    const read = s.log?.read ?? defaultDirection(code, s.n)?.read ?? '';
    const lines = s.tool === 'edit' ? [] : parseRead(read, cast);
    const step = lines.length ? (dur - 0.6) / lines.length : 0;
    const voice: Voice[] = [];
    const captions: Caption[] = [];
    lines.forEach((l, i) => {
      const mine = clips.filter((c) => c.kind === 'line' && c.shot_id === s.id && c.slot === l.slot);
      const current = mine.filter((c) => c.text === l.text);
      const pick = current.find((c) => c.approved) ?? current[0];
      const t0 = 0.3 + i * step;
      captions.push({ t0, t1: Math.min(dur - 0.1, t0 + step), who: l.speaker, text: plain(l.text) });
      if (pick) voice.push({ src: `/api/studio/media/voice/${pick.id}`, at: t0, clipId: pick.id, lineSlot: l.slot });
      else problems.push({ shot: s.id, label, kind: mine.length ? 'stale_read' : 'missing_read', detail: mine.length ? `${l.speaker}'s read is for an older wording: “${plain(mine[0].text)}”` : `${l.speaker} has no read yet: “${plain(l.text)}”` });
    });
    const speaking = lines.some((l) => !l.vo && (s.cast_codes ?? []).includes(l.code));
    let item: CutItem;
    if (s.tool === 'edit') {
      const pkg = /^Package card:/i.test(s.description);
      const title = s.description.replace(/^(Title|Package) card:\s*/i, '').replace(/\.$/, '');
      item = { shotId: s.id, code: s.shot_code ?? '', label, kind: 'card', status: 'card', in: 0, dur, start, card: { style: pkg ? 'packages' : /end|close|tag/i.test(s.shot_kind ?? '') ? 'end' : 'title', title }, captions, voice };
    } else if (s.tool === 'capture' && (s.screens ?? []).length) {
      const keys = (s.screens ?? []).filter((k) => library.has(k));
      for (const k of (s.screens ?? []).filter((k) => !library.has(k))) problems.push({ shot: s.id, label, kind: 'screen_unresolved', detail: `${k} isn't in the Screen Library` });
      const each = keys.length ? dur / keys.length : dur;
      item = keys.length
        ? { shotId: s.id, code: s.shot_code ?? '', label, kind: 'video', status: 'picked', src: `/api/studio/library/${keys[0].replace(':', '/')}`, clips: keys.map((k) => ({ src: `/api/studio/library/${k.replace(':', '/')}`, dur: each })), in: 0, dur, start, captions, voice }
        : { shotId: s.id, code: s.shot_code ?? '', label, kind: 'card', status: 'missing', in: 0, dur, start, card: { style: 'placeholder', title: label, body: 'Pick a screen from the Screen Library' }, captions, voice };
    } else {
      const mine = takes.filter((t) => t.shot_id === s.id);
      const picked = mine.find((t) => t.chosen);
      const latest = [...mine].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      const take = picked ?? latest;
      if (!take) problems.push({ shot: s.id, label, kind: 'missing_picture', detail: 'No take yet' });
      // A speaking face needs verified lip-sync before the episode is final (audio-guided isn't verified).
      const verified = take && ((take.params as { lipsync?: boolean } | null)?.lipsync === true || (s.produce as { sync_verified?: string } | null)?.sync_verified === take.id);
      if (take && speaking && !verified) problems.push({ shot: s.id, label, kind: 'sync_unverified', detail: (take.params as { audio?: boolean } | null)?.audio ? 'Audio-guided: check the lips, then mark them verified' : 'Not lip-synced: finish the dialogue with Act-Two or mix it in the edit' });
      item = take
        ? { shotId: s.id, code: s.shot_code ?? '', label, kind: 'video', status: picked ? 'picked' : 'draft', src: `/api/studio/media/take/${take.id}`, in: 0, dur, start, captions, voice, score: take.court_score, speaking }
        : { shotId: s.id, code: s.shot_code ?? '', label, kind: 'card', status: 'missing', in: 0, dur, start, card: { style: 'placeholder', title: label, body: s.description }, captions, voice, speaking };
    }
    items.push(item);
    at = Math.max(at, start + dur);
  }
  const score = clips.find((c) => c.kind === 'score');
  return {
    format, total: at, items, music: score ? { src: `/api/studio/media/voice/${score.id}`, clipId: score.id } : null, problems,
    counts: { picked: items.filter((i) => i.status === 'picked').length, drafts: items.filter((i) => i.status === 'draft' || i.status === 'best').length, missing: items.filter((i) => i.status === 'missing').length, cards: items.filter((i) => i.status === 'card').length },
  };
}

/** Is the episode ready to export as final? Problems are listed by shot (missing media, stale or missing reads,
 *  unresolved screens, speaking shots whose lip-sync isn't verified). A draft export ignores sync verification. */
export function validateTimeline(t: { problems: Problem[] }, mode: 'final' | 'draft' = 'final'): Problem[] {
  return mode === 'final' ? t.problems : t.problems.filter((p) => p.kind !== 'sync_unverified' && p.kind !== 'missing_read');
}

/** V2 episodes use this timeline; archived V1 episodes keep their old rough cut. */
export const usesTimeline = (episodeCode: string) => V2_EPISODES.has(episodeCode);
