// The StudioNext production board: one episode as a film's production one-sheet, built from the Studio's live data.
// Left, the world (the cast with identity locks, product accuracy, the tech spec); right, the film (every shot with
// its frame, timing, lines, camera, performance direction, engine and cost); below, the estimate, the timeline and
// the render. Every shot can be directed in place. Server component; edits go through audited Studio functions.
import Link from 'next/link';
import { ActionForm } from '@/components/ActionForm';
import { Chip } from '@/components/ui';
import { HelixAskButton } from '@/components/HelixDrawer';
import { studioSetShotDirection } from '@/lib/actions';
import { defaultDirection, engineFor, shotCast, shotCost, shotSeconds } from '@/lib/studio-board';

type Shot = { id: string; n: number; shot_code: string | null; timing: string | null; description: string; dialogue: string | null; tool: string; tier: string | null; status: string; beat: number | null; shot_kind: string | null; log: Record<string, string> | null };
type Character = { id: string; code: string; name: string; archetype: string; wardrobe: string | null; voice: { direction?: string; timing?: string } | null; profile: Record<string, string> | null };
type Take = { id: string; shot_id: string; status: string; chosen: boolean | null };
type Props = {
  episode: { id: string; code: string; title: string; kind: string; runtime_s: number | null; status: string; final_blob: string | null };
  shots: Shot[]; cast: Character[]; takes: Take[]; lockedRefs: Map<string, string>;
};

const ENGINE_BEATS = ['Hook', 'Lead', 'Diagnosis', 'Plan', 'Proof', 'Payoff', 'Close', 'Tag'];
const KIND: Record<string, string> = { teaser: 'Trailer', episode: 'Episode', proof: 'Proof' };
const SHEET: Record<string, string> = { MARCUS01: 'marcus', TASHA01: 'tasha', JULIAN01: 'julian' };
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
/** "[warm] Got questions?" → the bracketed direction tags styled. */
const Read = ({ text }: { text: string }) => <>{text.split(/(\[[^\]]+\])/g).map((part, i) => (/^\[.*\]$/.test(part) ? <i key={i}>{part}</i> : <span key={i}>{part}</span>))}</>;

export function ProductionBoard({ episode, shots, cast, takes, lockedRefs }: Props) {
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
          <span className="pb-chips"><Chip kind="info">{KIND[episode.kind] ?? episode.kind}</Chip><Chip kind="pending">{runtime}s</Chip><Chip kind="pending">{done}/{shots.length} shots ready</Chip><Chip kind={episode.final_blob ? 'done' : 'pending'}>{episode.final_blob ? 'Rendered' : episode.status}</Chip><Chip kind="info">Estimate {money(total)}</Chip></span>
        </div>
        <div className="pb-helix">
          <span className="pb-orb" aria-hidden="true" />
          <span><b>Direct with Helix</b><small>Talk the board through: Helix knows the bible, the cast and every shot here.</small></span>
          <HelixAskButton label="Direct with Helix" question="Walk me through this production board. What should we fix before we generate?" context={`the StudioNext production board for "${episode.title}"`} />
        </div>
      </div>

      <div className="pb-grid">
        <div className="pb-col">
          <div className="pb-panel">
            <div className="pb-lab"><b>Character reference</b><span>Cast V2 · identity locked</span></div>
            <div className="pb-cast">
              {inEpisode.map((c) => {
                const locked = lockedRefs.get(c.id);
                const img = locked ? `/api/studio/media/ref/${locked}` : SHEET[c.code] ? `/studio/cast/${SHEET[c.code]}.jpg` : null;
                return (
                  <Link key={c.code} href={`/console/studio/cast/${c.code}`} className="pb-member">
                    {img ? <img src={img} alt={`${c.name}, reference`} /> : <span className="cast-blank">{c.name[0]}</span>}
                    <b>{c.name}</b><span className="pb-role">{c.archetype}</span>
                    <dl><dt>Wardrobe</dt><dd>{c.wardrobe}</dd><dt>Voice</dt><dd>{c.voice?.timing ?? c.voice?.direction}</dd>{c.profile?.outside ? <><dt>Off duty</dt><dd>{c.profile.outside}</dd></> : null}</dl>
                  </Link>
                );
              })}
            </div>
            <p className="pb-lock">🔒 <b>Identity locked.</b> Every engine receives these exact references; face, complexion, hair, beard, glasses and build can’t drift.</p>
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
            <dl className="pb-kv"><dt>Format</dt><dd>16:9 master + 9:16 twin · 24 fps · 1080p</dd><dt>Length</dt><dd>{runtime} s</dd><dt>Video</dt><dd>{engines.join(' · ') || '—'}</dd><dt>Voice</dt><dd>ElevenLabs v4 with direction tags</dd><dt>Close</dt><dd>Julian to the lens · “Genovus Just Knows”</dd></dl>
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
                return (
                  <article key={s.id} className="pb-frame" id={`shot-${s.n}`}>
                    <span className="pb-n">{i + 1}</span>
                    <div className="pb-thumb">
                      {take ? <video src={`/api/studio/media/take/${take.id}#t=0.5`} muted playsInline preload="metadata" />
                        : s.tool === 'edit' ? <span className="pb-card">{s.description.replace(/^Title card:\s*/i, '')}</span>
                        : s.tool === 'capture' ? <span className="pb-screen"><i /><i /><i /><i /></span>
                        : who && SHEET[who] ? <img src={`/studio/cast/${SHEET[who]}.jpg`} alt="" /> : <span className="pb-card">Frame</span>}
                      <span className="pb-tc">{s.timing}</span>
                      <span className="pb-tag">{take ? 'Take ready' : s.tool === 'capture' ? 'Captured screen' : s.tool === 'edit' ? 'Code card' : 'Reference stand-in'}</span>
                    </div>
                    <div className="pb-meta">
                      <div className="pb-hd"><b>{s.beat && episode.kind === 'episode' ? `${ENGINE_BEATS[s.beat - 1]} · ` : ''}{s.description}</b><span>{shotSeconds(s.timing)} s</span></div>
                      {linesOf(s).map((l) => <p key={l} className="pb-line">{l}</p>)}
                      {s.log?.camera ? <span className="pb-cam">Camera · {s.log.camera}</span> : null}
                      {d.acting || d.read ? <div className="pb-perf"><span><b>Acting</b> · {d.acting || '—'}</span>{d.read ? <span className="pb-read"><Read text={d.read} /></span> : null}</div> : null}
                      <div className="pb-eng">
                        <Chip kind={s.tool === 'capture' || s.tool === 'edit' ? 'done' : 'info'}>{eng?.label ?? (s.tool === 'capture' ? 'Captured screen' : s.tool === 'edit' ? 'Code card' : s.tool)}</Chip>
                        {linesOf(s).length ? <Chip kind="info">ElevenLabs v4</Chip> : null}
                        <Chip kind={s.status === 'approved' ? 'done' : s.status === 'todo' ? 'pending' : 'info'}>{s.status}</Chip>
                        <span className="pb-cost">{money(costs[i].total)}</span>
                      </div>
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
                <tr><td>Keyframes (4 candidates per generated shot)</td><td>{money(sum('keyframes'))}</td></tr>
                <tr><td>Line reads (3 reads per line)</td><td>{money(sum('voice'))}</td></tr>
                <tr><td>Captures, code cards, render</td><td>$0.00</td></tr>
                <tr className="tot"><td>Estimate at Runway list prices</td><td>{money(total)}</td></tr>
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
        <p className="pb-note">{episode.final_blob ? <a href={`/api/studio/media/final/${episode.id}`}>Play the final render</a> : 'The in-platform render (16:9 and 9:16, captions, score and dialogue mix) arrives with the render worker; until then the final cut uploads in the engine room below.'}</p>
      </div>
    </section>
  );
}
