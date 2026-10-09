import { VisionShell, Src } from '@/components/vision/VisionShell';
import { Storyboard } from '@/components/vision/Storyboard';
import { SceneArt } from '@/components/vision/SceneArt';
import { PhoneShort } from '@/components/vision/PhoneShort';
import { Panel, Chip } from '@/components/ui';
import { SERIES, EPISODE } from '@/data/vision';

export const metadata = { title: 'Genovus Studio · Growth Engine vision', robots: { index: false, follow: false } };

const POSTERS = ['dawn', 'street', 'skyline', 'endcard'] as const;

export default function Studio() {
  return (
    <VisionShell
      slug="studio"
      lede={<>This is what makes the machine different. <b>Genovus Studio</b> makes original cinematic series and commercials that agents actually want to watch, on YouTube Shorts and Instagram Reels, from story bible to storyboard to finished short, every frame approved.</>}
      spec={[
        { title: 'Video models (provider adapter)', items: [
          { k: 'Veo 3.1', v: <>Cinematic shots with native audio via the Gemini API. <Src href="https://apiframe.ai/blog/best-ai-video-generation-apis">overview</Src></> },
          { k: 'Kling 3.0 · Runway', v: 'Multi-shot storyboards; character consistency across episodes.' },
          { k: 'Higgsfield', v: <>Cinema Studio camera direction, many models in one plan; API via enterprise access. <Src href="https://geo.higgsfield.ai/task/blog/higgsfield-ai-pricing-plans">plans</Src></> },
          { k: 'Not used', v: 'Sora (its API is being shut down).' },
        ] },
        { title: 'Publish', items: [
          { k: 'YouTube', v: <>Data API uploads: 100 per day; Shorts = vertical, under 60s. <Src href="https://postproxy.dev/blog/youtube-upload-api-guide/">guide</Src></> },
          { k: 'Instagram Reels', v: 'Graph API content publishing, on the calendar.' },
          { k: 'Render', v: 'Dedicated render worker (never serverless): 9:16, 1:1, 16:9 cuts, captions, end card with tracked link.' },
        ] },
        { title: 'Disclosure and rights', items: [
          { k: 'Labels', v: <>YouTube “altered or synthetic” disclosure for realistic AI footage; Meta “AI info” honored. <Src href="https://minimatters.com/youtube-ai-content-labeling-update-in-may-2026/">YouTube</Src> · <Src href="https://about.fb.com/news/2025/02/gen-ai-transparency-metas-ads-products/">Meta</Src></> },
          { k: 'Never', v: 'Carrier logos or mascots, real people without written consent, coverage or price claims.' },
          { k: 'Own it', v: 'Original characters and scripts; commercial-rights plans only; licensed music.' },
        ] },
      ]}
    >
      <div className="series">
        {SERIES.map((s, i) => (
          <article key={s.name} className="card">
            <SceneArt scene={POSTERS[i]} label={s.name} />
            <div className="info">
              <span className="v-eyebrow">{s.kind}</span>
              <h3>{s.name}</h3>
              <span className="muted" style={{ fontSize: 13 }}>{s.episodes} episodes · {s.status}</span>
              {s.views ? <span style={{ fontSize: 13 }}><b className="num">{s.views.toLocaleString('en-US')}</b> views · <b className="num">{s.watch}%</b> watch-through <Chip kind="sample">Sample</Chip></span> : <span className="muted" style={{ fontSize: 13 }}>Films only with written consent</span>}
            </div>
          </article>
        ))}
      </div>
      <div className="vgrid2" style={{ gridTemplateColumns: 'minmax(0,1.7fr) minmax(0,1fr)' }}>
        <Panel title={EPISODE.title} sub={EPISODE.logline} actions={<Chip kind="sample">Storyboard illustration</Chip>}>
          <Storyboard shots={EPISODE.shots} />
        </Panel>
        <Panel title="The finished short" sub="9:16 for Shorts and Reels · captions · tracked end card">
          <PhoneShort />
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>Preview built from the storyboard frames. The first real pilot episode is generated through this pipeline once the Veo key and a Higgsfield plan are connected.</p>
        </Panel>
      </div>
    </VisionShell>
  );
}
