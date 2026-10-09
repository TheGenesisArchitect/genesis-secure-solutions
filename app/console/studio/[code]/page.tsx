// One Studio episode: the script, every shot with its ready-to-paste prompt and progress, the final render and
// its approval, and the posting kit for each platform (caption, tracked link, approve, record the live post).
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConsoleShell } from '@/components/ConsoleShell';
import { ActionForm } from '@/components/ActionForm';
import { CopyButton } from '@/components/CopyButton';
import { Panel, Chip } from '@/components/ui';
import { requireStaff } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { studioUpdateShot, studioSetEpisode, studioSavePost, studioApprovePost, studioMarkPosted } from '@/lib/actions';
import { ShotTakes, FinalUpload, type Take } from '@/components/studio/StudioClient';
import { VIDEO_CENTS, VIDEO_SECONDS } from '@/lib/studio-gen';

export const dynamic = 'force-dynamic';

const TOOL: Record<string, string> = { flow: 'Google Flow', 'nano-banana': 'Nano Banana Pro', capture: 'Real app capture', edit: 'Edit', veo: 'Veo' };
const PLATFORM: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube Shorts' };
const STAGES = ['writing', 'shooting', 'editing', 'review', 'approved', 'live'];
const etInput = (s: string | null) => (s ? new Date(new Date(s).getTime() - 4 * 3600_000).toISOString().slice(0, 16) : '');

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  return { title: `Studio · ${(await params).code}` };
}

export default async function Episode({ params }: { params: Promise<{ code: string }> }) {
  await requireStaff();
  const { code } = await params;
  const supabase = await db();
  const { data: e } = await supabase.from('studio_episodes').select('*, studio_series(name, bible)').eq('code', code).maybeSingle();
  if (!e) notFound();
  const [{ data: shots }, { data: posts }, { data: takeRows }] = await Promise.all([
    supabase.from('studio_shots').select('*').eq('episode_id', e.id).order('n'),
    supabase.from('studio_posts').select('*').eq('episode_id', e.id).order('platform'),
    supabase.from('studio_takes').select('id, shot_id, kind, status, chosen, error, cost_cents, created_at, studio_shots!inner(episode_id)').eq('studio_shots.episode_id', e.id).order('created_at', { ascending: false }),
  ]);
  const takesFor = (shot: string) => ((takeRows ?? []).filter((t) => t.shot_id === shot) as unknown as Take[]);
  const costLabel = `${(VIDEO_CENTS / 100).toFixed(2)} · ${VIDEO_SECONDS}s`;
  const series = e.studio_series as { name: string; bible: { platform_notes?: Record<string, string> } } | null;
  const notes = series?.bible?.platform_notes ?? {};
  const approved = e.status === 'approved' || e.status === 'live';
  return (
    <ConsoleShell title={e.title} crumbs={[{ href: '/console', label: 'Enterprise' }, { href: '/console/studio', label: 'Studio' }, { label: e.title }]}>
      <p className="soft">{e.logline}</p>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <Panel title="Script" sub={`${series?.name} · ${e.kind} · ${e.runtime_s}s`} actions={<CopyButton text={e.script ?? ''} label="Copy script" />}>
          <pre className="studio-script">{e.script}</pre>
          {e.music ? <p className="muted" style={{ margin: 0, fontSize: 13 }}><b>Music:</b> {e.music}</p> : null}
        </Panel>
        <Panel title="Final render and approval" sub="Approval is bound to this exact render: a new link sends it back to review">
          <ActionForm action={studioSetEpisode} className="form">
            <input type="hidden" name="id" value={e.id} />
            {e.final_blob ? <input type="hidden" name="final" value={e.final_url ?? ''} /> : <label className="field"><span>Final render link (or upload the cut below)</span><input className="input" name="final" type="url" defaultValue={e.final_url ?? ''} placeholder="https://…" /></label>}
            <label className="field"><span>Stage</span>
              <select className="select" name="status" defaultValue={e.status}>{STAGES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
            </label>
            <button className="btn primary" type="submit">Save</button>
          </ActionForm>
          {e.final_blob ? <video className="final-video" src={`/api/studio/media/final/${e.id}`} controls playsInline preload="metadata" /> : e.final_url ? <a className="btn small" href={e.final_url} target="_blank" rel="noreferrer" style={{ justifySelf: 'start' }}>Watch the render ↗</a> : null}
          {e.final_sha256 ? <span className="muted" style={{ fontSize: 12, fontFamily: 'var(--mono)' }}>Fingerprint {e.final_sha256.slice(0, 16)}… approval is bound to this exact file.</span> : null}
          <FinalUpload episodeId={e.id} hasFinal={Boolean(e.final_blob)} />
          {approved ? <Chip kind="done">Approved {e.approved_at ? new Date(e.approved_at).toLocaleString('en-US', { timeZone: 'America/New_York' }) : ''}</Chip> : <span className="muted" style={{ fontSize: 13 }}>Before approving: AI label planned for every platform, captions burned in, no carrier names or logos, phone shows demo data only.</span>}
        </Panel>
      </div>

      <Panel title={`Shots · ${(shots ?? []).filter((s) => s.status === 'approved').length}/${shots?.length ?? 0} approved`} sub="Generate each shot in its tool, paste the take's link, approve it. A failed take is redone without touching the others.">
        <ol className="studio-shots">
          {(shots ?? []).map((s) => (
            <li key={s.id} className="tile" style={{ gap: 8 }}>
              <div className="spread" style={{ flexWrap: 'wrap', gap: 6 }}>
                <b>Shot {s.n} <span className="muted" style={{ fontWeight: 500 }}>{s.timing}</span></b>
                <span className="row" style={{ gap: 6 }}><Chip kind={s.tool === 'capture' ? 'done' : 'info'}>{TOOL[s.tool]}</Chip><Chip kind={s.status === 'approved' ? 'done' : s.status === 'todo' ? 'pending' : 'info'}>{s.status}</Chip></span>
              </div>
              <span>{s.description}</span>
              {s.camera ? <span className="muted" style={{ fontSize: 13 }}>Camera: {s.camera}</span> : null}
              {s.dialogue ? <span style={{ fontSize: 14, fontStyle: 'italic' }}>{s.dialogue}</span> : null}
              {s.prompt ? (
                <details>
                  <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>{s.tool === 'capture' ? 'How to capture' : s.tool === 'edit' ? 'Edit notes' : 'Prompt'}</summary>
                  <p className="studio-prompt">{s.prompt}</p>
                  <CopyButton text={s.prompt} label={s.tool === 'flow' ? 'Copy Flow prompt' : 'Copy'} />
                </details>
              ) : null}
              {s.tool !== 'edit' ? <ShotTakes shotId={s.id} tool={s.tool} prompt={s.prompt ?? s.description} takes={takesFor(s.id)} costLabel={costLabel} /> : null}
              <ActionForm action={studioUpdateShot} className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                <input type="hidden" name="id" value={s.id} />
                <select className="select" name="status" defaultValue={s.status} aria-label="Shot status" style={{ width: 130 }}>
                  <option value="todo">To do</option><option value="generating">Generating</option><option value="take_ok">Good take</option><option value="approved">Approved</option>
                </select>
                <input className="input" name="take" type="url" defaultValue={s.take_url ?? ''} placeholder="Take link" aria-label="Take link" style={{ flex: '1 1 180px' }} />
                <input className="input" name="notes" defaultValue={s.notes ?? ''} placeholder="Notes" aria-label="Notes" style={{ flex: '1 1 140px' }} />
                <button className="btn small" type="submit">Save</button>
              </ActionForm>
            </li>
          ))}
        </ol>
      </Panel>

      <Panel title="Posting kit" sub={approved ? 'Approve each post, publish it by hand on the platform with its AI label on, then paste the live link.' : 'Posts can be approved once the episode’s final render is approved.'}>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,340px),1fr))', alignItems: 'start' }}>
          {(posts ?? []).map((p) => (
            <div key={p.id} className="tile" style={{ gap: 10 }}>
              <div className="spread"><b style={{ font: '800 16px var(--display)' }}>{PLATFORM[p.platform]}</b>{p.posted_url ? <a href={p.posted_url} target="_blank" rel="noreferrer"><Chip kind="done">live ↗</Chip></a> : <Chip kind={p.status === 'approved' ? 'info' : 'pending'}>{p.status}</Chip>}</div>
              <ActionForm action={studioSavePost} className="form">
                <input type="hidden" name="id" value={p.id} />
                {p.platform === 'youtube' ? <label className="field"><span>Title</span><input className="input" name="title" defaultValue={p.title ?? ''} maxLength={100} disabled={p.status === 'posted'} /></label> : null}
                <label className="field"><span>Caption</span><textarea className="input" name="caption" rows={6} defaultValue={p.caption} maxLength={2200} disabled={p.status === 'posted'} /></label>
                <label className="field"><span>Post at (Eastern)</span><input className="input" type="datetime-local" name="when" defaultValue={etInput(p.scheduled_for)} disabled={p.status === 'posted'} /></label>
                {p.status !== 'posted' ? <button className="btn small" type="submit">Save edits</button> : null}
              </ActionForm>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <CopyButton text={p.platform === 'youtube' && p.title ? `${p.title}\n\n${p.caption}` : p.caption} label="Copy caption" />
                <CopyButton text={p.link} label="Copy tracked link" />
              </div>
              <span className="muted" style={{ fontSize: 12 }}>{notes[p.platform]}</span>
              {p.status === 'draft' ? (
                <ActionForm action={studioApprovePost}><input type="hidden" name="id" value={p.id} /><button className="btn small primary" type="submit" disabled={!approved}>Approve this post</button></ActionForm>
              ) : null}
              {p.status === 'approved' ? (
                <ActionForm action={studioMarkPosted} className="form">
                  <input type="hidden" name="id" value={p.id} />
                  <label className="field"><span>Live post link</span><input className="input" name="url" type="url" required placeholder="https://…" /></label>
                  <label className="row" style={{ gap: 8, fontSize: 14 }}><input type="checkbox" name="ai" required /> The platform’s AI-content label is on</label>
                  <button className="btn small primary" type="submit">Record as live</button>
                </ActionForm>
              ) : null}
            </div>
          ))}
        </div>
      </Panel>
      <Link className="btn ghost small" href="/console/studio" style={{ justifySelf: 'start' }}>← Back to the Studio</Link>
    </ConsoleShell>
  );
}
