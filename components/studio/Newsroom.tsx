'use client';
// The Genovus Newsroom (app/console/studio/newsroom): the wire as a live ticker, then three sections: the story,
// watch and read, and the arsenal with one Produce. Every fact shows its status and the passage it came from; live
// research waits for approval; Produce builds only from approved facts (lib/newsroom.ts enforces it).
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FACELESS_VOICES, type FacelessState } from '@/lib/faceless-voices';

export type NrClaim = { id: string; text: string; status: string; attribution: string | null; denial: string | null; source_title: string | null; source_url: string; cited_text: string | null; verified: boolean; approved: boolean };
export type NrStory = { id: string; beat: string; sub: string | null; headline: string; source: string; url: string; published_on: string | null; thumb: string | null; why: string | null; fit: number | null; status: string; angles: { title: string; line: string }[]; chosen: number | null; build: string[]; voiced: boolean; created_at: string; claims: NrClaim[] };
export type NrProduction = { id: string; story_id: string; angle: string; formats: string[]; next_upload: boolean; vlog_id: string | null; cost: number; created_at: string; faceless: FacelessState | null;
  outputs: { script?: { part: string; lines: { say: string; source: string }[] }[]; teleprompter?: string; sheet?: string; sheetNotes?: string[]; broll?: { shot: string; why: string; kind: string }[]; article?: { title: string; markdown: string }; social?: { linkedin?: string; x?: string[]; newsletter?: string }; titles?: string[] } };
type Beat = { id: string; label: string; brief: string; subs?: string[] };

const toast = (r: { ok?: string; err?: string }) => window.dispatchEvent(new CustomEvent('genovus:toast', { detail: { ...r, at: Date.now() } }));
const ARSENAL: [string, string, string, boolean][] = [
  ['long', 'Long-form with you', 'Script, teleprompter, sources on screen', true],
  ['cut', '60 s cut', 'The story in a minute', true],
  ['clips', 'Question clips', 'Cut from your recording', true],
  ['article', 'Article and blog', 'Every fact linked to its source', true],
  ['social', 'LinkedIn and X', 'A post and a thread', true],
  ['newsletter', 'Newsletter', 'A short brief with the links', true],
  ['faceless', 'Faceless video', 'Coming in the record-and-make phase', false],
  ['screen', 'Screen-led explainer', 'Coming with the screen studio', false],
  ['carousel', 'Carousel', 'Coming in the record-and-make phase', false],
];
const STATUS_LABEL: Record<string, string> = { new: 'New', drafting: 'Drafting', in_studio: 'In studio', watching: 'Watching', background: 'Background' };
const TAG: Record<string, string> = { confirmed: 'Confirmed', reported: 'Reported', alleged: 'Alleged', opinion: 'Opinion', unsupported: 'Unsupported' };
const day = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');
/** Make it faceless: an original narrator voice reads the package over the Genovus moving background, and Unedit cuts
 *  it like any take (captions, sources on screen, labelled illustrations). Polls while it is being voiced. */
function Faceless({ prod, busy, send }: { prod: NrProduction; busy: string | null; send: (b: Record<string, unknown>, k: string) => Promise<boolean> }) {
  const router = useRouter();
  const [voice, setVoice] = useState<string>(prod.faceless?.voice ?? FACELESS_VOICES[0].id);
  const [length, setLength] = useState<'short' | 'full'>(prod.faceless?.length ?? 'short');
  const f = prod.faceless;
  const voicing = f?.status === 'voicing';
  useEffect(() => { if (!voicing) return; const t = setInterval(() => router.refresh(), 8000); return () => clearInterval(t); }, [voicing, router]);
  if (voicing) return <div className="nr-faceless"><span className="nr-label">Faceless</span><span className="nr-ok"><i className="nr-live" aria-hidden="true" /> Helix is voicing it with {f.voice} and building the video ({f.length === 'short' ? 'short' : 'full length'}). It opens in Unedit when it’s ready.</span></div>;
  return (
    <div className="nr-faceless">
      <span className="nr-label">Or make it faceless</span>
      <span className="muted nr-small">An original AI narrator reads {length === 'short' ? 'the opening and the call to action (about 75 seconds)' : 'the whole script'} over the Genovus moving background. Unedit cuts it with captions, your sources on screen and up to 6 labelled illustrations (80¢ each). Posts say the voice is AI.</span>
      <div className="nr-faceless-row">
        <label className="rc-field"><span>Voice</span><select value={voice} onChange={(e) => setVoice(e.target.value)} disabled={busy !== null}>{FACELESS_VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select></label>
        <span className="rc-modes" role="radiogroup" aria-label="Length">
          {(['short', 'full'] as const).map((l) => <button type="button" role="radio" aria-checked={length === l} key={l} className={length === l ? 'on' : ''} disabled={busy !== null} onClick={() => setLength(l)}>{l === 'short' ? 'Short · ~75 s' : 'Full script'}</button>)}
        </span>
        <button type="button" className="btn" disabled={busy !== null} onClick={() => send({ tool: 'faceless', production: prod.id, voice, length }, 'faceless')}>{busy === 'faceless' ? 'Starting…' : 'Make it faceless'}</button>
      </div>
      {f?.status === 'failed' ? <span className="ue-stop" role="alert">The last try didn’t finish: {f.error}. Try again.</span> : null}
    </div>
  );
}

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
/** When the publisher offers no picture (or refuses our preview), a designed tile: the beat's colour, the publisher's
 *  own icon and name, and the headline, so the wire still reads well on camera. */
function SourceTile({ s }: { s: Pick<NrStory, 'beat' | 'source' | 'url' | 'headline'> }) {
  const [icon, setIcon] = useState(true);
  const name = s.source.replace(/\s*\(.*$/, '').trim() || host(s.url);
  return (
    <span className={`nr-tile beat-${s.beat}`}>
      <span className="nr-tile-src">
        {icon ? <img src={`https://${host(s.url)}/favicon.ico`} alt="" referrerPolicy="no-referrer" onError={() => setIcon(false)} /> : <i>{name.slice(0, 1)}</i>}
        {name}
      </span>
      <span className="nr-tile-head">{s.headline}</span>
    </span>
  );
}

export function Newsroom({ stories, productions, beats, voice, spentToday, dailyCap }: { stories: NrStory[]; productions: NrProduction[]; beats: Beat[]; voice: string[]; spentToday: number; dailyCap: number }) {
  const router = useRouter();
  const [beat, setBeat] = useState<string>('all');
  const [sub, setSub] = useState<string>('All');
  const [pick, setPick] = useState<string | null>(stories[0]?.id ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [armed, setArmed] = useState<Record<string, boolean>>({ long: true, cut: true, clips: true, article: true, social: true });
  const [newPart, setNewPart] = useState('');
  const [tab, setTab] = useState('script');
  const [broken, setBroken] = useState<Record<string, boolean>>({});

  const beatOf = beats.find((b) => b.id === beat);
  const wire = useMemo(() => stories.filter((s) => (beat === 'all' || s.beat === beat) && (sub === 'All' || s.sub === sub)), [stories, beat, sub]);
  const story = stories.find((s) => s.id === pick) ?? wire[0] ?? stories[0] ?? null;
  const prod = story ? productions.find((p) => p.story_id === story.id) ?? null : null;
  const label = (id: string) => beats.find((b) => b.id === id)?.label ?? id;

  const send = async (body: Record<string, unknown>, key: string): Promise<boolean> => {
    setBusy(key);
    try {
      const r = await fetch('/api/studio/newsroom', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; say?: string; error?: string };
      toast(r.ok && j.ok ? { ok: j.say ?? 'Done.' } : { err: j.error ?? 'That didn’t work.' });
      return Boolean(r.ok && j.ok);
    } finally { setBusy(null); router.refresh(); }
  };
  const researchBeat = beat === 'all' ? beats[0]?.id : beat;
  const parts = story?.build.length ? story.build : [];
  const saveParts = (next: string[]) => story && send({ tool: 'set_build', story: story.id, parts: next }, 'parts');
  const loop = wire.length ? [...wire, ...wire, ...(wire.length < 4 ? [...wire, ...wire] : [])] : [];

  return (
    <div className="nr">
      <div className="nr-bar">
        <nav aria-label="Beats" className="nr-beats">
          <button type="button" className={beat === 'all' ? 'on' : ''} onClick={() => { setBeat('all'); setSub('All'); }}>All</button>
          {beats.map((b) => <button type="button" key={b.id} className={beat === b.id ? 'on' : ''} onClick={() => { setBeat(b.id); setSub('All'); }}>{b.label}</button>)}
        </nav>
        <span className="muted nr-spend">Today ${(spentToday / 100).toFixed(2)} of ${(dailyCap / 100).toFixed(2)}</span>
        <button type="button" className="btn primary" disabled={busy !== null || !researchBeat} onClick={() => send({ tool: 'research', beat: researchBeat, sub: sub !== 'All' ? sub : null }, 'research')}>
          {busy === 'research' ? `Helix is researching ${label(researchBeat!)}… about two minutes` : `Research ${label(researchBeat!)} now`}
        </button>
      </div>

      <section aria-label="The wire" className="nr-wire">
        <div className="nr-wire-head">
          <span className="nr-live" aria-hidden="true" />
          <span className="nr-label">The wire · {wire.length} {wire.length === 1 ? 'story' : 'stories'}</span>
          {beatOf?.subs?.length ? (
            <span className="nr-subs">{['All', ...beatOf.subs].map((u) => <button type="button" key={u} className={sub === u ? 'on' : ''} onClick={() => setSub(u)}>{u}</button>)}</span>
          ) : null}
          <span style={{ flex: 1 }} />
          {wire.length ? <><span className="muted nr-small">Hover to pause · click a story to open it</span><button type="button" className="btn small" onClick={() => setPaused(!paused)}>{paused ? 'Play' : 'Pause'}</button></> : null}
        </div>
        {wire.length ? (
          <div className="nr-window">
            <div className={`nr-track${paused ? ' paused' : ''}`}>
              {loop.map((s, i) => {
                const dup = i >= wire.length;
                return (
                  <button type="button" key={`${s.id}-${i}`} className={`nr-card${story?.id === s.id ? ' on' : ''}`} onClick={() => setPick(s.id)} aria-hidden={dup || undefined} tabIndex={dup ? -1 : 0}>
                    <span className="nr-thumb">
                      {s.thumb && !broken[s.id] ? <img src={s.thumb} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setBroken((b) => ({ ...b, [s.id]: true }))} /> : <SourceTile s={s} />}
                      <span className="nr-badge">{STATUS_LABEL[s.status] ?? s.status}</span>
                    </span>
                    <span className="nr-meta"><span>{label(s.beat)}{s.sub ? ` · ${s.sub}` : ''}</span><span>{s.source}{s.published_on ? ` · ${day(s.published_on)}` : ''}</span></span>
                    <b className="nr-head">{s.headline}</b>
                    {s.fit != null ? <span className="nr-fit">Fit for our audience <b>{s.fit}</b></span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="nr-empty">No stories on this {beat === 'all' ? 'desk' : 'beat'} yet. Press <b>Research {label(researchBeat ?? '')} now</b> and Helix searches the web live, files up to four stories, and shows where every fact comes from.</p>
        )}
      </section>

      {story ? (
        <div className="nr-cols">
          <main className="nr-col" aria-label="The story">
            <span className="nr-step">1 · The story · {label(story.beat)}{story.sub ? ` · ${story.sub}` : ''}</span>
            <h1 className="nr-title">{story.headline}</h1>
            {story.why ? <p className="nr-why">{story.why}</p> : null}
            <div className="nr-sec">
              <span className="nr-label">What we know · checked by the standards desk</span>
              {story.claims.map((c) => (
                <div key={c.id} className={`nr-claim${c.approved ? '' : ' wait'}`}>
                  <span className={`nr-tag ${c.status}`}>{TAG[c.status] ?? c.status}</span>
                  <div className="nr-claim-body">
                    <span>{c.text}{c.attribution ? <span className="muted"> · per {c.attribution}</span> : null}{c.denial ? <span className="muted"> · response: {c.denial}</span> : null}</span>
                    {c.cited_text ? <q className="nr-passage">{c.cited_text}</q> : null}
                    <span className="nr-src"><a href={c.source_url} target="_blank" rel="noopener noreferrer">{c.source_title || host(c.source_url)}</a>{c.verified ? <span className="nr-ok"> · passage verified</span> : <span className="muted"> · passage not matched yet</span>}</span>
                    {!c.approved ? (
                      <span className="nr-wait">Waiting for you: <button type="button" className="btn small primary" disabled={busy !== null} onClick={() => send({ tool: 'approve_claim', claim: c.id }, c.id)}>Approve</button> <button type="button" className="btn small" disabled={busy !== null} onClick={() => send({ tool: 'drop_claim', claim: c.id }, c.id)}>Take out</button></span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
            {story.angles.length ? (
              <div className="nr-sec">
                <span className="nr-label">Pick an angle · Helix drafted {story.angles.length}</span>
                {story.angles.map((a, i) => (
                  <button type="button" key={i} className={`nr-angle${(story.chosen ?? 0) === i ? ' on' : ''}`} disabled={busy !== null} onClick={() => send({ tool: 'set_angle', story: story.id, angle: i }, 'angle')}><b>{a.title}</b><span>{a.line}</span></button>
                ))}
              </div>
            ) : null}
            <div className="nr-helix">
              <span className="nr-label hot">Work the story with Helix · live research</span>
              <div className="nr-actions">
                <button type="button" className="btn small" disabled={busy !== null} onClick={() => send({ tool: 'deeper', story: story.id }, 'deeper')}>{busy === 'deeper' ? 'Researching…' : 'Research deeper, live'}</button>
                <button type="button" className="btn small" disabled={busy !== null} onClick={() => saveParts([...parts, 'Three things a founder can do this week'])}>Add: what to do this week</button>
                <button type="button" className="btn small" disabled={busy !== null || !parts.some((p) => /^policy/i.test(p))} onClick={() => saveParts(parts.filter((p) => !/^policy/i.test(p)))}>Take out the policy part</button>
                <button type="button" className={`btn small${story.voiced ? ' primary' : ''}`} disabled={busy !== null} onClick={() => send({ tool: 'voiced', story: story.id, on: !story.voiced }, 'voice')}>{story.voiced ? 'In your voice ✓' : 'Make it sound like me'}</button>
              </div>
              <span className="nr-label">The story, as Helix will build it</span>
              {parts.length ? parts.map((p, i) => (
                <div key={`${p}-${i}`} className="nr-part"><span className="muted">{i + 1}</span><span>{p}</span><button type="button" aria-label={`Take out ${p}`} disabled={busy !== null} onClick={() => saveParts(parts.filter((_, k) => k !== i))}>×</button></div>
              )) : <span className="muted nr-small">No parts set: Helix picks them (a hook, the story, why it matters, what to do, a call to action). Add your own below.</span>}
              <form className="nr-add" onSubmit={(e) => { e.preventDefault(); if (newPart.trim()) { saveParts([...parts, newPart.trim()]); setNewPart(''); } }}>
                <label htmlFor="nr-part" className="sr-only">Add a part to the story</label>
                <input id="nr-part" value={newPart} onChange={(e) => setNewPart(e.target.value)} placeholder="Add a part, e.g. “What this means for agencies”" />
                <button type="submit" className="btn small" disabled={busy !== null || !newPart.trim()}>Add</button>
              </form>
            </div>
          </main>

          <section className="nr-col" aria-label="Watch and read">
            <span className="nr-step">2 · Watch and read here</span>
            <div className="nr-reader">
              {story.thumb && !broken[story.id] ? <img src={story.thumb} alt="" referrerPolicy="no-referrer" onError={() => setBroken((b) => ({ ...b, [story.id]: true }))} /> : <span className="nr-reader-tile"><SourceTile s={story} /></span>}
              <span className="nr-label dark">Reader view · {story.source}{story.published_on ? ` · ${day(story.published_on)}` : ''}</span>
              <b className="nr-reader-title">{story.headline}</b>
              {story.claims.filter((c) => c.approved).map((c) => <span key={c.id} className="nr-reader-line">· {c.text} <i>({c.source_title || host(c.source_url)})</i></span>)}
              <span className="nr-small">Our summary of the approved facts. The full article stays on the publisher’s site.</span>
              <a href={story.url} target="_blank" rel="noopener noreferrer" className="nr-original">Open the original</a>
            </div>
            <p className="muted nr-small">Source videos will play here through each platform’s official player, and the screen studio records you walking through this story. Both arrive in later phases.</p>
            <div className="nr-sec">
              <span className="nr-label">Your voice · Helix writes in it</span>
              {voice.map((v) => <span key={v} className="nr-voice">· {v}</span>)}
            </div>
          </section>

          <aside className="nr-col" aria-label="Make it">
            <span className="nr-step">3 · Your arsenal · {Object.values(armed).filter(Boolean).length} armed</span>
            <div className="nr-arsenal">
              {ARSENAL.map(([k, name, what, ready]) => (
                <button type="button" key={k} className={`nr-weapon${armed[k] ? ' on' : ''}`} disabled={!ready} aria-pressed={Boolean(armed[k])} onClick={() => setArmed((a) => ({ ...a, [k]: !a[k] }))}><b>{name}</b><span>{what}</span></button>
              ))}
            </div>
            <button type="button" className="nr-produce" disabled={busy !== null || !story.claims.some((c) => c.approved)} onClick={() => send({ tool: 'produce', story: story.id, angle: story.chosen ?? 0, formats: Object.keys(armed).filter((k) => armed[k]), voiced: story.voiced }, 'produce')}>
              {busy === 'produce' ? 'Helix is producing… about a minute' : prod ? 'Produce again with Helix' : 'Produce with Helix'}
            </button>
            {prod ? (
              <div className="nr-prod">
                <div className="nr-tabs" role="tablist">
                  {[['script', 'Script'], ['tele', 'Teleprompter'], ['sheet', 'Sources sheet'], ['broll', 'B-roll'], ['article', 'Article'], ['social', 'Posts']].filter(([k]) => (k !== 'article' || prod.outputs.article) && (k !== 'social' || prod.outputs.social)).map(([k, l]) => (
                    <button type="button" role="tab" aria-selected={tab === k} key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
                  ))}
                </div>
                <div className="nr-out">
                  {tab === 'script' ? (prod.outputs.script ?? []).map((p, i) => <div key={i}><b>{p.part}</b>{p.lines.map((l, j) => <p key={j}>{l.say}{l.source ? <span className="nr-fact">{l.source}</span> : null}</p>)}</div>) : null}
                  {tab === 'tele' ? <pre>{prod.outputs.teleprompter}</pre> : null}
                  {tab === 'sheet' ? <><pre>{prod.outputs.sheet || 'No on-screen facts placed.'}</pre>{prod.outputs.sheetNotes?.length ? <p className="muted nr-small">{prod.outputs.sheetNotes.join('; ')}</p> : null}</> : null}
                  {tab === 'broll' ? (prod.outputs.broll ?? []).map((b, i) => <p key={i}><b>{b.shot}</b> <span className="muted">· {b.kind === 'illustration' ? 'illustration (labelled)' : b.kind === 'screen' ? 'screen' : 'you film it'} · {b.why}</span></p>) : null}
                  {tab === 'article' && prod.outputs.article ? <><b>{prod.outputs.article.title}</b><pre>{prod.outputs.article.markdown}</pre></> : null}
                  {tab === 'social' && prod.outputs.social ? <><b>LinkedIn</b><pre>{prod.outputs.social.linkedin}</pre><b>X thread</b><pre>{(prod.outputs.social.x ?? []).join('\n\n')}</pre><b>Newsletter</b><pre>{prod.outputs.social.newsletter}</pre></> : null}
                </div>
                {prod.vlog_id ? <a className="btn" href={`/console/studio/unedit/${prod.vlog_id}`}>Open the recording in Unedit</a>
                  : prod.next_upload ? <span className="nr-ok">Your next Unedit upload will be cut against this package.</span>
                  : <button type="button" className="btn primary" disabled={busy !== null} onClick={() => send({ tool: 'next_upload', production: prod.id }, 'next')}>Use for my next upload</button>}
                {!prod.vlog_id ? <Faceless prod={prod} busy={busy} send={send} /> : null}
                <span className="muted nr-small">Angle: {prod.angle} · {(prod.cost / 100).toFixed(2)} USD · {new Date(prod.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
              </div>
            ) : <p className="muted nr-small">Produce builds only from approved facts. Unedit places the sources sheet on your recording where you say each fact.</p>}
            <a className="btn" href={prod && !prod.vlog_id ? `/console/studio/unedit/record?p=${prod.id}` : '/console/studio/unedit/record'}>Record it now</a>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
