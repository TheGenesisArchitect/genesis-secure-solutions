// The StudioNext production board: one episode as a film's production one-sheet, built from the Studio's live data.
// Top, one production bar (one approval produces the episode; Helix does the same by voice). Left, the world (the
// cast with identity locks, product accuracy, the tech spec). Right, the storyboard: one card per shot with a large
// frame, its lines and direction, and only the decision it needs right now (review). The step-by-step controls and
// the direction form are folded away for fine-tuning. Below, the estimate, the timeline and the original score.
import Link from 'next/link';
import { ActionForm } from '@/components/ActionForm';
import { Chip } from '@/components/ui';
import { studioSetShotDirection } from '@/lib/actions';
import { billedSeconds, defaultDirection, engineFor, PRICE, shotCast, shotCost, shotSeconds } from '@/lib/studio-board';
import { CastStudio, ScoreStudio, ShotStudio, type BoardLine, type CaptureRecipe, type CastIdentity, type CastVoice } from '@/components/studio/BoardStudio';
import { ProductionBar, ShotReview, type RunState } from '@/components/studio/ProductionControls';
import { PlayButton, ScenePlayer, type Clip } from '@/components/studio/ScenePlayer';

type Shot = { capture?: CaptureRecipe | null; produce?: Record<string, string | number | null> | null; id: string; n: number; shot_code: string | null; timing: string | null; description: string; dialogue: string | null; tool: string; tier: string | null; status: string; beat: number | null; shot_kind: string | null; log: Record<string, string> | null };
type Character = { id: string; code: string; name: string; archetype: string; wardrobe: string | null; voice: { direction?: string; timing?: string; runway_voice?: string; runway_preset?: string; runway_engine?: string } | null; profile: Record<string, string> | null };
export type BoardStudioData = {
  ready: boolean;
  lines: Map<string, BoardLine[]>;
  frames: Map<string, { id: string; status: string; chosen: boolean; error: string | null }[]>;
  takes: Map<string, { id: string; status: string; chosen: boolean; kind: string; error: string | null; cost_cents: number; still?: boolean }[]>;
  identity: Map<string, CastIdentity & { img?: string }>;
  designs: Map<string, CastVoice['designs']>;
  score: { id: string; status: string; error: string | null }[];
  run: RunState;
  runCents: number;
};
type Take = { id: string; shot_id: string; status: string; chosen: boolean | null };
type Props = {
  episode: { id: string; code: string; title: string; kind: string; runtime_s: number | null; status: string; final_blob: string | null; logline?: string | null };
  shots: Shot[]; cast: Character[]; takes: Take[]; lockedRefs: Map<string, string>; studio: BoardStudioData;
};

const KIND: Record<string, string> = { teaser: 'Trailer', episode: 'Episode', proof: 'Proof' };
const SHEET: Record<string, string> = { MARCUS01: 'marcus', TASHA01: 'tasha', JULIAN01: 'julian' };
const STAGE: Record<string, [string, string]> = {
  queued: ['Queued', 'run'], reading: ['Reading lines…', 'run'], drawing: ['Drawing keyframe…', 'run'], rendering: ['Rendering take…', 'run'],
  review: ['Ready for review', 'review'], approved: ['Approved', 'ok'], capture: ['Phone capture', 'cap'], blocked: ['Blocked', 'stop'],
};
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
/** "[warm] Got questions?" → the bracketed direction tags styled. */
const Read = ({ text }: { text: string }) => <>{text.split(/(\[[^\]]+\])/g).map((part, i) => (/^\[.*\]$/.test(part) ? <i key={i}>{part}</i> : <span key={i}>{part}</span>))}</>;

export function ProductionBoard({ episode, shots, cast, takes, lockedRefs, studio }: Props) {
  const castCodes = [...new Set(shots.flatMap((s) => shotCast(episode.code, s.n)))];
  const inEpisode = cast.filter((c) => castCodes.includes(c.code));
  const linesOf = (s: Shot) => (s.dialogue ? s.dialogue.split(' / ').filter(Boolean) : []);
  const costs = shots.map((s) => shotCost(s, linesOf(s).length));
  const total = costs.reduce((a, c) => a + c.total, 0);
  const sum = (k: 'video' | 'keyframes' | 'voice') => costs.reduce((a, c) => a + c[k], 0);
  const runtime = Math.max(episode.runtime_s ?? 0, ...shots.map((s) => { const m = String(s.timing ?? '').match(/[–-]\s*(\d+):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; }));
  const startOf = (s: Shot) => { const m = String(s.timing ?? '').match(/^(\d+):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };
  const pct = (x: number) => `${((x / Math.max(1, runtime)) * 100).toFixed(2)}%`;
  const chosen = (shotId: string) => takes.find((t) => t.shot_id === shotId && t.chosen && t.status === 'ready') ?? takes.find((t) => t.shot_id === shotId && t.status === 'ready');
  const captures = shots.filter((s) => s.tool === 'capture' || s.tool === 'edit');
  const engines = [...new Set(shots.map((s) => engineFor(s.tool, s.tier)?.label).filter(Boolean))];
  const stageOf = (s: Shot) => String(s.produce?.stage ?? (s.status === 'approved' ? 'approved' : ''));
  const count = (...k: string[]) => shots.filter((s) => k.includes(stageOf(s))).length;
  const counts = { review: count('review'), approved: count('approved'), active: count('queued', 'reading', 'drawing', 'rendering'), capture: count('capture'), blocked: count('blocked'), total: shots.length };
  const locked = (c: Character) => ['locked', 'casting'].includes(studio.identity.get(c.id)?.state ?? '');
  const frameOf = (s: Shot) => (studio.frames.get(s.id) ?? []).find((f) => f.chosen && f.status === 'ready');
  const sceneOf = (s: Shot): Clip | null => {
    const t = chosen(s.id);
    if (!t || !['review', 'approved'].includes(stageOf(s)) || (studio.takes.get(s.id) ?? []).find((x) => x.id === t.id)?.still) return null;
    const f = frameOf(s);
    return { src: `/api/studio/media/take/${t.id}`, title: `${shots.indexOf(s) + 1} · ${s.description.split(':')[0]}`, poster: f ? `/api/studio/media/frame/${f.id}` : undefined };
  };
  const scenes = shots.map(sceneOf).filter((c): c is Clip => Boolean(c));
  const heroArt = (() => { const f = shots.map(frameOf).find(Boolean); return f ? `/api/studio/media/frame/${f.id}` : '/studio/cast/ensemble.jpg'; })();

  return (
    <section className="pb" aria-label="Production board">
      <ScenePlayer />
      <section className="sx-bill pb-hero" aria-label={`${episode.title}, production board`}>
        <img className="sx-bill-art" src={heroArt} alt="" />
        <div className="sx-bill-shade" aria-hidden="true" />
        <div className="sx-bill-copy">
          <span className="sx-eyebrow"><img src="/brand/genovus/genovus-egg.svg" alt="" />Genovus Originals · {KIND[episode.kind] ?? 'Episode'} · Production board</span>
          <h2>{episode.title}</h2>
          <span className="sx-meta"><b className={episode.final_blob ? 'ok' : 'soon'}>{episode.final_blob ? 'Final cut ready' : scenes.length ? `${scenes.length} of ${shots.length} scenes ready` : 'In production'}</b><span>{runtime}s</span><span>Marcus · Tasha · Julian</span><span>{counts.approved}/{shots.length} approved</span></span>
          {episode.logline ? <p>{episode.logline}</p> : null}
          <span className="sx-actions">
            {episode.final_blob ? <PlayButton label="Play the final cut" clips={[{ src: `/api/studio/media/final/${episode.id}`, title: episode.title }]} />
              : scenes.length ? <PlayButton label={scenes.length === 1 ? 'Play the first scene' : `Play the cut so far · ${scenes.length} scenes`} clips={scenes} />
              : <span className="sx-btn ghost-dim">▶ Scenes play here as they finish</span>}
            <Link className="sx-btn" href="/console/studio/cast">The cast</Link>
          </span>
        </div>
      </section>
      <ProductionBar episode={episode.code} run={studio.run} counts={counts} estimate={money(studio.runCents)} needsLock={!inEpisode.every(locked)} ready={studio.ready} />

      <div className="pb-layout">
        <aside className="pb-col">
          <div className="pb-panel">
            <div className="pb-lab"><b>Cast</b><span>{inEpisode.every(locked) ? '🔒 Identity locked' : 'Identity not locked'}</span></div>
            <div className="pb-cast">
              {inEpisode.map((c) => {
                const id = studio.identity.get(c.id) ?? { state: 'none' as const, label: 'No identity reference yet' };
                const lockedRef = lockedRefs.get(c.id);
                const img = lockedRef ? `/api/studio/media/ref/${lockedRef}` : id.img ?? (SHEET[c.code] ? `/studio/cast/${SHEET[c.code]}.jpg` : null);
                return (
                  <div key={c.code} className="pb-member">
                    <Link href={`/console/studio/cast/${c.code}`} className="pb-member-link">{img ? <img src={img} alt={`${c.name}, reference`} /> : <span className="cast-blank">{c.name[0]}</span>}</Link>
                    <div className="pb-member-info">
                      <b>{c.name}</b><span className="pb-role">{c.archetype}</span>
                      <span className={'bs-lock ' + id.state}>{locked(c) ? '🔒 Locked' : '○ Not locked'} · 🎙 {c.voice?.runway_engine === 'custom' ? 'Designed voice' : (c.voice?.runway_preset ?? c.voice?.runway_voice ?? 'Preset')}</span>
                      <details className="pb-more">
                        <summary>Profile, identity &amp; voice</summary>
                        <dl><dt>Wardrobe</dt><dd>{c.wardrobe}</dd><dt>Voice</dt><dd>{c.voice?.timing ?? c.voice?.direction}</dd>{c.profile?.outside ? <><dt>Off duty</dt><dd>{c.profile.outside}</dd></> : null}</dl>
                        <CastStudio character={c.id} name={c.name} identity={id} ready={studio.ready} cost={10} voice={{ engine: c.voice?.runway_engine === 'custom' ? 'custom' : 'preset', preset: c.voice?.runway_preset ?? c.voice?.runway_voice ?? 'Kiana', designs: studio.designs.get(c.id) ?? [] }} />
                      </details>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="pb-panel">
            <div className="pb-lab"><b>Product accuracy</b><span>Real screens only</span></div>
            <ul className="pb-acc">
              {captures.map((s) => <li key={s.id}><span>#{shots.indexOf(s) + 1} · {s.description.replace(/^Title card:\s*/i, 'Card: ')}</span><span className={s.status === 'take_ok' || s.status === 'approved' ? 'y' : 'need'}>{s.tool === 'edit' ? 'Code card' : s.status === 'take_ok' || s.status === 'approved' ? 'Captured ✓' : 'Capture needed'}</span></li>)}
            </ul>
          </div>

          <div className="pb-panel">
            <div className="pb-lab"><b>Tech spec</b><span>Engines</span></div>
            <dl className="pb-kv"><dt>Format</dt><dd>16:9 master + 9:16 twin · 24 fps · 1080p</dd><dt>Length</dt><dd>{runtime} s</dd><dt>Video</dt><dd>{engines.join(' · ') || '—'}</dd><dt>Voice</dt><dd>ElevenLabs v4 presets with direction tags, or designed voices</dd><dt>Score</dt><dd>Original, composed in the Studio</dd><dt>Close</dt><dd>Julian to the lens · “Genovus Just Knows”</dd></dl>
          </div>
        </aside>

        <div className="pb-panel pb-story">
          <div className="pb-lab"><b>Storyboard &amp; shot list</b><span>{shots.length} shots · {runtime} s</span></div>
          <div className="pb-cards">
            {shots.map((s, i) => {
              const d = { acting: s.log?.acting ?? defaultDirection(episode.code, s.n)?.acting ?? '', read: s.log?.read ?? defaultDirection(episode.code, s.n)?.read ?? '' };
              const eng = engineFor(s.tool, s.tier);
              const take = chosen(s.id);
              const who = shotCast(episode.code, s.n)[0];
              const still = take ? (studio.takes.get(s.id) ?? []).find((t) => t.id === take.id)?.still : false;
              const keyframe = (studio.frames.get(s.id) ?? []).find((f) => f.chosen && f.status === 'ready');
              const shotLines = studio.lines.get(s.id) ?? [];
              const stage = stageOf(s);
              const [stageLabel, stageKind] = STAGE[stage] ?? ['', ''];
              const note = (s.produce?.note ?? s.produce?.last_error ?? null) as string | null;
              return (
                <article key={s.id} className={'pb-card2' + (stage === 'review' ? ' is-review' : '')} id={`shot-${s.n}`}>
                  <figure className="pb-frame2">
                    {take ? (still ? <img src={`/api/studio/media/take/${take.id}`} alt="" /> : keyframe ? <img src={`/api/studio/media/frame/${keyframe.id}`} alt="" /> : <video src={`/api/studio/media/take/${take.id}#t=0.5`} muted playsInline preload="metadata" />)
                      : keyframe ? <img src={`/api/studio/media/frame/${keyframe.id}`} alt="" />
                      : s.tool === 'edit' ? <span className="pb-titlecard">{s.description.replace(/^Title card:\s*/i, '')}</span>
                      : s.tool === 'capture' ? <span className="pb-phone"><i /><i /><i /><i /><i /></span>
                      : who && SHEET[who] ? <img className="ref" src={`/studio/cast/${SHEET[who]}.jpg`} alt="" /> : <span className="pb-titlecard">Frame</span>}
                    {sceneOf(s) ? <PlayButton big clips={scenes} start={scenes.findIndex((c) => c.src === sceneOf(s)!.src)} /> : null}
                    <span className="pb-n2">{i + 1}</span>
                    <span className="pb-tc">{s.timing}</span>
                    {stageLabel ? <span className={'pb-stage ' + stageKind}>{stageLabel}</span> : <span className="pb-stage dim">{take ? 'Take' : keyframe ? 'Keyframe' : s.tool === 'capture' ? 'Real screen' : s.tool === 'edit' ? 'Code card' : 'Reference'}</span>}
                  </figure>
                  <div className="pb-body">
                    <div className="pb-hd"><b>{s.description}</b><span>{shotSeconds(s.timing)} s</span></div>
                    {d.read ? <p className="pb-read"><Read text={d.read} /></p> : null}
                    {d.acting ? <p className="pb-act"><b>Acting</b> {d.acting}{s.log?.camera ? <> · <b>Camera</b> {s.log.camera}</> : null}</p> : null}
                    {note && (stage === 'blocked' || stage === 'capture' || s.produce?.last_error) ? <p className="pb-flag">{note}</p> : null}
                    <div className="pb-foot">
                      <span className="pb-eng2">{eng?.label ?? (s.tool === 'capture' ? 'Phone capture' : s.tool === 'edit' ? 'Code card' : s.tool)} · {money(costs[i].total)}</span>
                      <ShotReview episode={episode.code} board={i + 1} stage={stage} />
                    </div>
                    <details className="pb-more">
                      <summary>{s.tool === 'capture' ? 'Capture steps, voice-over & direction' : 'Fine-tune: steps & direction'}</summary>
                      <ShotStudio shot={s.id} tool={s.tool} engine={eng?.label ?? null} ready={studio.ready} lines={s.tool === 'edit' ? [] : shotLines} frames={studio.frames.get(s.id) ?? []} takes={studio.takes.get(s.id) ?? []}
                        cost={{ line: shotLines.length * PRICE.lineRead, keyframes: 2 * PRICE.keyframe, take: eng ? billedSeconds(s.tier, s.timing) * eng.perSec : 0 }} takeSecs={billedSeconds(s.tier, s.timing)} capture={s.capture ?? null}
                        needsFrame={eng?.model === 'gen4.5' && !keyframe} />
                      <ActionForm action={studioSetShotDirection} className="form pb-direct">
                        <input type="hidden" name="id" value={s.id} />
                        <label className="field"><span>Acting note</span><input className="input" name="acting" defaultValue={d.acting} maxLength={300} /></label>
                        <label className="field"><span>Line read, with direction tags like [warm] [beat] [quiet]</span><textarea className="input" name="read" rows={2} defaultValue={d.read} maxLength={600} /></label>
                        <label className="field"><span>Camera</span><input className="input" name="camera" defaultValue={s.log?.camera ?? ''} maxLength={300} /></label>
                        <button className="btn small" type="submit" style={{ justifySelf: 'start' }}>Save direction</button>
                      </ActionForm>
                    </details>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="pb-est">
            <table>
              <tbody>
                <tr><td>Production run (one read per line, one keyframe and one take per shot)</td><td>{money(studio.runCents)}</td></tr>
                <tr><td>Full plan with alternates (2 takes, 2 keyframes, 2 reads)</td><td>{money(total + 40)}</td></tr>
                <tr><td className="muted">Takes {money(sum('video'))} · keyframes {money(sum('keyframes'))} · reads {money(sum('voice'))} · score $0.40</td><td></td></tr>
              </tbody>
            </table>
            <div className="pb-est-side"><Chip kind="done">Inside the $150 cap</Chip><small>Runway list prices; Runway’s final cost is recorded. Nothing spends until you approve.</small></div>
          </div>
        </div>
      </div>

      <div className="pb-panel">
        <div className="pb-lab"><b>Timeline &amp; render</b><span>{episode.final_blob ? 'Rendered' : 'Render after shots are approved'}</span></div>
        <div className="pb-tl">
          <div className="pb-track"><span>Picture</span><div className="pb-lane">{shots.map((s, i) => <span key={s.id} className={`pb-clip ${s.tool === 'capture' ? 'c' : s.tool === 'edit' ? 'k' : 'v'}${stageOf(s) === 'approved' ? ' ok' : ''}`} style={{ left: pct(startOf(s)), width: `calc(${pct(shotSeconds(s.timing))} - 2px)` }} title={s.description}>{i + 1}</span>)}</div></div>
          <div className="pb-track"><span>Dialogue</span><div className="pb-lane">{shots.filter((s) => linesOf(s).length).map((s) => <span key={s.id} className="pb-clip d" style={{ left: pct(startOf(s) + .3), width: `calc(${pct(Math.max(.5, shotSeconds(s.timing) - .6))} - 2px)` }} />)}</div></div>
          <div className="pb-track"><span>Score cues</span><div className="pb-lane">{shots.filter((s) => /\[(impact|sound design)\]|score enters/i.test(s.log?.read ?? defaultDirection(episode.code, s.n)?.read ?? '')).map((s) => <span key={s.id} className="pb-clip k" style={{ left: pct(startOf(s)), width: '18px' }} title={(s.log?.read ?? defaultDirection(episode.code, s.n)?.read) ?? ''}>♪</span>)}</div></div>
        </div>
        <p className="pb-note">{episode.final_blob ? <a href={`/api/studio/media/final/${episode.id}`}>Play the final render</a> : 'The in-platform render (16:9 and 9:16, captions, score and dialogue mix) arrives with the render worker; until then the final cut uploads in the engine room below.'}</p>
      </div>

      <div className="pb-panel">
        <div className="pb-lab"><b>Original score</b><span>Cue sheet</span></div>
        <ScoreStudio episode={episode.id} ready={studio.ready} cost={20} cues={studio.score} cue={`${runtime} seconds, cinematic action-dramedy trailer. Opens with near silence and a ticking clock under a buzzing phone; a hard drum hit on the first title card (0:04); tension pulses through the quick cuts; second drum hit and the main theme enters at 0:16, confident and warm with brass and modern percussion; heroic lift for each character reveal; a breath of silence before the punchline at 0:46; resolves warm and knowing under the close at 0:51.`} />
      </div>
    </section>
  );
}
