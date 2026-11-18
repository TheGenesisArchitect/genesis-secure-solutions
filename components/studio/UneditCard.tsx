'use client';
// The Unedit card: the whole campaign from one take, on one screen. While Unedit works, the stages tick by (and the
// card refreshes itself); a stopped step shows its real error with Retry. Then: the full video with its title and
// three thumbnails, every clip with Approve, Redo (with a note) or Leave out, and one Approve for the campaign. After
// it, each post's state in Metricool, with its live link when it's up.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PostPlan, type Planning } from '@/components/studio/PostPlan';

export type CardClip = { id: string; n: number; title: string; caption: string; secs: number | null; hook: boolean; status: string; note: string | null; error: string | null; src: string | null; /** the master, when src is the light review copy */ full?: string | null; /** the vertical cover the posts carry */ cover?: string | null; copy: { instagram?: string; facebook?: string; youtube?: string }; start: number; end: number };
export type CardPost = { id: string; platform: string; kind: string; title: string | null; clip: number | null; status: string; mc_status: string | null; mc_error: string | null; posted_url: string | null; scheduled_at?: string | null };
/** The show packages (data/unedit-stylebook.ts), as the card offers them. */
const SHOW_PACKAGES = [
  { id: 'signature', label: 'Genovus Signature (mix)' }, { id: 'keynote', label: 'Keynote' }, { id: 'documentary', label: 'Documentary' },
  { id: 'kinetic', label: 'Agency kinetic' }, { id: 'classic', label: 'Classic' },
];
export type CardVlog = { id: string; title: string; stage: string; error: string | null; provider: string | null; words: number | null; duration: number | null; bytes: number; cost: number; source: string | null; /** the master, when source is the light review copy */ sourceFull?: string | null; polish: { secs: number; removed: number; ready: boolean; error: string | null; parts: number; done: number; gaps?: string[]; cuts: Record<string, number>; graphics: number; graphicsError: string | null; chapters: boolean; pkg: string | null; qa: { ok: boolean; issues: string[]; fixed: number } | null; newsNotes?: string[] } | null; episode: { title?: string; description?: string; dropped?: string[] }; thumbs: { src: string; text: string; look: string }[]; thumbPick: number | null; live: boolean; approvedAt: string | null;
  /** Newsroom: the approved sources sheet as text (lib/unedit-news.ts format). */ sources?: string };

/** A player that keeps its link while it shows the same file. The card refreshes itself (every 20 s, every 4 s while
 *  something renders) and every refresh signs a fresh link to the same video; a changed src makes the browser drop its
 *  buffer and load the video again, which is what made review stutter and buffer. Only a different file swaps it. */
function StableVideo({ src }: { src: string }) {
  const [held, setHeld] = useState(src);
  const file = (u: string) => u.split('?')[0];
  useEffect(() => { if (file(src) !== file(held)) setHeld(src); }, [src, held]);
  // A held link that expired (a card left open for hours) takes the newest one.
  return <video src={held} controls playsInline preload="metadata" onError={() => { if (held !== src) setHeld(src); }} />;
}

const toast = (r: { ok?: string; err?: string }) => window.dispatchEvent(new CustomEvent('genovus:toast', { detail: { ...r, at: Date.now() } }));

/** The full video to YouTube on its own (the clips go when you approve them): a two-tap post, then its live link. */
function LongForm({ posts, ready, busy, onPost }: { posts: CardPost[]; ready: boolean; busy: boolean; onPost: () => void }) {
  const [sure, setSure] = useState(false);
  const p = posts.find((x) => x.platform === 'youtube' && x.kind === 'video' && ['sent', 'posted'].includes(x.status));
  if (p?.status === 'posted') return <p className="ue-lf"><b>Live on YouTube</b> {p.posted_url ? <a href={p.posted_url} target="_blank" rel="noreferrer">Watch ↗</a> : null}{p.mc_error && /thumbnail/i.test(p.mc_error) ? <span className="muted"> · YouTube refused the custom thumbnail (verify the channel's phone number in YouTube Studio to allow custom thumbnails)</span> : null}</p>;
  if (p) return <p className="ue-lf"><b>On its way to YouTube</b> <span className="muted">· {p.mc_status === 'DRAFT' ? 'saved as a draft in Metricool' : 'publishing; the link appears here when it is live'}</span></p>;
  return (
    <div className="ue-lf">
      <button type="button" className={sure ? 'btn primary' : 'btn'} disabled={!ready || busy} onClick={() => { if (sure) { setSure(false); onPost(); } else setSure(true); }}>
        {busy ? 'Posting…' : sure ? 'Tap again to post the full video to YouTube' : 'Post the full video to YouTube'}
      </button>
      <span className="muted ue-small">{ready ? 'With this title, description, chapters and the picked thumbnail. The clips post when you approve them below.' : 'Ready once the polished episode finishes.'}</span>
    </div>
  );
}
const STEPS: [string, string][] = [['uploaded', 'Uploaded'], ['transcribing', 'Transcribed'], ['finding', 'Moments found'], ['rendering', 'Clips cut'], ['review', 'Your review'], ['publishing', 'Sent']];
const ORDER = ['uploaded', 'transcribing', 'finding', 'rendering', 'review', 'publishing', 'published'];
const NET: Record<string, string> = { instagram: 'Instagram Reel', facebook: 'Facebook Reel', youtube: 'YouTube', tiktok: 'TikTok', twitter: 'X', linkedin: 'LinkedIn' };
const calAt = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
// "0:15 tightened: 1 camera command, 6 uh/um, 3 long pauses, walk-off"
function polishSummary(p: { removed: number; cuts: Record<string, number> }): string {
  const n = (k: string, one: string, many = `${one}s`) => (p.cuts[k] ? `${p.cuts[k]} ${p.cuts[k] === 1 ? one : many}` : '');
  const bits = [n('command', 'camera command'), n('filler', 'uh/um', 'uh/ums'), n('false start', 'false start'), n('stutter', 'repeat'), n('tic', 'verbal tic'), n('pause', 'long pause'), p.cuts.head ? 'walk-up' : '', p.cuts.tail ? 'walk-off' : ''].filter(Boolean);
  return `${mmss(p.removed)} tightened${bits.length ? ` (${bits.join(', ')})` : ''}`;
}
const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export function UneditCard({ vlog, clips, posts, planning }: { vlog: CardVlog; clips: CardClip[]; posts: CardPost[]; planning?: Planning }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [redo, setRedo] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const working = !vlog.error && ['uploaded', 'transcribing', 'finding', 'rendering', 'publishing'].includes(vlog.stage);

  useEffect(() => {
    if (!working && !posts.some((p) => p.status === 'sent')) return;
    const t = setInterval(() => router.refresh(), working ? 4000 : 20000);
    return () => clearInterval(t);
  }, [working, posts, router]);

  const send = async (body: Record<string, unknown>, key: string) => {
    setBusy(key);
    try {
      const r = await fetch('/api/studio/unedit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: vlog.id, ...body }) });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; say?: string; error?: string };
      toast(r.ok && j.ok ? { ok: j.say ?? 'Done.' } : { err: j.error ?? 'That didn’t work.' });
    } finally { setBusy(null); router.refresh(); }
  };

  const at = ORDER.indexOf(vlog.stage);
  const review = vlog.stage === 'review';

  return (
    <div className="ue-card">
      <ol className="ue-steps" aria-label="Progress">
        {STEPS.map(([k, label], i) => {
          const done = at > ORDER.indexOf(k) || vlog.stage === 'published';
          const live = at === ORDER.indexOf(k) && vlog.stage !== 'published';
          return <li key={k} className={done ? 'done' : live ? (vlog.error ? 'stuck' : 'live') : ''}><span className="ic">{done ? '✓' : live ? (vlog.error ? '!' : '') : i + 1}</span>{label}</li>;
        })}
      </ol>

      {vlog.error ? (
        <div className="ue-stop" role="alert">
          <b>Stopped at “{STEPS.find(([k]) => k === vlog.stage)?.[1] ?? vlog.stage}”.</b>
          <span>{vlog.error}</span>
          <button className="btn small primary" type="button" disabled={busy === 'retry'} onClick={() => send({ tool: 'retry' }, 'retry')}>Retry</button>
        </div>
      ) : working ? (
        <p className="ue-working"><span className="take-spin" /> {vlog.stage === 'uploaded' || vlog.stage === 'transcribing' ? 'Reading the recording and transcribing it…' : vlog.stage === 'finding' ? 'Finding the moments that stand on their own…' : vlog.stage === 'rendering' ? (vlog.polish && clips.every((c) => c.status !== 'rendering' && c.status !== 'redo') ? `Polishing the full episode… ${vlog.polish.done} of ${vlog.polish.parts} parts` : `Cutting clips with captions… ${clips.filter((c) => c.status !== 'rendering' && c.status !== 'redo').length} of ${clips.length} ready`) : 'Sending to Metricool…'}</p>
      ) : null}

      <section className="ue-episode">
        <div className="ue-ep-video">
          {vlog.source ? <StableVideo src={vlog.source} /> : <div className="ue-blank" />}
          {vlog.sourceFull ? <a className="muted" href={vlog.sourceFull} target="_blank" rel="noreferrer">Full quality</a> : null}
          {vlog.polish?.ready ? (<>
            <span className="muted">Full video · {mmss(vlog.polish.secs)} · polished: {polishSummary(vlog.polish)} · reframed, color-graded, audio leveled{vlog.polish.graphics && !vlog.polish.graphicsError ? ` · ${vlog.polish.graphics} graphics with sound` : ''}{vlog.polish.chapters ? ' · YouTube chapters in the description' : ''}{vlog.polish.graphicsError ? ` · no graphics this time (${vlog.polish.graphicsError})` : ''}{vlog.polish.gaps?.length ? <> · <strong>check before approving: {vlog.polish.gaps.join('; ')}</strong> <button type="button" className="btn" disabled={!review || busy === 'ep-retry'} onClick={() => send({ tool: 'retry_episode' }, 'ep-retry')}>Polish again</button></> : null}{vlog.polish.graphicsError && vlog.polish.graphics ? <> <button type="button" className="btn" disabled={!review || busy === 'ep-retry'} onClick={() => send({ tool: 'retry_episode' }, 'ep-retry')}>Add graphics again</button></> : null}</span>
            {vlog.polish.pkg ? (
              <span className="muted">
                Show package{' '}
                <select aria-label="Show package" value={vlog.polish.pkg} disabled={!review || busy === 'ep-pkg'} onChange={(e) => send({ tool: 'set_package', pkg: e.target.value }, 'ep-pkg')}>
                  {SHOW_PACKAGES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                {vlog.polish.qa ? <> · quality check: {vlog.polish.qa.ok ? 'passed' : `${vlog.polish.qa.issues.length} to look at`}{vlog.polish.qa.fixed ? ` (${vlog.polish.qa.fixed} fixed)` : ''}{!vlog.polish.qa.ok ? <> — {vlog.polish.qa.issues.slice(0, 3).join('; ')}</> : null}</> : null}
              </span>
            ) : null}
          </>) : (
            vlog.polish?.error ? (
              <span className="ue-stop" role="alert">
                <span>The polished episode didn’t finish ({vlog.polish.error}). The full video goes to YouTube as recorded unless you try again.</span>
                <button type="button" className="btn" disabled={!review || busy === 'ep-retry'} onClick={() => send({ tool: 'retry_episode' }, 'ep-retry')}>Polish again</button>
              </span>
            ) :
            <span className="muted">Full video · {vlog.duration ? mmss(vlog.duration) : '…'} · {vlog.bytes >= 1024 ** 3 ? `${(vlog.bytes / 1024 ** 3).toFixed(2)} GB` : `${Math.max(1, Math.round(vlog.bytes / 1024 ** 2))} MB`} · {vlog.polish ? 'the polished version replaces this when it finishes' : 'goes to YouTube as is'}</span>
          )}
        </div>
        <div className="ue-ep-copy">
          <p className="eyebrow">Full video · YouTube</p>
          <EditLine label="Title" value={vlog.episode.title ?? vlog.title} disabled={!review} onSave={(v) => send({ tool: 'edit_episode', title: v }, 'ep')} />
          <EditLine label="Description" value={vlog.episode.description ?? ''} multiline disabled={!review} onSave={(v) => send({ tool: 'edit_episode', description: v }, 'ep')} />
          {vlog.thumbs.length ? (
            <>
              <p className="eyebrow" style={{ marginTop: 6 }}>Thumbnail · the picked one goes with the video</p>
              <div className="ue-thumbs">
                {vlog.thumbs.map((t, i) => (
                  <button key={i} type="button" className={'ue-thumb' + (vlog.thumbPick === i ? ' on' : '')} disabled={!review || busy === `t${i}`} onClick={() => send({ tool: 'pick_thumb', index: i }, `t${i}`)} aria-pressed={vlog.thumbPick === i}>
                    <img src={t.src} alt={`Thumbnail option ${i + 1}: ${t.text}`} />
                    <span>{String.fromCharCode(65 + i)} · {t.look}{vlog.thumbPick === i ? ' · picked' : ''}</span>
                  </button>
                ))}
              </div>
              <p className="muted ue-small">To test all three: in YouTube Studio, open the video → Test &amp; Compare → add these three files. YouTube picks the winner by watch time.</p>
            </>
          ) : null}
          <LongForm posts={posts} ready={review && (!vlog.polish || vlog.polish.ready || Boolean(vlog.polish.error))} busy={busy === 'longform'} onPost={() => send({ tool: 'post_longform' }, 'longform')} />
          <SourcesSheet value={vlog.sources ?? ''} notes={vlog.polish?.newsNotes ?? []} disabled={busy === 'sources' || ['publishing', 'published'].includes(vlog.stage)} onSave={(sheet) => send({ tool: 'set_sources', sheet }, 'sources')} />
        </div>
      </section>

      {clips.length ? (
        <section>
          <div className="ue-h"><h3>Clips · 9:16 with captions</h3><span className="muted">Each goes to Instagram and Facebook as a Reel and to YouTube as a Short.</span></div>
          <div className="ue-clips">
            {clips.map((c) => (
              <article key={c.id} id={`clip-${c.n}`} className={`ue-clip ${c.status}`}>
                <div className="ue-clip-video">
                  {c.src && !['rendering', 'redo'].includes(c.status) ? <StableVideo src={c.src} /> : <div className="ue-blank"><span className="take-spin" />{c.status === 'redo' ? 'Redoing…' : 'Cutting…'}</div>}
                  {c.full && !['rendering', 'redo'].includes(c.status) ? <a className="muted" href={c.full} target="_blank" rel="noreferrer">Full quality</a> : null}
                  {c.cover && !['rendering', 'redo'].includes(c.status) ? <a href={c.cover} target="_blank" rel="noreferrer" title="The cover Reels, Facebook and Shorts show" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><img src={c.cover} alt={`Cover for clip ${c.n}`} style={{ width: 54, height: 96, objectFit: 'cover', borderRadius: 6 }} /><span className="muted">Cover</span></a> : null}
                </div>
                <div className="ue-clip-body">
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    <span className="chip">Clip {c.n}</span>
                    {c.secs ? <span className="chip">{Math.round(c.secs)} s</span> : null}
                    {c.hook ? <span className="chip" title="Opens on its strongest line, then plays the moment">Hook first</span> : null}
                    <span className="chip muted">{mmss(c.start)}–{mmss(c.end)} in the video</span>
                  </div>
                  <b>{c.title}</b>
                  {c.caption ? <span className="soft">{c.caption}</span> : null}
                  {c.error ? <span className="ue-err">{c.error}</span> : null}
                  <details>
                    <summary>Post copy</summary>
                    {(['instagram', 'facebook', 'youtube'] as const).map((k) => <EditLine key={k} label={k === 'youtube' ? 'YouTube Short title' : NET[k]} value={c.copy[k] ?? ''} multiline={k !== 'youtube'} disabled={!review} onSave={(v) => send({ tool: 'edit_clip', clip: c.id, [k]: v }, `e${c.id}`)} />)}
                  </details>
                  {review ? (
                    c.status === 'ready' ? (
                      redo === c.id ? (
                        <div className="ue-redo">
                          <input className="input" placeholder="What should change? (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={400} autoFocus />
                          <button className="btn small primary" type="button" disabled={busy === c.id} onClick={() => { send({ tool: 'redo_clip', clip: c.id, note }, c.id); setRedo(null); setNote(''); }}>Redo</button>
                          <button className="btn small ghost" type="button" onClick={() => setRedo(null)}>Cancel</button>
                        </div>
                      ) : (
                        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                          <button className="btn small good" type="button" disabled={busy === c.id} onClick={() => send({ tool: 'approve_clip', clip: c.id }, c.id)}>Approve</button>
                          <button className="btn small" type="button" onClick={() => { setRedo(c.id); setNote(''); }}>Redo</button>
                          <button className="btn small ghost" type="button" disabled={busy === c.id} onClick={() => send({ tool: 'drop_clip', clip: c.id }, c.id)}>Leave out</button>
                        </div>
                      )
                    ) : c.status === 'approved' || c.status === 'dropped' ? (
                      <div className="row" style={{ gap: 8 }}>
                        <b className={c.status === 'approved' ? 'ue-ok' : 'muted'}>{c.status === 'approved' ? '✓ Approved' : 'Left out'}</b>
                        <button className="btn small ghost" type="button" disabled={busy === c.id} onClick={() => send({ tool: 'reopen_clip', clip: c.id }, c.id)}>Undo</button>
                      </div>
                    ) : null
                  ) : c.status === 'approved' ? <b className="ue-ok">✓ Approved</b> : c.status === 'dropped' ? <span className="muted">Left out</span> : null}
                </div>
              </article>
            ))}
          </div>
          {vlog.episode.dropped?.length ? <p className="muted ue-small">Not used: {vlog.episode.dropped.join(' · ')}</p> : null}
        </section>
      ) : null}

      {review && planning ? (
        <PostPlan clips={clips} longform={!posts.some((p) => p.platform === 'youtube' && p.kind === 'video' && ['sent', 'posted'].includes(p.status))} planning={planning} live={vlog.live} busy={busy === 'approve'}
          onApprove={(b) => send({ tool: 'approve', ...b }, 'approve')} />
      ) : null}

      {posts.length ? (
        <section>
          <div className="ue-h"><h3>Posts</h3><span className="muted">{vlog.live ? 'Scheduled through Metricool' : 'Drafts in Metricool'} · real footage, no AI label</span></div>
          <ul className="ue-posts">
            {posts.map((p) => (
              <li key={p.id}>
                <span>{NET[p.platform]}{p.platform === 'youtube' ? (p.kind === 'video' ? ' video' : ' Short') : ''}{p.clip ? ` · clip ${p.clip}` : ' · full video'}</span>
                <span className={p.status === 'error' ? 'ue-err' : p.status === 'posted' ? 'ue-ok' : 'muted'}>
                  {p.status === 'posted' ? (p.posted_url ? <><a href={p.posted_url} target="_blank" rel="noreferrer">Live ↗</a>{p.mc_error ? <span className="muted" title={p.mc_error}> · {/thumbnail/i.test(p.mc_error) ? 'custom thumbnail refused by YouTube' : 'posted with a warning'}</span> : null}</> : 'Live') : p.status === 'sent' ? (p.mc_status === 'DRAFT' ? 'Draft in Metricool' : 'Scheduled') : p.status === 'error' ? `Failed: ${p.mc_error}` : p.status === 'skipped' ? `Skipped: ${p.mc_error}` : p.status === 'cancelled' ? 'Taken off the calendar' : p.scheduled_at ? `On the calendar · ${calAt(p.scheduled_at)}` : 'Queued'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="muted ue-small">Transcribed by {vlog.provider ?? '…'}{vlog.words ? ` · ${vlog.words.toLocaleString()} words` : ''} · cost so far ${(vlog.cost / 100).toFixed(2)} (Studio budget)</p>
    </div>
  );
}

function EditLine({ label, value, multiline, disabled, onSave }: { label: string; value: string; multiline?: boolean; disabled?: boolean; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const changed = v !== value;
  return (
    <label className="ue-edit">
      <span>{label}</span>
      {multiline ? <textarea className="textarea" rows={3} value={v} disabled={disabled} onChange={(e) => setV(e.target.value)} /> : <input className="input" value={v} disabled={disabled} onChange={(e) => setV(e.target.value)} />}
      {changed && !disabled ? <button type="button" className="btn small" onClick={() => onSave(v)}>Save</button> : null}
    </label>
  );
}

/** Newsroom: the approved facts the episode shows on screen, each tied to the words said when it appears. Only what is
 *  on this sheet is shown: a source chip, an attributed quote, a dated timeline or a ticker. */
function SourcesSheet({ value, notes, disabled, onSave }: { value: string; notes: string[]; disabled: boolean; onSave: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <details className="ue-sources" open={Boolean(value) || undefined}>
      <summary className="eyebrow">Newsroom sources · {value ? `${value.split(/\r?\n/).filter(Boolean).length} on screen` : 'none'}</summary>
      <p className="muted ue-small">One line each, fields split by “ | ”. The spoken words place it.<br />
        <code>source | spoken words | NVIDIA board statement · Nov 8, 2026</code><br />
        <code>quote | spoken words | exact quote | who said it | when</code><br />
        <code>timeline | spoken words | title | Nov 8: what happened @ spoken words ; Nov 12: … @ …</code><br />
        <code>ticker | spoken words | headline | label | item ; item ; item</code><br />
        <code>globe | spoken words | alone, fall or lit | optional caption</code></p>
      <label className="sr-only" htmlFor="ue-sources-text">Sources sheet</label>
      <textarea id="ue-sources-text" rows={6} value={text} onChange={(e) => setText(e.target.value)} disabled={disabled} spellCheck={false} style={{ width: '100%', fontFamily: 'var(--mono, ui-monospace, monospace)', fontSize: 13 }} />
      {notes.length ? <p className="ue-stop" role="status">{notes.slice(0, 4).join('; ')}</p> : null}
      <button type="button" className="btn small primary" disabled={disabled || text === value} onClick={() => onSave(text)}>Save sources</button>
    </details>
  );
}
