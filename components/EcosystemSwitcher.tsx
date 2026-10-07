// Move across the ecosystem without signing in again: the team gets Enterprise · Agencies · Carriers,
// people with several agencies get their agencies, and network partners see only their own portal.
// Lists come from what row-level security returns, so nobody is offered a place they cannot open.
import Link from 'next/link';
import { getViewer } from '@/lib/session';
import { db } from '@/lib/supabase/server';

export type Surface = 'enterprise' | 'agency' | 'carrier';

export async function EcosystemSwitcher({ current, slug }: { current: Surface; slug?: string }) {
  const v = await getViewer();
  if (!v) return null;
  const supabase = await db();
  const agencies = v.staff
    ? ((await supabase.from('tenants').select('slug, name, is_sample').eq('kind', 'agency').order('is_sample').order('name').limit(13)).data ?? [])
    : v.memberships.map((m) => ({ slug: m.slug, name: m.name, is_sample: m.isSample }));
  const networks = v.staff ? ((await supabase.from('networks').select('slug, name').order('name')).data ?? []) : v.networks;
  const showAgencies = v.staff || agencies.length > 1;
  const showCarriers = v.staff || (v.networks.length > 0 && (agencies.length > 0 || networks.length > 1));
  if (!v.staff && !showAgencies && !showCarriers) return null;
  const currentAgency = agencies.find((a) => a.slug === slug);
  return (
    <nav className="eco" aria-label="Switch workspace">
      {v.staff ? <Link href="/console" aria-current={current === 'enterprise' ? 'page' : undefined}>Enterprise</Link> : null}
      {showAgencies ? (
        <details className="eco-menu">
          <summary aria-current={current === 'agency' ? 'page' : undefined}>{current === 'agency' && currentAgency ? currentAgency.name : 'Agencies'}</summary>
          <div className="eco-list">
            {agencies.slice(0, 12).map((a) => (
              <Link key={a.slug} href={`/app/${a.slug}`} aria-current={a.slug === slug ? 'page' : undefined}>
                {a.name}{a.is_sample ? <span className="chip sample" style={{ marginLeft: 6 }}>Sample</span> : null}
              </Link>
            ))}
            <Link href="/app" className="muted">{v.staff ? 'Find an agency…' : 'All my agencies'}</Link>
          </div>
        </details>
      ) : null}
      {showCarriers ? (
        <Link href="/network" aria-current={current === 'carrier' ? 'page' : undefined}>{networks.length === 1 && !v.staff ? networks[0].name : 'Carriers'}</Link>
      ) : null}
    </nav>
  );
}
