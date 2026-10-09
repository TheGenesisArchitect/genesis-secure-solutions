import { VisionShell, Src } from '@/components/vision/VisionShell';
import { Storyboard } from '@/components/vision/Storyboard';
import { SceneArt, type Scene } from '@/components/vision/SceneArt';
import { PhoneShort } from '@/components/vision/PhoneShort';
import { Panel, Chip } from '@/components/ui';
import { SERIES, EPISODE, PILOTS } from '@/data/vision';

export const metadata = { title: 'Genovus Studio · Growth Engine vision', robots: { index: false, follow: false } };

export default function Studio() {
  return (
    <VisionShell
      slug="studio"
      lede={<>A <b>production studio</b>, not an ad generator: stories people choose to watch, where the product earns its place in the story. Two divisions share one production system. <b>Genovus Originals</b> win agencies; <b>Agency Originals</b> help agencies reach their communities.</>}
      spec={[
        { title: 'Shot-based production', items: [
          { k: 'Unit', v: 'The shot: a failed take is regenerated without touching the approved edit.' },
          { k: 'Layers', v: 'Footage (expensive, per shot) vs edit (cheap, reproducible). Logos, captions, legal text and product screens live in the edit layer.' },
          { k: 'Approval', v: 'Bound to the exact render hash; material edits invalidate it.' },
          { k: 'Software shots', v: 'Real screen captures or deterministic renders; AI never invents dashboard text or features.' },
        ] },
        { title: 'Models (replaceable)', items: [
          { k: 'Candidates', v: <>Veo 3.1, Kling 3.0, Runway, Higgsfield behind one adapter. <Src href="https://ai.google.dev/gemini-api/docs/veo">Veo</Src> · <Src href="https://geo.higgsfield.ai/task/blog/higgsfield-ai-pricing-plans">Higgsfield</Src></> },
          { k: 'Bake-off', v: 'Same representative shots; chosen on usable takes, cost, latency and revision burden.' },
          { k: 'Economics', v: 'Cost per accepted asset, not per clip. Budget reserved before generation; reconcile with the provider before any retry.' },
        ] },
        { title: 'Trust', items: [
          { k: 'Disclosure', v: <>Synthetic-content labels travel with the asset. <Src href="https://support.google.com/youtube/answer/14328491">YouTube</Src> · <Src href="https://about.fb.com/news/2025/02/gen-ai-transparency-metas-ads-products/">Meta</Src></> },
          { k: 'Consumer rule', v: '“Here is something worth reviewing.” Never implies someone is missing coverage or that a loss will be covered.' },
          { k: 'Rights', v: 'Asset manifest per project: footage origin, consent, music, carrier-mark permission by asset and use.' },
        ] },
      ]}
    >
      <div className="series" data-tour="series" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,300px),1fr))' }}>
        {SERIES.map((s) => (
          <article key={s.name} className="card">
            <SceneArt scene={s.scene as Scene} label={s.name} />
            <div className="info">
              <span className="division">{s.division}</span>
              <h3>{s.name}</h3>
              <span className="muted" style={{ fontSize: 13 }}>{s.kind} · {s.episodes} episodes · {s.status}</span>
              {s.views ? <span style={{ fontSize: 13 }}><b className="num">{s.views.toLocaleString('en-US')}</b> views · <b className="num">{s.watch}%</b> watch-through <Chip kind="sample">Sample</Chip></span> : <span className="muted" style={{ fontSize: 13 }}>Not released yet</span>}
            </div>
          </article>
        ))}
      </div>
      <div className="vgrid2" style={{ gridTemplateColumns: 'minmax(0,1.7fr) minmax(0,1fr)' }}>
        <Panel tour="storyboard" title={EPISODE.title} sub={EPISODE.logline} actions={<Chip kind="sample">Storyboard illustration</Chip>}>
          <Storyboard shots={EPISODE.shots} />
        </Panel>
        <Panel tour="phone" title="The finished short" sub="9:16 for Shorts and Reels · captions · tracked end card">
          <PhoneShort />
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>Preview built from the storyboard frames. Real episodes are produced shot by shot once the provider bake-off picks the models.</p>
        </Panel>
      </div>
      <Panel tour="pilots" title="First production milestone: two pilots" sub="Same workflow end to end; each ships with script, storyboard, references, finished edit, alternate hook, tracked destination and a cost record">
        <div className="vgrid2">
          {PILOTS.map((p) => (
            <div key={p.name} className="tile" style={{ gap: 10 }}>
              <span className="division">{p.division}</span>
              <h3 style={{ margin: 0, font: '800 18px var(--display)' }}>{p.name}</h3>
              <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4, fontSize: 14, color: 'var(--soft)' }}>{p.beats.map((b) => <li key={b}>{b}</li>)}</ol>
              <b style={{ font: '800 15px var(--display)' }}>End card: {p.end}</b>
            </div>
          ))}
        </div>
      </Panel>
    </VisionShell>
  );
}
