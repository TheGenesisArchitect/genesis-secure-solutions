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
import { studioUpdateShot, studioSetEpisode, studioSavePost, studioApprovePost, studioMarkPosted, studioSetPostMethod, studioUpdateShotLog, studioSetFormat, studioSetQa, studioSaveMetrics, studioSetShotBudget } from '@/lib/actions';
import { SourceCard, type Source } from '@/components/studio/SourceCard';
import { ShotTakes, GenerateFirstTakes, FrameForge, FinalUpload, Thumbnails, LineVoice, type Take, type Art, type Frame, type VoiceClip } from '@/components/studio/StudioClient';
import type { ShotContract } from '@/lib/studio-direct';
import { VIDEO_SECONDS, IMAGE_CENTS, generationConfigured, shotBudget, videoFor } from '@/lib/studio-gen';
import { StudioHelix } from '@/components/studio/StudioHelix';

export const dynamic = 'force-dynamic';

const TOOL: Record<string, string> = { flow: 'Google Flow', 'nano-banana': 'Nano Banana Pro', capture: 'Real app capture', edit: 'Edit', veo: 'Veo' };
const PLATFORM: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube Shorts' };
const STAGES = ['writing', 'shooting', 'editing', 'review', 'approved', 'live'];
const BEATS = ['Recognition', 'The fork', 'The problem', 'Escalation', 'The save', 'Viral payoff', 'Character payoff', 'Signature'];
const KIND_LABEL: Record<string, string> = { source: 'Their footage', fork: 'Fork', product: 'Product · real capture', signature: 'Signature', sting: 'End card', pickup: 'Pickup' };
const MODE: Record<string, { label: string; note: string }> = {
  split: { label: 'Split-Screen Fork', note: 'Their reel plays whole in one half (Instagram Remix split / TikTok Duet); our fork plays in the other, timed to their hook and payoff. Made in the app; the payoff is never touched.' },
  sequential: { label: 'Sequential Fork', note: 'Their hook first (Remix “Add to end” / Stitch), then our fork. Made in the app.' },
  seamless: { label: 'Seamless Fork', note: 'The full intercut edit of their footage. Only with the creator’s written license on file.' },
};
const LOG_FIELDS: [string, string][] = [['camera', 'Camera'], ['gaze', 'Gaze target'], ['prop_hand', 'Prop hand'], ['mood_in', 'Emotional state in'], ['mood_out', 'Emotional state out'], ['screen_asset', 'Screen asset'], ['sound', 'Sound']];
const etInput = (s: string | null) => (s ? new Date(new Date(s).getTime() - 4 * 3600_000).toISOString().slice(0, 16) : '');

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  return { title: `Studio · ${(await params).code}` };
}

export default async function Episode({ params }: { params: Promise<{ code: string }> }) {
  const viewer = await requireStaff();
  const { code } = await params;
  const supabase = await db();
  const { data: e } = await supabase.from('studio_episodes').select('*, studio_series(name, bible)').eq('code', code).maybeSingle();
  if (!e) notFound();
  const [{ data: shots }, { data: posts }, { data: takeRows }, { data: artRows }] = await Promise.all([
    supabase.from('studio_shots').select('*').eq('episode_id', e.id).order('n'),
    supabase.from('studio_posts').select('*').eq('episode_id', e.id).order('platform'),
    supabase.from('studio_takes').select('id, shot_id, kind, status, chosen, error, cost_cents, created_at, params, studio_shots!inner(episode_id)').eq('studio_shots.episode_id', e.id).order('created_at', { ascending: false }),
    supabase.from('studio_art').select('id, kind, shot_id, role, status, chosen, error, created_at').eq('episode_id', e.id).order('created_at', { ascending: false }),
  ]);
  const art = (artRows ?? []).filter((a) => a.kind !== 'frame') as Art[];
  const framesFor = (shot: string) => (artRows ?? []).filter((a) => a.kind === 'frame' && a.shot_id === shot).reverse() as unknown as Frame[];
  const contractOf = (s: { contract?: unknown }) => { const c = s.contract as ShotContract | null; return c?.timeline?.length ? c : null; };
  const { data: srcRows } = await supabase.from('studio_sources').select('*').or(`episode_id.eq.${e.id},and(series_id.eq.${e.series_id},route.eq.stitch)`).order('created_at');
  const allSources = (srcRows ?? []) as unknown as Source[];
  const mine = allSources.filter((s) => (s as unknown as { episode_id: string | null }).episode_id === e.id);
  const remixable = allSources.filter((s) => s.route === 'stitch');
  const thumb = art.find((a) => a.chosen && a.status === 'ready');
  const takesFor = (shot: string) => ((takeRows ?? []).filter((t) => t.shot_id === shot) as unknown as Take[]);
  const costLabel = (tier: string) => `${(videoFor(tier).cents / 100).toFixed(2)} · ${VIDEO_SECONDS}s${tier === 'hero' ? ' · hero' : ''}`;
  // Cast shots still waiting for their first take (a failed take doesn't count), for the one-tap first pass.
  // The shot budget (default 12, set per episode in the pitch) caps how many distinct shots it generates.
  const sb = await shotBudget(e.id);
  const firstPass = generationConfigured() ? (shots ?? []).filter((s) => s.tool === 'veo' && s.status !== 'approved' && !takesFor(s.id).some((t) => t.status !== 'failed')).map((s) => ({ id: s.id as string, code: (s.shot_code ?? `Shot ${s.n}`) as string, prompt: (s.prompt ?? s.description) as string, takes: s.tier === 'hero' ? (contractOf(s)?.takes ?? 3) : 1, cents: videoFor(s.tier).cents })).slice(0, Math.max(0, sb.budget - sb.used.length)) : [];
  const { data: castRows } = await supabase.from('studio_characters').select('code, name').eq('series_id', e.series_id);
  const [{ data: lineClips }, { data: qaRows }] = await Promise.all([
    supabase.from('studio_voice_clips').select('id, shot_id, slot, voice_name, status, error, text, created_at').eq('kind', 'line').in('shot_id', (shots ?? []).map((s) => s.id)).order('created_at', { ascending: false }),
    supabase.from('studio_qa').select('check_key, category, pass, note, reviewed_at').eq('episode_id', e.id),
  ]);
  const acceptance = ((e.studio_series as { bible?: { cast_bible?: { acceptance?: Record<string, string[]> } } } | null)?.bible?.cast_bible?.acceptance) ?? {};
  const checks = (['script', 'visual', 'brand'] as const).flatMap((cat) => (acceptance[cat] ?? []).map((label, i) => ({ key: `${cat}-${i + 1}`, cat, label })));
  const qa = (k: string) => (qaRows ?? []).find((r) => r.check_key === k);
  const passed = checks.filter((c) => qa(c.key)?.pass).length;
  const who = (code: string) => (castRows ?? []).find((c) => c.code === code)?.name.split(' ')[0] ?? code.replace(/\d+$/, '');
  const { data: forkSources } = await supabase.from('studio_sources').select('id, title, remix_allowed, route').eq('route', 'stitch');
  const series = e.studio_series as { name: string; bible: { platform_notes?: Record<string, string> } } | null;
  const notes = series?.bible?.platform_notes ?? {};
  const approved = e.status === 'approved' || e.status === 'live';
  return (
    <ConsoleShell title={e.title} crumbs={[{ href: '/console', label: 'Enterprise' }, { href: '/console/studio', label: 'Studio' }, { label: e.title }]} actions={<StudioHelix focus={{ kind: 'episode', code: e.code, label: `the episode “${e.title}”` }} />}>
      <p className="soft">{e.logline}</p>
      {e.format === 'viral_fork' && e.fork_mode ? (
        <div className="fork-banner">
          <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}><Chip kind="info">{MODE[e.fork_mode].label}</Chip>{e.target_s ? <Chip kind="pending">{e.target_s}s target</Chip> : null}{e.cut_family ? <Chip kind="pending">{e.cut_family} cut</Chip> : null}</span>
          <span className="soft" style={{ fontSize: 13 }}>{MODE[e.fork_mode].note}</span>
          <span className="muted" style={{ fontSize: 12 }}>Rule: never change the original payoff. Build the GENOVUS story around it.</span>
        </div>
      ) : null}
      {(shots ?? []).some((s) => s.beat) ? (
        <div className="beat-strip" aria-label="Beat timeline">
          {BEATS.map((label, i) => {
            const inBeat = (shots ?? []).filter((s) => s.beat === i + 1 && s.shot_kind !== 'pickup');
            const ready = inBeat.filter((s) => s.shot_kind === 'source' || s.status === 'take_ok' || s.status === 'approved').length;
            return (
              <div key={label} className={'beat' + (inBeat.length && ready === inBeat.length ? ' ok' : '') + (inBeat.some((s) => s.shot_kind === 'source') ? ' theirs' : '')}>
                <b>{i + 1}</b><span>{label}</span><small>{inBeat.map((s) => s.timing).filter(Boolean).join(' · ') || '·'}</small>
              </div>
            );
          })}
        </div>
      ) : null}
      {e.seat_map ? (
        <div className="seat-map" aria-label="Seat and gaze map">
          <span className="muted" style={{ fontSize: 12 }}>Seat map · audience camera</span>
          <div className="seats"><span className="performer">Performer ←</span>{(e.seat_map as { order: string[] }).order.map((c) => <span key={c} className="seat">{who(c)}</span>)}</div>
          <span className="muted" style={{ fontSize: 12 }}>Gaze: {(e.seat_map as { gaze?: string }).gaze}. Reverse angles need their own map.</span>
        </div>
      ) : null}
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <Panel title="Script" sub={`${series?.name} · ${e.kind} · ${e.runtime_s}s`} actions={<CopyButton text={e.script ?? ''} label="Copy script" />}>
          <pre className="studio-script">{e.script}</pre>
          {e.music ? <p className="muted" style={{ margin: 0, fontSize: 13 }}><b>Music:</b> {e.music}</p> : null}
        </Panel>
        <Panel title="Format" sub="Original episode, or a Viral Fork of a remix-enabled moment from the trend board.">
          <ActionForm action={studioSetFormat} className="form">
            <input type="hidden" name="id" value={e.id} />
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <label className="field" style={{ flex: '1 1 160px' }}><span>Format</span><select className="select" name="format" defaultValue={e.format}><option value="original">Original</option><option value="viral_fork">Viral Fork</option></select></label>
              <label className="field" style={{ flex: '1 1 180px' }}><span>Fork mode</span><select className="select" name="mode" defaultValue={e.fork_mode ?? 'split'}><option value="split">Split-Screen (in-app)</option><option value="sequential">Sequential (in-app)</option><option value="seamless">Seamless (needs license)</option></select></label>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <label className="field" style={{ flex: '2 1 220px' }}><span>Source (Remix / Stitch)</span><select className="select" name="source" defaultValue={e.source_id ?? ''}><option value="">None</option>{(forkSources ?? []).map((s) => <option key={s.id} value={s.id}>{s.title}{s.remix_allowed ? ' ✓' : ' (remix not confirmed)'}</option>)}</select></label>
              <label className="field" style={{ flex: '1 1 100px' }}><span>Target (s)</span><input className="input" name="target" inputMode="numeric" defaultValue={e.target_s ?? ''} /></label>
              <label className="field" style={{ flex: '1 1 140px' }}><span>Cut</span><select className="select" name="cut" defaultValue={e.cut_family ?? ''}><option value="">-</option><option value="quick">Quick 25–30s</option><option value="signature">Signature 40–45s</option><option value="extended">Extended 55–60s</option></select></label>
            </div>
            <button className="btn small" type="submit" style={{ justifySelf: 'start' }}>Save format</button>
          </ActionForm>
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

      <Panel title="Sources & rights" sub={mine.length ? 'The viral moments this episode builds on. Approval is blocked until each one’s rights are cleared.' : 'This episode is fully original. Add a viral moment on the Studio’s Trend board to remix one.'}>
        {mine.length ? <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,340px),1fr))', alignItems: 'start' }}>{mine.map((s) => <SourceCard key={s.id} s={s} showEpisode={false} />)}</div> : null}
      </Panel>

      <Panel title="Thumbnails" sub="Key art with the Genovus signature frame. The chosen one is the cover for every post of this episode; download 9:16 for Reels, Shorts and TikTok, 1:1 for the feed.">
        <Thumbnails episodeId={e.id} defaultPrompt={e.thumb_prompt ?? `${e.title}: ${e.logline ?? ''}`} art={art} costLabel={`${(IMAGE_CENTS / 100).toFixed(2)}`} />
      </Panel>

      <Panel title={`Shots · ${(shots ?? []).filter((s) => s.status === 'approved').length}/${shots?.length ?? 0} approved`} sub="Generate each shot in its tool, paste the take's link, approve it. A failed take is redone without touching the others." actions={<span className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}><Chip kind={sb.used.length >= sb.budget ? 'pending' : 'info'}>Shot budget {sb.used.length}/{sb.budget}</Chip><GenerateFirstTakes shots={firstPass} /></span>}>
        {viewer.staff.role === 'admin' ? (
          <ActionForm action={studioSetShotBudget} className="row" style={{ gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
            <input type="hidden" name="code" value={e.code} />
            <label className="field" style={{ width: 200 }}><span>Shot budget (set in the pitch)</span><input className="input" name="budget" defaultValue={sb.budget} inputMode="numeric" /></label>
            <button className="btn small" type="submit">Save</button>
            <span className="muted" style={{ fontSize: 12 }}>Distinct shots this episode may generate; retakes of those shots don’t count.</span>
          </ActionForm>
        ) : null}
        <ol className="studio-shots">
          {(shots ?? []).map((s) => (
            <li key={s.id} className="tile" style={{ gap: 8 }}>
              <div className="spread" style={{ flexWrap: 'wrap', gap: 6 }}>
                <b>{s.shot_code ?? `Shot ${s.n}`} <span className="muted" style={{ fontWeight: 500 }}>{s.timing}</span></b>
                <span className="row" style={{ gap: 6 }}>{s.beat ? <Chip kind="pending">Beat {s.beat}</Chip> : null}{s.shot_kind ? <Chip kind={s.shot_kind === 'source' ? 'pending' : 'info'}>{KIND_LABEL[s.shot_kind]}</Chip> : <Chip kind={s.tool === 'capture' ? 'done' : 'info'}>{TOOL[s.tool]}</Chip>}<Chip kind={s.status === 'approved' ? 'done' : s.status === 'todo' ? 'pending' : 'info'}>{s.status}</Chip></span>
              </div>
              <span>{s.description}</span>
              {s.camera ? <span className="muted" style={{ fontSize: 13 }}>Camera: {s.camera}</span> : null}
              {(s.lines as { who: string; text: string }[] | null)?.length ? (
                <div className="lines">{(s.lines as { who: string; text: string }[]).map((l, i) => <div key={i}><p><b>{who(l.who).toUpperCase()}</b> {l.text}</p><LineVoice shotId={s.id} index={i} clips={((lineClips ?? []) as (VoiceClip & { shot_id: string })[]).filter((c) => c.shot_id === s.id && c.slot === `line-${i}`)} /></div>)}</div>
              ) : s.dialogue ? <span style={{ fontSize: 14, fontStyle: 'italic' }}>{s.dialogue}</span> : null}
              {s.shot_kind === 'source' ? <span className="theirs-note">Their footage, played in the app as-is. Never generated or altered.{(s.log as { src_in?: number; src_out?: number })?.src_in != null ? ` In ${(s.log as { src_in: number }).src_in}s → out ${(s.log as { src_out: number }).src_out}s.` : ''}</span> : null}
              {s.prompt ? (
                <details>
                  <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>{s.tool === 'capture' ? 'How to capture' : s.tool === 'edit' ? 'Edit notes' : 'Prompt'}</summary>
                  <p className="studio-prompt">{s.prompt}</p>
                  <CopyButton text={s.prompt} label={s.tool === 'flow' ? 'Copy Flow prompt' : 'Copy'} />
                </details>
              ) : null}
              {contractOf(s) ? (
                <details className="shot-contract" open={s.tier === 'hero'}>
                  <summary><b>Shot Contract</b> <Chip kind={s.tier === 'hero' ? 'live' : 'info'}>{s.tier === 'hero' ? 'Hero · standard Veo · ' + (contractOf(s)!.takes ?? 3) + ' takes' : s.tier}</Chip> <span className="muted">{contractOf(s)!.duration_s}s in the cut</span></summary>
                  <p style={{ margin: '6px 0' }}>{contractOf(s)!.function}</p>
                  <p className="muted" style={{ margin: '0 0 6px', fontSize: 13 }}>{contractOf(s)!.composition}. {contractOf(s)!.camera}</p>
                  <ol className="contract-beats">{contractOf(s)!.timeline.map((b, i) => <li key={i}><time>{b.t[0].toFixed(1)}–{b.t[1].toFixed(1)}s</time><span>{b.who ? <b>{who(b.who).toUpperCase()} </b> : null}{b.do.replace(/@([A-Z]+)\d+/g, (_, n: string) => n.charAt(0) + n.slice(1).toLowerCase())}</span></li>)}</ol>
                  <p className="muted" style={{ margin: '6px 0 0', fontSize: 12 }}>Never: {contractOf(s)!.negative.join(' · ')}</p>
                </details>
              ) : null}
              {contractOf(s) && s.tool === 'veo' && generationConfigured() ? <FrameForge shotId={s.id} frames={framesFor(s.id)} centsEach={IMAGE_CENTS} /> : null}
              {s.tool !== 'edit' ? <ShotTakes shotId={s.id} tool={s.tool} prompt={s.prompt ?? s.description} takes={takesFor(s.id)} costLabel={costLabel(s.tier ?? 'production')} /> : null}
              {s.shot_code ? (
                <details className="shot-log">
                  <summary>Shot log</summary>
                  <ActionForm action={studioUpdateShotLog} className="form" style={{ gap: 6 }}>
                    <input type="hidden" name="id" value={s.id} />
                    {(s.shot_kind === 'source' ? LOG_FIELDS.filter(([k]) => k === 'sound') : LOG_FIELDS).map(([k, label]) => (
                      <label key={k} className="field"><span>{label}</span><input className="input" name={k} defaultValue={String((s.log as Record<string, unknown>)?.[k] ?? '')} /></label>
                    ))}
                    {s.shot_kind === 'source' ? (
                      <div className="row" style={{ gap: 6 }}>
                        <label className="field" style={{ flex: 1 }}><span>Source in (s)</span><input className="input" name="src_in" inputMode="decimal" defaultValue={String((s.log as Record<string, unknown>)?.src_in ?? '')} /></label>
                        <label className="field" style={{ flex: 1 }}><span>Source out (s)</span><input className="input" name="src_out" inputMode="decimal" defaultValue={String((s.log as Record<string, unknown>)?.src_out ?? '')} /></label>
                      </div>
                    ) : null}
                    <button className="btn small" type="submit" style={{ justifySelf: 'start' }}>Save shot log</button>
                  </ActionForm>
                </details>
              ) : null}
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

      {e.kind === 'episode' && checks.length ? (
        <Panel title={`Acceptance checks · ${passed}/${checks.length} passed`} sub="From the Character Bible. Watch once silent, once audio-only, at normal speed through the transitions, and on a phone-sized preview. Every check must pass before the episode can be approved.">
          {(['script', 'visual', 'brand'] as const).map((cat) => (
            <div key={cat} className="grid" style={{ gap: 0 }}>
              <b style={{ font: '700 12px var(--mono)', letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--muted)', marginTop: 6 }}>{cat === 'visual' ? 'Performance & visual' : cat}</b>
              {checks.filter((c) => c.cat === cat).map((c) => {
                const r = qa(c.key);
                return (
                  <div key={c.key} className={'qa-row' + (r ? (r.pass ? ' pass' : ' fail') : '')}>
                    <span>{r ? <b>{r.pass ? '✓ ' : '✕ '}</b> : null}{c.label}{r?.note ? <span className="muted" style={{ display: 'block', fontSize: 12 }}>{r.note}</span> : null}</span>
                    <ActionForm action={studioSetQa} className="row" style={{ gap: 4 }}>
                      <input type="hidden" name="episode" value={e.id} /><input type="hidden" name="key" value={c.key} /><input type="hidden" name="category" value={c.cat} />
                      <input className="input" name="note" placeholder="Note (required to fail)" aria-label="Note" style={{ width: 170 }} />
                      <button className="btn small" type="submit" name="pass" value="1">Pass</button>
                      <button className="btn small ghost" type="submit" name="pass" value="0">Fail</button>
                    </ActionForm>
                  </div>
                );
              })}
            </div>
          ))}
        </Panel>
      ) : null}

      <Panel title="Posting kit" sub={approved ? 'Approve each post, publish it by hand on the platform with its AI label on, then paste the live link.' : 'Posts can be approved once the episode’s final render is approved.'}>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,340px),1fr))', alignItems: 'start' }}>
          {(posts ?? []).map((p) => (
            <div key={p.id} className="tile" style={{ gap: 10 }}>
              <div className="spread"><b style={{ font: '800 16px var(--display)' }}>{PLATFORM[p.platform]}{p.method !== 'upload' ? <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}> · {p.method === 'stitch' ? 'Stitch' : 'Remix'}</span> : null}</b>{p.posted_url ? <a href={p.posted_url} target="_blank" rel="noreferrer"><Chip kind="done">live ↗</Chip></a> : <Chip kind={p.status === 'approved' ? 'info' : 'pending'}>{p.status}</Chip>}</div>
              {(() => {
                const opts = remixable.filter((s) => (p.platform === 'tiktok' ? s.platform === 'tiktok' : (p.platform === 'instagram' || p.platform === 'facebook') && s.platform === 'instagram'));
                const verb = p.platform === 'tiktok' ? 'stitch' : 'remix';
                if (!opts.length && p.method === 'upload') return null;
                const src = allSources.find((s) => s.id === p.source_id);
                return (
                  <div className="grid" style={{ gap: 6 }}>
                    {p.status !== 'posted' ? (
                      <ActionForm action={studioSetPostMethod} className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                        <input type="hidden" name="id" value={p.id} />
                        <select className="select" name="how" defaultValue={p.method === 'upload' ? 'upload' : `${p.method}:${p.source_id}`} aria-label="How it's posted" style={{ flex: 1, minWidth: 0 }}>
                          <option value="upload">Upload our full episode</option>
                          {opts.map((s) => <option key={s.id} value={`${verb}:${s.id}`}>{verb === 'stitch' ? 'Stitch' : 'Remix'} of “{s.title}”</option>)}
                        </select>
                        <button className="btn small ghost" type="submit">Set</button>
                      </ActionForm>
                    ) : null}
                    {p.method !== 'upload' && src ? (
                      <ol className="remix-steps">
                        <li>Export <b>our segment</b>: the final cut <b>from shot 2 on</b> (none of their footage comes from us).</li>
                        {p.method === 'stitch'
                          ? <li>In TikTok, open <a href={src.url} target="_blank" rel="noreferrer">the original</a> → Share → <b>Stitch</b> → keep their first ~5 seconds → Next → upload our segment from your gallery.</li>
                          : <li>In Instagram, open <a href={src.url} target="_blank" rel="noreferrer">the original reel</a> → ⋯ → <b>Remix</b> → <b>Add to end</b> → keep their first ~5 seconds → add our segment from your gallery.</li>}
                        <li>Paste the caption, turn on the AI label ({p.platform === 'tiktok' ? 'AI-generated content' : 'Advanced settings → AI info'}), post.</li>
                        <li>Come back and record the live link below. The platform credits and links the creator automatically.</li>
                      </ol>
                    ) : null}
                  </div>
                );
              })()}
              <ActionForm action={studioSavePost} className="form">
                <input type="hidden" name="id" value={p.id} />
                {p.platform === 'youtube' ? <label className="field"><span>Title</span><input className="input" name="title" defaultValue={p.title ?? ''} maxLength={100} disabled={p.status === 'posted'} /></label> : null}
                <label className="field"><span>Caption</span><textarea className="input" name="caption" rows={6} defaultValue={p.caption} maxLength={2200} disabled={p.status === 'posted'} /></label>
                <label className="field"><span>Post at (Eastern)</span><input className="input" type="datetime-local" name="when" defaultValue={etInput(p.scheduled_for)} disabled={p.status === 'posted'} /></label>
                {p.status !== 'posted' ? <button className="btn small" type="submit">Save edits</button> : null}
              </ActionForm>
              {thumb ? (
                <div className="row" style={{ gap: 10, alignItems: 'center' }}>
                  <img className="post-thumb" src={`/api/studio/thumb/${thumb.id}`} alt="Cover" loading="lazy" />
                  <span className="grid" style={{ gap: 4 }}><span className="muted" style={{ fontSize: 12 }}>Cover image</span><a className="btn small ghost" href={`/api/studio/thumb/${thumb.id}?download=1`}>Download 9:16</a></span>
                </div>
              ) : <span className="muted" style={{ fontSize: 12 }}>No cover yet: generate a thumbnail above.</span>}
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <CopyButton text={p.platform === 'youtube' && p.title ? `${p.title}\n\n${p.caption}` : p.caption} label="Copy caption" />
                <CopyButton text={p.link} label="Copy tracked link" />
              </div>
              <span className="muted" style={{ fontSize: 12 }}>{notes[p.platform]}</span>
              {p.status === 'draft' ? (
                <ActionForm action={studioApprovePost}><input type="hidden" name="id" value={p.id} /><button className="btn small primary" type="submit" disabled={!approved}>Approve this post</button></ActionForm>
              ) : null}
              {p.status === 'posted' ? (
                <details>
                  <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Performance{p.metrics_at ? ' ✓' : ''}</summary>
                  <ActionForm action={studioSaveMetrics} className="form" style={{ gap: 6 }}>
                    <input type="hidden" name="id" value={p.id} />
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      {([['retention_3s', '3s retention %', p.m_retention_3s], ['avg_watch', 'Avg watch %', p.m_avg_watch], ['completion', 'Completion %', p.m_completion], ['rewatches', 'Rewatches', p.m_rewatches], ['shares', 'Shares', p.m_shares], ['comments', 'Comments', p.m_comments], ['profile_visits', 'Profile visits', p.m_profile_visits]] as [string, string, number | null][]).map(([k, label, v]) => (
                        <label key={k} className="field" style={{ flex: '1 1 110px' }}><span>{label}</span><input className="input" name={k} inputMode="decimal" defaultValue={v ?? ''} /></label>
                      ))}
                    </div>
                    <label className="field"><span>At the two transitions (leaving and returning to the source)</span><input className="input" name="transition_note" defaultValue={p.m_transition_note ?? ''} placeholder="e.g. 8% drop at the fork, back up at the payoff" /></label>
                    <button className="btn small" type="submit" style={{ justifySelf: 'start' }}>Save metrics</button>
                  </ActionForm>
                </details>
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
