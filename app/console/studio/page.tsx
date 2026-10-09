// Genovus Studio: the series, its episodes and the posting schedule, plus what each platform link brought in
// (Helix tours and inquiries by platform). Everything outward is approved here before it is published by hand.
import Link from 'next/link';
import { ConsoleShell } from '@/components/ConsoleShell';
import { ActionForm } from '@/components/ActionForm';
import { CopyButton } from '@/components/CopyButton';
import { Panel, Chip, Tile, Empty, money } from '@/components/ui';
import { requireStaff } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { resetDemoFollowUps, studioSetBudget } from '@/lib/actions';
import { CastSheets, type Ref } from '@/components/studio/StudioClient';
import { IMAGE_CENTS, generationConfigured } from '@/lib/studio-gen';

export const metadata = { title: 'Studio' };
export const dynamic = 'force-dynamic';

type Character = { name: string; role: string; look: string; sheet: string };
type Bible = { premise?: string; tone?: string; characters?: Character[]; rules?: string[]; tagline?: string; look?: string };
const PLATFORM: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube Shorts' };
const SRC: Record<string, string> = { fb: 'Facebook', ig: 'Instagram', tiktok: 'TikTok', yt: 'YouTube' };
const STAGE: Record<string, string> = { writing: 'pending', shooting: 'info', editing: 'info', review: 'pending', approved: 'done', live: 'done' };
const KIND: Record<string, string> = { teaser: 'Teaser', episode: 'Episode', proof: 'Proof' };
const when = (s: string | null) => (s ? new Date(s).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : 'Not scheduled');

export default async function Studio() {
  const viewer = await requireStaff();
  const supabase = await db();
  const [{ data: series }, { data: eps }, { data: shots }, { data: posts }, { data: tours }, { data: inq }] = await Promise.all([
    supabase.from('studio_series').select('*').order('created_at').limit(1).maybeSingle(),
    supabase.from('studio_episodes').select('id, code, kind, title, runtime_s, logline, status, sort').order('sort'),
    supabase.from('studio_shots').select('episode_id, status'),
    supabase.from('studio_posts').select('id, episode_id, platform, scheduled_for, status, posted_url').order('scheduled_for'),
    supabase.from('helix_tour_sessions').select('src, seconds').eq('campaign', 'gjk-soft-launch'),
    supabase.from('inquiries').select('source, campaigns!inner(slug)').eq('campaigns.slug', 'gjk-soft-launch'),
  ]);
  const [{ data: refRows }, { data: budget }, { data: spent }] = await Promise.all([
    supabase.from('studio_refs').select('id, character, status, canonical, error, created_at').order('created_at', { ascending: false }),
    supabase.from('studio_budget').select('monthly_cap_cents, approval_over_cents').maybeSingle(),
    supabase.rpc('studio_spent_cents'),
  ]);
  const [{ data: covers }, { data: takes }] = await Promise.all([
    supabase.from('studio_art').select('id, episode_id').eq('chosen', true).eq('status', 'ready'),
    supabase.from('studio_takes').select('id, kind, studio_shots!inner(n, studio_episodes!inner(code, title))').eq('status', 'ready').order('created_at', { ascending: false }).limit(12),
  ]);
  const coverFor = new Map((covers ?? []).map((c) => [c.episode_id, c.id]));
  const cap = budget?.monthly_cap_cents ?? 15000;
  const used = Number(spent ?? 0);
  const bible = (series?.bible ?? {}) as Bible;
  const epTitle = new Map((eps ?? []).map((e) => [e.id, e]));
  const posted = (posts ?? []).filter((p) => p.status === 'posted').length;
  const tourBy = (s: string) => (tours ?? []).filter((t) => t.src === s).length;
  const inqBy = (s: string) => (inq ?? []).filter((i) => i.source === s).length;
  return (
    <ConsoleShell title="Studio" crumbs={[{ href: '/console', label: 'Enterprise' }, { label: 'Studio' }]}>
      {series ? (
        <>
          <div className="studio-hero">
            <span className="v-eyebrow">{series.division} · Season 1</span>
            <h2>{series.name}</h2>
            <p className="soft">{series.logline}</p>
            {bible.tagline ? <b className="studio-tag">“{bible.tagline}”</b> : null}
          </div>
          <div className="grid g4">
            <Tile label="Episodes" value={<span className="num">{eps?.length ?? 0}</span>} hint={`${(eps ?? []).filter((e) => e.status === 'approved' || e.status === 'live').length} approved`} />
            <Tile label="Studio budget" value={<span className="num">{money(used)}</span>} hint={`of ${money(cap)} this month · ${Math.max(0, Math.round(100 - (100 * used) / Math.max(1, cap)))}% left`} />
            <Tile label="Posts live" value={<span className="num">{posted}/{posts?.length ?? 0}</span>} hint="Facebook, Instagram, TikTok, YouTube" />
            <Tile label="Helix tours from the campaign" value={<span className="num">{tours?.length ?? 0}</span>} hint={`${inq?.length ?? 0} inquiries credited`} />
          </div>

          <section className="gallery" aria-label="Season 1 gallery">
            {(eps ?? []).map((e) => {
              const s = (shots ?? []).filter((x) => x.episode_id === e.id);
              const p = (posts ?? []).filter((x) => x.episode_id === e.id);
              const cover = coverFor.get(e.id);
              return (
                <Link key={e.id} href={`/console/studio/${e.code}`} className="gv-poster">
                  {cover ? <img src={`/api/studio/thumb/${cover}`} alt={`${e.title} cover`} loading="lazy" /> : (
                    <span className="gv-poster-blank"><img src="/brand/genovus/genovus-egg.svg" alt="" /><b>{e.title}</b><small>Generate a thumbnail →</small></span>
                  )}
                  <span className="gv-poster-meta">
                    <span className="row" style={{ gap: 6 }}><Chip kind="info">{KIND[e.kind]}</Chip><Chip kind={STAGE[e.status]}>{e.status}</Chip></span>
                    <b>{e.title}</b>
                    <small>{e.runtime_s}s · shots {s.filter((x) => x.status === 'approved' || x.status === 'take_ok').length}/{s.length} · posts {p.filter((x) => x.status === 'posted').length}/{p.length}</small>
                  </span>
                </Link>
              );
            })}
          </section>
          {(takes ?? []).length ? (
            <Panel title="Fresh takes" sub="The latest shots out of the Studio">
              <div className="take-strip">
                {(takes ?? []).map((tk) => {
                  const sh = tk.studio_shots as unknown as { n: number; studio_episodes: { code: string; title: string } };
                  return (
                    <Link key={tk.id} href={`/console/studio/${sh.studio_episodes.code}`} className="take gv-take">
                      <video src={`/api/studio/media/take/${tk.id}#t=0.5`} muted playsInline preload="metadata" />
                      <span className="muted" style={{ fontSize: 12 }}>{sh.studio_episodes.title} · shot {sh.n}</span>
                    </Link>
                  );
                })}
              </div>
            </Panel>
          ) : null}

          <Panel title="Cast · the faces of Genovus" sub={generationConfigured() ? 'Generate a reference sheet for each character, then pick the one that becomes their look in every shot (Nano Banana Pro)' : 'Generation runs on genovus.io (the Gemini key lives in production)'}>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,300px),1fr))', alignItems: 'start' }}>
              {(bible.characters ?? []).map((ch) => (
                <div key={ch.name} className="tile" style={{ gap: 8 }}>
                  <span className="spread"><b style={{ font: '800 16px var(--display)' }}>{ch.name}</b><span className="muted" style={{ fontSize: 12 }}>{ch.role}</span></span>
                  <span className="soft" style={{ fontSize: 13 }}>{ch.look}</span>
                  <CastSheets seriesId={series.id} character={ch.name} prompt={ch.sheet} refs={((refRows ?? []) as Ref[]).filter((r) => r.character === ch.name)} costLabel={`${(IMAGE_CENTS / 100).toFixed(2)}`} />
                </div>
              ))}
            </div>
            {viewer.staff.role === 'admin' ? (
              <ActionForm action={studioSetBudget} className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
                <label className="field" style={{ width: 160 }}><span>Monthly cap (USD)</span><input className="input" name="cap" defaultValue={(cap / 100).toFixed(0)} inputMode="decimal" /></label>
                <label className="field" style={{ width: 220 }}><span>Admin needed above (USD)</span><input className="input" name="approval" defaultValue={((budget?.approval_over_cents ?? 500) / 100).toFixed(2)} inputMode="decimal" /></label>
                <button className="btn small" type="submit">Save budget</button>
              </ActionForm>
            ) : null}
          </Panel>


          <div className="grid g2" style={{ alignItems: 'start' }}>
            <Panel title="Posting schedule" sub="Eastern time · organic only · each post approved before it goes out">
              <div className="table-wrap">
                <table className="t">
                  <thead><tr><th>When</th><th>Episode</th><th>Platform</th><th>Status</th></tr></thead>
                  <tbody>
                    {(posts ?? []).map((p) => (
                      <tr key={p.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>{when(p.scheduled_for)}</td>
                        <td><Link href={`/console/studio/${epTitle.get(p.episode_id)?.code}`}>{epTitle.get(p.episode_id)?.title}</Link></td>
                        <td>{PLATFORM[p.platform]}</td>
                        <td>{p.posted_url ? <a href={p.posted_url} target="_blank" rel="noreferrer"><Chip kind="done">live ↗</Chip></a> : <Chip kind={p.status === 'approved' ? 'info' : 'pending'}>{p.status}</Chip>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
            <div className="grid" style={{ alignContent: 'start' }}>
              <Panel title="What each platform brings" sub="From the tracked links: Helix tours started and inquiries sent">
                <dl className="kv lines">
                  {Object.entries(SRC).flatMap(([k, l]) => [<dt key={`${k}-t`}>{l}</dt>, <dd key={`${k}-d`}>{tourBy(k)} tours · {inqBy(k)} inquiries</dd>])}
                </dl>
              </Panel>
              <Panel title="Filming kit" sub="The phone moment is the real app with a demo agency, never real customers">
                <p className="soft" style={{ margin: 0, fontSize: 14 }}>Reset the demo agency’s follow-ups so “Tomorrow · your list is ready” shows The Hendersons at 9:30, then open the page on a phone and screen-record.</p>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <ActionForm action={resetDemoFollowUps}><button className="btn small primary" type="submit">Reset demo follow-ups</button></ActionForm>
                  <Link className="btn small" href="/app/demo-brooks/follow-ups">Open the demo agency’s Follow-ups →</Link>
                </div>
              </Panel>
            </div>
          </div>

          <Panel title="Series bible" sub={bible.tone}>
            {bible.premise ? <p style={{ margin: 0 }}>{bible.premise}</p> : null}
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,280px),1fr))' }}>
              {(bible.characters ?? []).map((ch) => (
                <div key={ch.name} className="tile" style={{ gap: 8 }}>
                  <span className="spread"><b style={{ font: '800 16px var(--display)' }}>{ch.name}</b><span className="muted" style={{ fontSize: 12 }}>{ch.role}</span></span>
                  <span className="soft" style={{ fontSize: 13 }}>{ch.look}</span>
                  <span className="row" style={{ gap: 6 }}><CopyButton text={ch.sheet} label="Copy character-sheet prompt" /><span className="muted" style={{ fontSize: 11 }}>Nano Banana Pro</span></span>
                </div>
              ))}
            </div>
            {bible.look ? <p className="muted" style={{ margin: 0, fontSize: 13 }}><b>Look:</b> {bible.look}</p> : null}
            <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4, fontSize: 14 }}>{(bible.rules ?? []).map((r) => <li key={r}>{r}</li>)}</ul>
          </Panel>
        </>
      ) : <Panel><Empty title="No series yet">Load Season 1 with scripts/seed-studio.mjs.</Empty></Panel>}
    </ConsoleShell>
  );
}
