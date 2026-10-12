// The StudioNext production board: one episode as a film's production one-sheet, built from the Studio's live data.
// Left, the world (the cast with identity locks, product accuracy, the tech spec); right, the film (every shot with
// its frame, timing, lines, camera, performance direction, engine and cost); below, the estimate, the timeline and
// the render. Every shot can be directed in place. Server component; edits go through audited Studio functions.
import Link from 'next/link';
import { ActionForm } from '@/components/ActionForm';
import { Chip } from '@/components/ui';
import { studioSetShotDirection } from '@/lib/actions';
import { billedSeconds, defaultDirection, engineFor, PRICE, shotCast, shotCost, shotSeconds } from '@/lib/studio-board';
import { CastStudio, ScoreStudio, ShotStudio, type BoardLine, type CaptureRecipe, type CastIdentity, type CastVoice } from '@/components/studio/BoardStudio';

type Shot = { capture?: CaptureRecipe | null; id: string; n: number; shot_code: string | null; timing: string | null; description: string; dialogue: string | null; tool: string; tier: string | null; status: string; beat: number | null; shot_kind: string | null; log: Record<string, string> | null };
type Character = { id: string; code: string; name: string; archetype: string; wardrobe: string | null; voice: { direction?: string; timing?: string; runway_voice?: string; runway_preset?: string; runway_engine?: string } | null; profile: Record<string, string> | null };
export type BoardStudioData = {
  ready: boolean;
  lines: Map<string, BoardLine[]>;
  frames: Map<string, { id: string; status: string; chosen: boolean; error: string | null }[]>;
  takes: Map<string, { id: string; status: string; chosen: boolean; kind: string; error: string | null; cost_cents: number; still?: boolean }[]>;
  identity: Map<string, CastIdentity & { img?: string }>;
  designs: Map<string, CastVoice['designs']>;
  score: { id: string; status: string; error: string | null }[];
};
type Take = { id: string; shot_id: string; status: string; chosen: boolean | null };
type Props = {
  episode: { id: string; code: string; title: string; kind: string; runtime_s: number | null; status: string; final_blob: string | null };
  shots: Shot[]; cast: Character[]; takes: Take[]; lockedRefs: Map<string, string>; studio: BoardStudioData;
};

const ENGINE_BEATS = ['Hook', 'Lead', 'Diagnosis', 'Plan', 'Proof', 'Payoff', 'Close', 'Tag'];
const KIND: Record<string, string> = { teaser: 'Trailer', episode: 'Episode', proof: 'Proof' };
const SHEET: Record<string, string> = { MARCUS01: 'marcus', TASHA01: 'tasha', JULIAN01: 'julian' };
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
  const done = shots.filter((s) => s.status === 'take_ok' || s.status === 'approved').length;
  const captures = shots.filter((s) => s.tool === 'capture' || s.tool === 'edit');
  const engines = [...new Set(shots.map((s) => engineFor(s.tool, s.tier)?.label).filter(Boolean))];

  return (
    <section className="pb" aria-label="Production board">
      <div className="pb-top">
        <div className="pb-title">
          <span className="pb-eyebrow"><img src="/brand/genovus/genovus-egg.svg" alt="" />StudioNext · Production board</span>
          <span className="pb-chips"><Chip kind="info">{KIND[episode.kind] ?? episode.kind}</Chip><Chip kind="pending">{runtime}s</Chip><Chip kind="pending">{done}/{shots.length} shots ready</Chip><Chip kind={episode.final_blob ? 'done' : 'pending'}>{episode.final_blob ? 'Rendered' : episode.status}</Chip><Chip kind="info">Estimate {money(total + 40)}</Chip></span>
        </div>
      </div>

      <div className="pb-grid">
        <div className="pb-col">
          <div className="pb-panel">
            <div className="pb-lab"><b>Character reference</b><span>Cast V2 · identity locked</span></div>
            <div className="pb-cast">
              {inEpisode.map((c) => {
                const locked = lockedRefs.get(c.id);
                const id = studio.identity.get(c.id) ?? { state: 'none' as const, label: 'No identity reference yet' };
                const img = locked ? `/api/studio/media/ref/${locked}` : id.img ?? (SHEET[c.code] ? `/studio/cast/${SHEET[c.code]}.jpg` : null);
                return (
                  <div key={c.code} className="pb-member">
                    <Link href={`/console/studio/cast/${c.code}`} className="pb-member-link">{img ? <img src={img} alt={`${c.name}, reference`} /> : <span className="cast-blank">{c.name[0]}</span>}</Link>
                    <b>{c.name}</b><span className="pb-role">{c.archetype}</span>
                    <dl><dt>Wardrobe</dt><dd>{c.wardrobe}</dd><dt>Voice</dt><dd>{c.voice?.timing ?? c.voice?.direction}</dd>{c.profile?.outside ? <><dt>Off duty</dt><dd>{c.profile.outside}</dd></> : null}</dl>
                    <CastStudio character={c.id} name={c.name} identity={id} ready={studio.ready} cost={10} voice={{ engine: c.voice?.runway_engine === 'custom' ? 'custom' : 'preset', preset: c.voice?.runway_preset ?? c.voice?.runway_voice ?? 'Kiana', designs: studio.designs.get(c.id) ?? [] }} />
                  </div>
                );
              })}
            </div>
            {inEpisode.every((c) => ['locked', 'casting'].includes(studio.identity.get(c.id)?.state ?? ''))
              ? <p className="pb-lock">🔒 <b>Identity locked.</b> Every engine receives these exact references; face, complexion, hair, beard, glasses and build can’t drift.</p>
              : <p className="pb-lock off">○ <b>Identity not locked yet.</b> Put each cast member’s official sheet on file and approve it; keyframes and takes wait for the lock.</p>}
          </div>

          <div className="pb-panel">
            <div className="pb-lab"><b>Product accuracy</b><span>Real screens and code cards only</span></div>
            <ul className="pb-acc">
              {captures.map((s) => <li key={s.id}><span>#{s.n} · {s.description}</span><span className={s.status === 'take_ok' || s.status === 'approved' ? 'y' : 'need'}>{s.tool === 'edit' ? 'Code card' : s.status === 'take_ok' || s.status === 'approved' ? 'Captured ✓' : 'Capture needed'}</span></li>)}
            </ul>
            <p className="pb-note">One problem, one visible workflow, one result. Exact captured labels; no generated interface.</p>
          </div>

          <div className="pb-panel">
            <div className="pb-lab"><b>Tech spec</b><span>Engines</span></div>
            <dl className="pb-kv"><dt>Format</dt><dd>16:9 master + 9:16 twin · 24 fps · 1080p</dd><dt>Length</dt><dd>{runtime} s</dd><dt>Video</dt><dd>{engines.join(' · ') || '—'}</dd><dt>Voice</dt><dd>ElevenLabs v4 presets with direction tags, or each character’s designed voice</dd><dt>Score</dt><dd>Original, composed in the Studio</dd><dt>Close</dt><dd>Julian to the lens · “Genovus Just Knows”</dd></dl>
          </div>
        </div>

        <div className="pb-col">
          <div className="pb-panel">
            <div className="pb-lab"><b>Storyboard &amp; shot list</b><span>{shots.length} shots · {runtime} s</span></div>
            <div className="pb-frames">
              {shots.map((s, i) => {
                const d = { acting: s.log?.acting ?? defaultDirection(episode.code, s.n)?.acting ?? '', read: s.log?.read ?? defaultDirection(episode.code, s.n)?.read ?? '' };
                const eng = engineFor(s.tool, s.tier);
                const take = chosen(s.id);
                const who = shotCast(episode.code, s.n)[0];
                const still = take ? (studio.takes.get(s.id) ?? []).find((t) => t.id === take.id)?.still : false;
                const keyframe = (studio.frames.get(s.id) ?? []).find((f) => f.chosen && f.status === 'ready');
                const shotLines = studio.lines.get(s.id) ?? [];
                return (
                  <article key={s.id} className="pb-frame" id={`shot-${s.n}`}>
                    <span className="pb-n">{i + 1}</span>
                    <div className="pb-thumb">
                      {take ? (still ? <img src={`/api/studio/media/take/${take.id}`} alt="" /> : <video src={`/api/studio/media/take/${take.id}#t=0.5`} muted playsInline preload="metadata" />)
                        : keyframe ? <img src={`/api/studio/media/frame/${keyframe.id}`} alt="" />
                        : s.tool === 'edit' ? <span className="pb-card">{s.description.replace(/^Title card:\s*/i, '')}</span>
                        : s.tool === 'capture' ? <span className="pb-screen"><i /><i /><i /><i /></span>
                        : who && SHEET[who] ? <img src={`/studio/cast/${SHEET[who]}.jpg`} alt="" /> : <span className="pb-card">Frame</span>}
                      <span className="pb-tc">{s.timing}</span>
                      <span className="pb-tag">{take ? 'Take ready' : keyframe ? 'Keyframe' : s.tool === 'capture' ? 'Captured screen' : s.tool === 'edit' ? 'Code card' : 'Reference stand-in'}</span>
                    </div>
                    <div className="pb-meta">
                      <div className="pb-hd"><b>{s.beat && episode.kind === 'episode' ? `${ENGINE_BEATS[s.beat - 1]} · ` : ''}{s.description}</b><span>{shotSeconds(s.timing)} s</span></div>
                      {linesOf(s).map((l) => <p key={l} className="pb-line">{l}</p>)}
                      {s.log?.camera ? <span className="pb-cam">Camera · {s.log.camera}</span> : null}
                      {d.acting || d.read ? <div className="pb-perf"><span><b>Acting</b> · {d.acting || '—'}</span>{d.read ? <span className="pb-read"><Read text={d.read} /></span> : null}</div> : null}
                      <div className="pb-eng">
                        <Chip kind={s.tool === 'capture' || s.tool === 'edit' ? 'done' : 'info'}>{eng?.label ?? (s.tool === 'capture' ? 'Captured screen' : s.tool === 'edit' ? 'Code card' : s.tool)}</Chip>
                        {shotLines.length && eng ? <Chip kind="info">Voice · {shotLines.length} line{shotLines.length === 1 ? '' : 's'}</Chip> : null}
                        <Chip kind={s.status === 'approved' ? 'done' : s.status === 'todo' ? 'pending' : 'info'}>{s.status}</Chip>
                        <span className="pb-cost">{money(costs[i].total)}</span>
                      </div>
                      <ShotStudio shot={s.id} tool={s.tool} engine={eng?.label ?? null} ready={studio.ready} lines={s.tool === 'edit' ? [] : shotLines} frames={studio.frames.get(s.id) ?? []} takes={studio.takes.get(s.id) ?? []}
                        cost={{ line: shotLines.length * PRICE.lineRead, keyframes: 2 * PRICE.keyframe, take: eng ? billedSeconds(s.tier, s.timing) * eng.perSec : 0 }} takeSecs={billedSeconds(s.tier, s.timing)} capture={s.capture ?? null}
                        needsFrame={eng?.model === 'gen4.5' && !keyframe} />
                      <details className="pb-direct">
                        <summary>Direct this shot</summary>
                        <ActionForm action={studioSetShotDirection} className="form">
                          <input type="hidden" name="id" value={s.id} />
                          <label className="field"><span>Acting note</span><input className="input" name="acting" defaultValue={d.acting} maxLength={300} /></label>
                          <label className="field"><span>Line read, with direction tags like [warm] [beat] [quiet]</span><textarea className="input" name="read" rows={2} defaultValue={d.read} maxLength={600} /></label>
                          <label className="field"><span>Camera</span><input className="input" name="camera" defaultValue={s.log?.camera ?? ''} maxLength={300} /></label>
                          <button className="btn small primary" type="submit" style={{ justifySelf: 'start' }}>Save direction</button>
                        </ActionForm>
                      </details>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>

          <div className="pb-est">
            <table>
              <tbody>
                <tr><td>Takes (Seedance 2.5 hero, Gen-4.5 production · 2 takes each)</td><td>{money(sum('video'))}</td></tr>
                <tr><td>Keyframes (2 candidates per generated shot)</td><td>{money(sum('keyframes'))}</td></tr>
                <tr><td>Line reads (2 reads per line)</td><td>{money(sum('voice'))}</td></tr>
                <tr><td>Score (2 drafts)</td><td>{money(40)}</td></tr>
                <tr><td>Captures, code cards, render</td><td>$0.00</td></tr>
                <tr className="tot"><td>Estimate at Runway list prices</td><td>{money(total + 40)}</td></tr>
              </tbody>
            </table>
            <div className="pb-est-side"><Chip kind="done">Inside the $150 cap</Chip><small>Runway’s published “from” rates. Nothing generates until you approve it.</small></div>
          </div>
        </div>
      </div>

      <div className="pb-panel">
        <div className="pb-lab"><b>Timeline &amp; render</b><span>{episode.final_blob ? 'Rendered' : 'Render after takes are picked'}</span></div>
        <div className="pb-tl">
          <div className="pb-track"><span>Picture</span><div className="pb-lane">{shots.map((s) => <span key={s.id} className={`pb-clip ${s.tool === 'capture' ? 'c' : s.tool === 'edit' ? 'k' : 'v'}`} style={{ left: pct(startOf(s)), width: `calc(${pct(shotSeconds(s.timing))} - 2px)` }} title={s.description}>{s.n}</span>)}</div></div>
          <div className="pb-track"><span>Dialogue</span><div className="pb-lane">{shots.filter((s) => linesOf(s).length).map((s) => <span key={s.id} className="pb-clip d" style={{ left: pct(startOf(s) + .3), width: `calc(${pct(Math.max(.5, shotSeconds(s.timing) - .6))} - 2px)` }} />)}</div></div>
        </div>
        <div className="pb-track"><span>Score cues</span><div className="pb-lane">{shots.filter((s) => /\[(impact|sound design)\]|score enters/i.test(s.log?.read ?? defaultDirection(episode.code, s.n)?.read ?? '')).map((s) => <span key={s.id} className="pb-clip k" style={{ left: pct(startOf(s)), width: '18px' }} title={(s.log?.read ?? defaultDirection(episode.code, s.n)?.read) ?? ''}>♪</span>)}</div></div>
        <p className="pb-note">{episode.final_blob ? <a href={`/api/studio/media/final/${episode.id}`}>Play the final render</a> : 'The in-platform render (16:9 and 9:16, captions, score and dialogue mix) arrives with the render worker; until then the final cut uploads in the engine room below.'}</p>
      </div>

      <div className="pb-panel">
        <div className="pb-lab"><b>Original score</b><span>Cue sheet</span></div>
        <ScoreStudio episode={episode.id} ready={studio.ready} cost={20} cues={studio.score} cue={`${runtime} seconds, cinematic action-dramedy trailer. Opens with near silence and a ticking clock under a buzzing phone; a hard drum hit on the first title card (0:04); tension pulses through the quick cuts; second drum hit and the main theme enters at 0:16, confident and warm with brass and modern percussion; heroic lift for each character reveal; a breath of silence before the punchline at 0:46; resolves warm and knowing under the close at 0:51.`} />
      </div>
    </section>
  );
}
