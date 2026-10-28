// How one live post is doing, in a line: reach, then interactions and what they were. A post whose numbers haven't
// been read yet says so (never zero); a story says it's live for a day. Server-rendered, no client code.
import type { PostMetrics } from '@/lib/post-metrics';

const n = (v: number) => (v >= 10_000 ? `${Math.round(v / 1000)}K` : v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(v));

export type LivePost = { status: string; format: string; metrics: PostMetrics | null; published_at?: string | null };

export function PostEngagement({ p }: { p: LivePost }) {
  if (p.status !== 'published') return null;
  const m = p.metrics;
  if (!m) {
    const young = p.published_at && Date.now() - Date.parse(p.published_at) < 86_400_000;
    return <span className="muted" style={{ fontSize: 12.5 }}>{p.format === 'story' && young ? 'Live for 24 hours · numbers soon' : 'Numbers arrive a few hours after it posts'}</span>;
  }
  const parts = ([['likes', 'like'], ['comments', 'comment'], ['shares', 'share'], ['saves', 'save']] as const)
    .filter(([k]) => m[k]).map(([k, w]) => `${n(m[k]!)} ${w}${m[k] === 1 ? '' : 's'}`);
  return (
    <span style={{ fontSize: 13 }}>
      {m.reach != null ? <><b className="num">{n(m.reach)}</b> reached</> : m.views != null ? <><b className="num">{n(m.views)}</b> views</> : null}
      {m.interactions != null ? <>{m.reach != null || m.views != null ? ' · ' : ''}<b className="num">{n(m.interactions)}</b> interaction{m.interactions === 1 ? '' : 's'}</> : null}
      {parts.length ? <span className="muted"> ({parts.join(', ')})</span> : null}
    </span>
  );
}

export const NET: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', google: 'Google' };
