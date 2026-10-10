// SWIS™ auto rough cut: the episode's edit decision list, assembled from what the Studio already knows. Cast shots
// use the picked take (else the Court's best, else the latest draft) trimmed to the Court's usable window or the
// contract's own timing; screen-capture shots use the uploaded recording with Maya's voice-over clips; edit shots
// become cards (the Helix concept with its In development chip, the end card). The Screening Room plays it in the
// browser, so the cut updates the moment a take is picked; a rendered export comes later.
import 'server-only';
import { adminDb } from '@/lib/supabase/admin';
import type { ShotContract } from '@/lib/studio-direct';

export type CutFormat = 'wide' | 'vertical';
export type Caption = { t0: number; t1: number; who: string; text: string };
export type CutItem = {
  shotId: string;
  code: string;
  label: string;
  kind: 'video' | 'card';
  status: 'picked' | 'best' | 'draft' | 'missing' | 'card';
  src?: string;
  in: number;
  dur: number;
  start: number;
  card?: { style: 'helix' | 'end' | 'placeholder' | 'title'; title: string; body?: string };
  captions: Caption[];
  voice: { src: string; at: number }[];
  score?: number | null;
};
export type Cut = { format: CutFormat; total: number; items: CutItem[]; counts: { picked: number; drafts: number; missing: number; cards: number } };

type Shot = { id: string; n: number; shot_code: string | null; tool: string; shot_kind: string | null; timing: string | null; description: string; lines: { who: string; text: string }[] | null; contract: ShotContract | null };
type Take = { id: string; shot_id: string; kind: string; status: string; chosen: boolean; court_score: number | null; court_status: string | null; court: { usable?: { in: number; out: number } | null; hard_fails?: string[] } | null; created_at: string };

const NAME: Record<string, string> = { MAYA01: 'Maya', TRENT01: 'Trent', BRI01: 'Bri' };
const who = (code: string) => NAME[code] ?? code.replace(/\d+$/, '');
/** "0:14–0:24" → 10 seconds (the slot a non-generated shot fills). */
function slot(timing: string | null, fallback = 4): number {
  const m = timing?.match(/(\d+):(\d+)\s*[–-]\s*(\d+):(\d+)/);
  if (!m) return fallback;
  const d = (+m[3] * 60 + +m[4]) - (+m[1] * 60 + +m[2]);
  return d > 0 ? d : fallback;
}
const quoted = (s: string) => s.match(/"([^"]+)"/)?.[1] ?? null;

/** Captions for a cast shot: each spoken beat of the contract, placed relative to the cut's in point. */
function castCaptions(c: ShotContract, lines: Shot['lines'], cutIn: number, dur: number): Caption[] {
  const spoken = c.timeline.filter((b) => b.who);
  return spoken.map((b, i) => ({ t0: Math.max(0, b.t[0] - cutIn), t1: Math.min(dur, b.t[1] - cutIn), who: who(b.who!), text: lines?.[i]?.text ?? quoted(b.do) ?? '' }))
    .filter((x) => x.t1 > 0 && x.t0 < dur && x.text);
}

export async function buildCut(episodeId: string, format: CutFormat): Promise<Cut> {
  const db = adminDb();
  const [{ data: shotRows }, { data: takeRows }, { data: clips }] = await Promise.all([
    db.from('studio_shots').select('id, n, shot_code, tool, shot_kind, timing, description, lines, contract').eq('episode_id', episodeId).order('n'),
    db.from('studio_takes').select('id, shot_id, kind, status, chosen, court_score, court_status, court, created_at, studio_shots!inner(episode_id)').eq('studio_shots.episode_id', episodeId).eq('status', 'ready'),
    db.from('studio_voice_clips').select('id, shot_id, slot, status, created_at').eq('kind', 'line').eq('status', 'ready').order('created_at', { ascending: false }),
  ]);
  const shots = (shotRows ?? []) as Shot[];
  const takes = (takeRows ?? []) as unknown as Take[];
  const byCode = new Map(shots.map((s) => [s.shot_code ?? '', s]));
  // Widescreen shots drive the order; the vertical cut swaps in each shot's native 9:16 twin (code + "V") if any.
  const spine = shots.filter((s) => !(s.shot_code ?? '').endsWith('V'));
  const items: CutItem[] = [];
  let at = 0;
  for (const base of spine) {
    const s = format === 'vertical' ? byCode.get(`${base.shot_code}V`) ?? base : base;
    const label = s.shot_code?.replace(/^IN\d+_/, '') ?? `Shot ${s.n}`;
    const voiceFor = (i: number) => (clips ?? []).find((c) => c.shot_id === s.id && c.slot === `line-${i}`);
    let item: CutItem;
    if (s.tool === 'edit') {
      const dur = slot(s.timing, 3);
      const line = s.lines?.[0];
      item = {
        shotId: s.id, code: s.shot_code ?? '', label, kind: 'card', status: 'card', in: 0, dur, start: at,
        card: s.shot_kind === 'sting' ? { style: 'end', title: 'Genovus', body: 'Book your setup call' } : s.shot_kind === 'product' ? { style: 'helix', title: 'Helix draft', body: 'A reply to the Garcias, ready for one tap. Send.' } : { style: 'title', title: s.description },
        captions: line ? [{ t0: 0.2, t1: dur - 0.2, who: who(line.who), text: line.text }] : [],
        voice: s.lines?.map((_, i) => voiceFor(i)).filter(Boolean).map((v, i) => ({ src: `/api/studio/media/voice/${v!.id}`, at: 0.2 + i * 1.6 })) ?? [],
      };
    } else {
      const mine = takes.filter((t) => t.shot_id === s.id);
      const picked = mine.find((t) => t.chosen);
      const best = mine.filter((t) => t.court_status === 'scored' && !t.court?.hard_fails?.length).sort((a, b) => (b.court_score ?? 0) - (a.court_score ?? 0))[0];
      const latest = [...mine].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      const take = picked ?? best ?? latest;
      const status: CutItem['status'] = picked ? 'picked' : best ? 'best' : latest ? 'draft' : 'missing';
      if (s.contract?.timeline?.length) {
        const dur = s.contract.duration_s;
        const u = take?.court?.usable;
        const firstLine = s.contract.timeline.find((b) => b.who)?.t[0] ?? s.contract.timeline[0].t[0];
        const cutIn = u && u.out > u.in && u.in >= 0 && u.in < 8 ? Math.min(u.in, 8 - dur) : Math.max(0, Math.min(firstLine - 0.4, 8 - dur));
        item = {
          shotId: s.id, code: s.shot_code ?? '', label, kind: take ? 'video' : 'card', status, src: take ? `/api/studio/media/take/${take.id}` : undefined, in: Math.max(0, cutIn), dur, start: at, score: take?.court_score ?? null,
          card: take ? undefined : { style: 'placeholder', title: label, body: s.contract.function },
          captions: castCaptions(s.contract, s.lines, Math.max(0, cutIn), dur), voice: [],
        };
      } else {
        // A real screen capture: the recording from its start, with Maya's lines voiced over it.
        const dur = slot(s.timing, 6);
        const n = s.lines?.length ?? 0;
        const step = n ? (dur - 0.6) / n : 0;
        item = {
          shotId: s.id, code: s.shot_code ?? '', label, kind: take ? 'video' : 'card', status, src: take ? `/api/studio/media/take/${take.id}` : undefined, in: 0, dur, start: at,
          card: take ? undefined : { style: 'placeholder', title: `Screen: ${label}`, body: `${s.description} (upload the recording on this shot)` },
          captions: (s.lines ?? []).map((l, i) => ({ t0: 0.3 + i * step, t1: 0.3 + (i + 1) * step, who: who(l.who), text: l.text })),
          voice: (s.lines ?? []).map((_, i) => voiceFor(i)).map((v, i) => (v ? { src: `/api/studio/media/voice/${v.id}`, at: 0.3 + i * step } : null)).filter((x): x is { src: string; at: number } => Boolean(x)),
        };
      }
    }
    items.push(item);
    at += item.dur;
  }
  return {
    format, total: at, items,
    counts: { picked: items.filter((i) => i.status === 'picked').length, drafts: items.filter((i) => i.status === 'best' || i.status === 'draft').length, missing: items.filter((i) => i.status === 'missing').length, cards: items.filter((i) => i.status === 'card').length },
  };
}
