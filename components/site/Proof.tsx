// "From agencies on Genovus": approved client words only (data/proof.ts). Renders nothing until there is one.
import { liveProof, GOOGLE_REVIEW_URL, type ProofItem } from '@/data/proof';

export function Proof({ items, compact }: { items?: ProofItem[]; compact?: boolean }) {
  const list = liveProof(items);
  if (!list.length) return null;
  return (
    <section className={compact ? 'proof compact' : 'wrapx sec proof'} id={compact ? undefined : 'proof'} data-proof>
      {compact ? null : <div className="eyebrow">From agencies on Genovus</div>}
      <div className="proof-grid">
        {list.slice(0, compact ? 1 : 3).map((p) => (
          <figure key={`${p.name}-${p.approvedOn}`} className="proof-card">
            <blockquote>“{p.quote}”</blockquote>
            <figcaption><b>{p.name}</b>, {p.role}, {p.agency}{p.place ? ` · ${p.place}` : ''}</figcaption>
          </figure>
        ))}
      </div>
      {!compact && GOOGLE_REVIEW_URL ? <a className="btn small" href={GOOGLE_REVIEW_URL} target="_blank" rel="noreferrer">Read our Google reviews</a> : null}
    </section>
  );
}
