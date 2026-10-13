// The Studio's front door, built like a streaming service home: one featured title on a billboard, then rows of
// box art for what's finished, what's coming soon, and the proofs. Every card opens its board. Server component.
import Link from 'next/link';
import { PlayButton, ScenePlayer } from '@/components/studio/ScenePlayer';

export type HomeEpisode = { id: string; code: string; kind: string; title: string; runtime_s: number | null; logline: string | null; status: string; final_blob?: string | null };
type Props = { episodes: HomeEpisode[]; covers: Map<string, string>; progress: Map<string, { done: number; total: number }>; featured?: string; current?: Set<string> };

const finished = (e: HomeEpisode) => e.status === 'approved' || e.status === 'live';
const KIND: Record<string, string> = { teaser: 'Trailer', episode: 'Episode', proof: 'Proof' };
// Titles cast with the V2 ensemble get the ensemble key art until their own cover exists.
const V2 = new Set(['gjk-h01']);

function Art({ e, cover }: { e: HomeEpisode; cover?: string }) {
  if (cover) return <img className="sx-art" src={`/api/studio/thumb/${cover}`} alt="" loading="lazy" />;
  if (V2.has(e.code)) return <img className="sx-art" src="/studio/cast/ensemble.jpg" alt="" loading="lazy" />;
  return <span className="sx-blank" aria-hidden="true"><img src="/brand/genovus/genovus-egg.svg" alt="" /></span>;
}

function Card({ e, cover, p }: { e: HomeEpisode; cover?: string; p?: { done: number; total: number } }) {
  const done = finished(e);
  return (
    <Link href={`/console/studio/${e.code}`} className="sx-card" aria-label={`${e.title}, ${done ? 'finished' : 'coming soon'}`}>
      <Art e={e} cover={cover} />
      {e.final_blob ? <PlayButton big clips={[{ src: `/api/studio/media/final/${e.id}`, title: e.title }]} /> : null}
      <span className={`sx-badge ${done ? 'new' : 'soon'}`}>{done ? (e.status === 'live' ? 'Now streaming' : 'New') : 'Coming soon'}</span>
      <span className="sx-info">
        <b>{e.title}</b>
        <small>{KIND[e.kind] ?? e.kind} · {e.runtime_s ?? '—'}s{p && p.total ? ` · ${p.done}/${p.total} shots` : ''}</small>
      </span>
      {p && p.total && !done ? <span className="sx-progress" aria-hidden="true"><i style={{ width: `${Math.round((p.done / p.total) * 100)}%` }} /></span> : null}
    </Link>
  );
}

function Row({ title, sub, items, covers, progress }: { title: string; sub: string; items: HomeEpisode[]; covers: Props['covers']; progress: Props['progress'] }) {
  if (!items.length) return null;
  return (
    <section className="sx-row" aria-label={title}>
      <div className="sx-row-head"><h3>{title}</h3><span>{sub}</span></div>
      <div className="sx-track">{items.map((e) => <Card key={e.id} e={e} cover={covers.get(e.id)} p={progress.get(e.id)} />)}</div>
    </section>
  );
}

export function StudioHome({ episodes: all, covers, progress, featured, current }: Props) {
  // Episodes not made with the current cast (the development era, including retired codes) go to the archive.
  const episodes = current ? all.filter((e) => current.has(e.code)) : all;
  const vault = current ? all.filter((e) => !current.has(e.code)) : [];
  const hero = episodes.find((e) => e.code === featured) ?? episodes.find((e) => !finished(e)) ?? episodes[0];
  const cover = hero ? covers.get(hero.id) : undefined;
  const p = hero ? progress.get(hero.id) : undefined;
  const done = episodes.filter(finished);
  const soon = episodes.filter((e) => !finished(e) && e.kind !== 'proof');
  const proofs = episodes.filter((e) => !finished(e) && e.kind === 'proof');
  return (
    <div className="sx">
      <ScenePlayer />
      {hero ? (
        <section className="sx-bill" aria-label={`Featured: ${hero.title}`}>
          {cover ? <img className="sx-bill-art" src={`/api/studio/thumb/${cover}`} alt="" /> : <img className="sx-bill-art" src={V2.has(hero.code) ? '/studio/cast/ensemble.jpg' : '/studio/cast/ensemble.jpg'} alt="" />}
          <div className="sx-bill-shade" aria-hidden="true" />
          <div className="sx-bill-copy">
            <span className="sx-eyebrow"><img src="/brand/genovus/genovus-egg.svg" alt="" />Genovus Originals · {KIND[hero.kind] ?? 'Episode'}</span>
            <h2>{hero.title}</h2>
            <span className="sx-meta"><b className={finished(hero) ? 'ok' : 'soon'}>{finished(hero) ? 'Now streaming' : 'Coming soon'}</b>{hero.runtime_s ? <span>{hero.runtime_s}s</span> : null}<span>Marcus · Tasha · Julian</span>{p && p.total ? <span>{p.done}/{p.total} shots</span> : null}</span>
            {hero.logline ? <p>{hero.logline}</p> : null}
            <span className="sx-actions">
              {hero.final_blob ? <PlayButton clips={[{ src: `/api/studio/media/final/${hero.id}`, title: hero.title }]} /> : null}
              <Link className={hero.final_blob ? 'sx-btn' : 'sx-btn play'} href={`/console/studio/${hero.code}`}>{hero.final_blob ? 'Open the board' : '▶ Open the production board'}</Link>
              <Link className="sx-btn" href="/console/studio/cast">The cast</Link>
              <Link className="sx-btn" href="/console/studio/library">Screen Library</Link>
            </span>
          </div>
        </section>
      ) : null}
      <Row title="Coming soon" sub="In production now" items={soon} covers={covers} progress={progress} />
      <Row title="Finished" sub="Approved and ready to post" items={done} covers={covers} progress={progress} />
      <Row title="Proofs & pilots" sub="Tests that shape the series" items={proofs} covers={covers} progress={progress} />
      <Row title="Archive · development cast" sub="Made with Maya, Trent and Bri, now retired. Kept for the record." items={vault} covers={covers} progress={progress} />
    </div>
  );
}
