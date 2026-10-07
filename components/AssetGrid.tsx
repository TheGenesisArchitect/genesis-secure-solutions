// Asset cards for the library, client pages and agency dashboards. Private files (Blob) open through
// /api/assets/<id>, which checks the viewer's access before streaming; team-drive files show their path.
import { Chip } from './ui';

export type AssetRow = {
  id: string; kind: string; title: string; location_kind: string; location: string; preview: string | null;
  audience: string; rights_status: string; notes: string | null; is_sample: boolean; tenant_id?: string;
};

const KIND_LABEL: Record<string, string> = {
  film: 'Film', image: 'Image', kit: 'Social kit', deck: 'Deck', document: 'Document', page: 'Page', wizard: 'Setup wizard', site: 'Website', brand: 'Brand',
};

export function assetHref(a: AssetRow): string | null {
  if (a.location_kind === 'blob') return `/api/assets/${a.id}`;
  if (a.location_kind === 'file') return null;
  return a.location;
}

export function AssetGrid({ assets, showAudience, tenantNames }: { assets: AssetRow[]; showAudience?: boolean; tenantNames?: Map<string, string> }) {
  if (!assets.length) return <div className="empty"><b>No assets yet</b></div>;
  return (
    <div className="grid g3">
      {assets.map((a) => {
        const href = assetHref(a);
        const external = href?.startsWith('http');
        return (
          <article key={a.id} className="panel" style={{ padding: 14, gap: 10 }}>
            {a.preview ? <img className="thumb" src={a.preview} alt="" loading="lazy" /> : <div className="thumb" style={{ display: 'grid', placeItems: 'center', color: 'var(--muted)', font: '500 11px var(--mono)', letterSpacing: '.2em' }}>{(KIND_LABEL[a.kind] ?? a.kind).toUpperCase()}</div>}
            <div style={{ display: 'grid', gap: 6 }}>
              <div className="row" style={{ gap: 6 }}>
                <Chip>{KIND_LABEL[a.kind] ?? a.kind}</Chip>
                {showAudience ? <Chip kind={a.audience === 'internal' ? undefined : 'info'}>{a.audience}</Chip> : null}
                {a.rights_status === 'pending' || a.rights_status === 'restricted' ? <Chip kind="bad">Rights {a.rights_status}</Chip> : null}
                {a.is_sample ? <Chip kind="sample">Sample</Chip> : null}
              </div>
              <b style={{ fontSize: 15 }}>{a.title}</b>
              {tenantNames ? <span className="muted" style={{ fontSize: 13 }}>{tenantNames.get(a.tenant_id ?? '')}</span> : null}
              {a.notes ? <span className="soft" style={{ fontSize: 13 }}>{a.notes}</span> : null}
              {href ? (
                <a className="btn small" href={href} target={external || a.location_kind === 'blob' ? '_blank' : undefined} rel="noreferrer" style={{ justifySelf: 'start' }}>
                  Open{external ? ' ↗' : ''}
                </a>
              ) : (
                <span className="muted" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>Team drive: {a.location}</span>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
