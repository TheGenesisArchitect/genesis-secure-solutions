// The frame for the Growth Engine vision: the real dashboard shell, the ten chapters as its navigation, a
// chapter header, the screen itself, and "the spec behind this screen" beneath it, then previous/next.
import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { Chip } from '@/components/ui';
import { CHAPTERS } from '@/data/vision';

export type SpecItem = { k: string; v: React.ReactNode };

export function VisionShell({ slug, lede, spec, children }: { slug: string; lede: React.ReactNode; spec: { title: string; items: SpecItem[] }[]; children: React.ReactNode }) {
  const i = CHAPTERS.findIndex((c) => c.slug === slug);
  const ch = CHAPTERS[i];
  const prev = CHAPTERS[i - 1], next = CHAPTERS[i + 1];
  const href = (s: string) => (s ? `/vision/${s}` : '/vision');
  return (
    <Shell
      surface="Vision"
      home="/vision"
      title={ch.title}
      crumbs={[{ href: '/vision', label: 'Genovus Growth Engine' }, { label: `Chapter ${ch.n} of ${CHAPTERS.length}` }]}
      who={{ name: 'Growth Engine vision', detail: 'Sample data · the platform as it will be', signedOut: true }}
      nav={[{ title: 'The world', items: [{ href: '/vision/world', label: 'The whole platform', exact: true, icon: 'globe' }] }, { title: 'The story', items: CHAPTERS.map((c) => ({ href: href(c.slug), label: `${c.n}. ${c.short}`, exact: true, icon: c.icon })) }]}
      actions={<Chip kind="sample">Sample data</Chip>}
    >
      <div className="v-head">
        <span className="v-eyebrow">Chapter {ch.n} · The Genovus Growth Engine</span>
        <p className="v-lede">{lede}</p>
      </div>
      <div className="v-stage">{children}</div>
      <section className="v-spec" aria-label="The spec behind this screen">
        <div className="v-spec-head"><span className="v-eyebrow">The spec behind this screen</span></div>
        <div className="v-spec-grid">
          {spec.map((s) => (
            <div key={s.title} className="v-spec-card">
              <h3>{s.title}</h3>
              <dl>{s.items.flatMap((it, k) => [<dt key={k + 'k'}>{it.k}</dt>, <dd key={k + 'v'}>{it.v}</dd>])}</dl>
            </div>
          ))}
        </div>
      </section>
      <nav className="v-pager" aria-label="Chapters">
        {prev ? <Link className="btn ghost" href={href(prev.slug)}>← {prev.n}. {prev.short}</Link> : <span />}
        {next ? <Link className="btn primary" href={href(next.slug)}>{next.n}. {next.short} →</Link> : <Link className="btn primary" href="/vision">Back to the map ↺</Link>}
      </nav>
    </Shell>
  );
}

/** A link to an external source, for API and policy claims. */
export function Src({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer" className="v-src">{children}</a>;
}
