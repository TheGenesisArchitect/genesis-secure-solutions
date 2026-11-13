'use client';
// The Unedit card: the whole campaign from one take, on one screen. While Unedit works, the stages tick by (and the
// card refreshes itself); a stopped step shows its real error with Retry. Then: the full video with its title and
// three thumbnails, every clip with Approve, Redo (with a note) or Leave out, and one Approve for the campaign. After
// it, each post's state in Metricool, with its live link when it's up.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export type CardClip = { id: string; n: number; title: string; caption: string; secs: number | null; hook: boolean; status: string; note: string | null; error: string | null; src: string | null; copy: { instagram?: string; facebook?: string; youtube?: string }; start: number; end: number };
export type CardPost = { id: string; platform: string; kind: string; title: string | null; clip: number | null; status: string; mc_status: string | null; mc_error: string | null; posted_url: string | null };
export type CardVlog = { id: string; title: string; stage: string; error: string | null; provider: string | null; words: number | null; duration: number | null; bytes: number; cost: number; source: string | null; polish: { secs: number; removed: number; ready: boolean; error: string | null; parts: number; done: number; cuts: Record<string, number>; graphics: number; graphicsError: string | null; chapters: boolean } | null; episode: { title?: string; description?: string; dropped?: string[] }; thumbs: { src: string; text: string; look: string }[]; thumbPick: number | null; live: boolean; approvedAt: string | null };

const toast = (r: { ok?: string; err?: string }) => window.dispatchEvent(new CustomEvent('genovus:toast', { detail: { ...r, at: Date.now() } }));
const STEPS: [string, string][] = [['uploaded', 'Uploaded'], ['transcribing', 'Transcribed'], ['finding', 'Moments found'], ['rendering', 'Clips cut'], ['review', 'Your review'], ['publishing', 'Sent']];
const ORDER = ['uploaded', 'transcribing', 'finding', 'rendering', 'review', 'publishing', 'published'];
const NET: Record<string, string> = { instagram: 'Instagram Reel', facebook: 'Facebook Reel', youtube: 'YouTube' };
// "0:15 tightened: 1 camera command, 6 uh/um, 3 long pauses, walk-off"
function polishSummary(p: { removed: number; cuts: Record<string, number> }): string {
  const n = (k: string, one: string, many = `${one}s`) => (p.cuts[k] ? `${p.cuts[k]} ${p.cuts[k] === 1 ? one : many}` : '');
  const bits = [n('command', 'camera command'), n('filler', 'uh/um', 'uh/ums'), n('false start', 'false start'), n('pause', 'long pause'), p.cuts.head ? 'walk-up' : '', p.cuts.tail ? 'walk-off' : ''].filter(Boolean);
  return `${mmss(p.removed)} tightened${bits.length ? ` (${bits.join(', ')})` : ''}`;
}
const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export function UneditCard({ vlog, clips, posts }: { vlog: CardVlog; clips: CardClip[]; posts: CardPost[] }) {
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
  const approved = clips.filter((c) => c.status === 'approved');
  const open = clips.filter((c) => c.status === 'ready');
  const postCount = approved.length * 3 + 1;

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
          {vlog.source ? <video src={vlog.source} controls playsInline preload="metadata" /> : <div className="ue-blank" />}
          {vlog.polish?.ready ? (
            <span className="muted">Full video · {mmss(vlog.polish.secs)} · polished: {polishSummary(vlog.polish)} · reframed, color-graded, audio leveled{vlog.polish.graphics && !vlog.polish.graphicsError ? ` · ${vlog.polish.graphics} graphics with sound` : ''}{vlog.polish.chapters ? ' · YouTube chapters in the description' : ''}{vlog.polish.graphicsError ? ` · no graphics this time (${vlog.polish.graphicsError})` : ''}{vlog.polish.graphicsError && vlog.polish.graphics ? <> <button type="button" className="btn" disabled={!review || busy === 'ep-retry'} onClick={() => send({ tool: 'retry_episode' }, 'ep-retry')}>Add graphics again</button></> : null}</span>
          ) : (
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
        </div>
      </section>

      {clips.length ? (
        <section>
          <div className="ue-h"><h3>Clips · 9:16 with captions</h3><span className="muted">Each goes to Instagram and Facebook as a Reel and to YouTube as a Short.</span></div>
          <div className="ue-clips">
            {clips.map((c) => (
              <article key={c.id} className={`ue-clip ${c.status}`}>
                <div className="ue-clip-video">
                  {c.src && !['rendering', 'redo'].includes(c.status) ? <video src={c.src} controls playsInline preload="metadata" /> : <div className="ue-blank"><span className="take-spin" />{c.status === 'redo' ? 'Redoing…' : 'Cutting…'}</div>}
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

      {review ? (
        <div className="ue-approve">
          <div>
            <b>{open.length ? `${open.length} clip${open.length === 1 ? '' : 's'} still to decide` : `Ready: ${approved.length} clip${approved.length === 1 ? '' : 's'} and the full video`}</b>
            <span className="muted">{vlog.live ? 'Posts are scheduled to publish about 15 minutes after you approve.' : 'Posts land in Metricool as drafts; nothing goes public until it is published there.'}</span>
          </div>
          <button className="btn primary" type="button" disabled={Boolean(open.length) || busy === 'approve'} onClick={() => send({ tool: 'approve' }, 'approve')}>{open.length ? 'Decide every clip first' : `Approve ${postCount} post${postCount === 1 ? '' : 's'}`}</button>
        </div>
      ) : null}

      {posts.length ? (
        <section>
          <div className="ue-h"><h3>Posts</h3><span className="muted">{vlog.live ? 'Scheduled through Metricool' : 'Drafts in Metricool'} · real footage, no AI label</span></div>
          <ul className="ue-posts">
            {posts.map((p) => (
              <li key={p.id}>
                <span>{NET[p.platform]}{p.platform === 'youtube' ? (p.kind === 'video' ? ' video' : ' Short') : ''}{p.clip ? ` · clip ${p.clip}` : ' · full video'}</span>
                <span className={p.status === 'error' ? 'ue-err' : p.status === 'posted' ? 'ue-ok' : 'muted'}>
                  {p.status === 'posted' ? (p.posted_url ? <a href={p.posted_url} target="_blank" rel="noreferrer">Live ↗</a> : 'Live') : p.status === 'sent' ? (p.mc_status === 'DRAFT' ? 'Draft in Metricool' : 'Scheduled') : p.status === 'error' ? `Failed: ${p.mc_error}` : p.status === 'skipped' ? `Skipped: ${p.mc_error}` : 'Queued'}
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
