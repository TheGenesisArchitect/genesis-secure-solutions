import { VisionShell, Src } from '@/components/vision/VisionShell';
import { SceneArt, POST_SCENES } from '@/components/vision/SceneArt';
import { Panel, Chip } from '@/components/ui';
import { POSTS } from '@/data/vision';

export const metadata = { title: 'Content Desk · Growth Engine vision', robots: { index: false, follow: false } };

const NET = { facebook: { cls: 'fb', label: 'Facebook', meta: 'Sponsored · Genovus' }, instagram: { cls: 'ig', label: 'Instagram', meta: 'genovus.io' }, linkedin: { cls: 'li', label: 'LinkedIn', meta: 'Genovus · Marketing technology' } } as const;
const STATE = ['Approved · Mon 9:00 AM', 'Approved · Tue 12:30 PM', 'Needs your approval', 'Approved · Thu 6:00 PM'];

export default function ContentDesk() {
  return (
    <VisionShell
      slug="content"
      lede={<>The Content Desk writes <b>for each audience</b>: State Farm agents, independents, new owners, Spanish-speaking agents. Every draft passes a compliance check before a person sees it, then goes onto the calendar for Facebook, Instagram and LinkedIn.</>}
      spec={[
        { title: 'Publishing APIs', items: [
          { k: 'Facebook Pages', v: <>Graph API page posts and scheduling, after Meta app review. <Src href="https://developers.facebook.com/docs/pages-api/posts">docs</Src></> },
          { k: 'Instagram', v: <>Content Publishing API: 100 API posts per account per 24 hours. <Src href="https://developers.facebook.com/documentation/instagram-platform/content-publishing">docs</Src></> },
          { k: 'LinkedIn', v: <>Company page posts via the Community Management API (approval required). <Src href="https://learn.microsoft.com/en-us/linkedin/marketing/integrations/marketing-tiers">tiers</Src></> },
        ] },
        { title: 'Compliance check (Verified Work)', items: [
          { k: 'Carriers', v: 'Named in text only; no logos or mascots; no implied partnership.' },
          { k: 'Claims', v: 'No quotes, coverage or price claims; outcome claims need proof.' },
          { k: 'Language', v: 'Spanish copy reviewed by a person before approval.' },
        ] },
        { title: 'Model', items: [
          { k: 'Tables', v: <><code>content_items</code> (exists) + series, audience, network, market, scheduled_for, insights.</> },
          { k: 'Flow', v: 'Draft (Content agent) → check (Verified Work) → approve (Lane 3) → schedule → publish → insights.' },
        ] },
      ]}
    >
      <div className="spread"><div className="row" style={{ gap: 8 }}>{['State Farm agents', 'Independent agencies', 'New agency owners', 'Spanish-speaking agents'].map((a) => <Chip key={a} kind="info">{a}</Chip>)}</div><Chip kind="sample">Sample posts</Chip></div>
      <div className="vgrid3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,260px),1fr))' }}>
        {POSTS.map((p, i) => {
          const n = NET[p.network];
          return (
            <div key={p.id} style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
              <div className="spread"><b style={{ fontSize: 13 }}>{n.label} · {p.audience}</b><Chip kind={STATE[i].startsWith('Needs') ? 'pending' : 'done'}>{STATE[i]}</Chip></div>
              <article className={`post ${n.cls}`}>
                <div className="post-top"><span className="av"><img src="/brand/genovus/genovus-mark.svg" alt="" /></span><span><b>Genovus</b><small>{n.meta}</small></span></div>
                <div className="art"><SceneArt scene={POST_SCENES[i % POST_SCENES.length]} label={p.hook} /><span className="hook">{p.hook}</span></div>
                <div className="body">{p.body}</div>
                <div className="meta"><span>genovus.io/for/captive-agents?c=columbus-organic</span><span>{p.network === 'linkedin' ? 'Like · Comment · Repost' : '♡ 💬 ↗'}</span></div>
              </article>
              <div className={`check ${p.check}`}><span>{p.check === 'pass' ? '✓' : '⚑'}</span><span><b style={{ color: 'var(--ink)' }}>{p.check === 'pass' ? 'Passed' : 'Fixed before review'}:</b> {p.note}</span></div>
            </div>
          );
        })}
      </div>
      <Panel title="This month’s series plan" sub="Columbus warm-up · 4 audiences × 3 posts + 2 Studio shorts" actions={<Chip kind="sample">Sample</Chip>}>
        <div className="grid g4">
          {[['Week 1', 'Neighbors are searching · local demand'], ['Week 2', 'Before / after: a Columbus office (sample)'], ['Week 3', 'The Local Office S1E1 premiere'], ['Week 4', 'Ask us anything: live Q&A + booking link']].map(([w, d]) => (
            <div key={w} className="tile"><span className="label">{w}</span><span style={{ fontWeight: 600 }}>{d}</span></div>
          ))}
        </div>
      </Panel>
    </VisionShell>
  );
}
