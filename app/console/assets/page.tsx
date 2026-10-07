import Link from 'next/link';
import { ConsoleShell } from '@/components/ConsoleShell';
import { AssetGrid, type AssetRow } from '@/components/AssetGrid';
import { db } from '@/lib/supabase/server';

export const metadata = { title: 'Asset library' };
const KINDS = [['', 'All'], ['film', 'Films'], ['deck', 'Decks'], ['page', 'Pages'], ['wizard', 'Setup wizards'], ['kit', 'Social kits'], ['image', 'Images'], ['brand', 'Brand'], ['site', 'Websites'], ['document', 'Documents']] as const;

export default async function Assets({ searchParams }: { searchParams: Promise<{ kind?: string; client?: string }> }) {
  const sp = await searchParams;
  const supabase = await db();
  const { data: tenants } = await supabase.from('tenants').select('id, slug, name').order('name');
  let q = supabase.from('assets').select('*').order('kind').order('title');
  if (sp.kind) q = q.eq('kind', sp.kind);
  const client = (tenants ?? []).find((t) => t.slug === sp.client);
  if (client) q = q.eq('tenant_id', client.id);
  const { data } = await q;
  const names = new Map((tenants ?? []).map((t) => [t.id, t.name]));
  const link = (k: string, c?: string) => {
    const p = new URLSearchParams();
    if (k) p.set('kind', k);
    if (c) p.set('client', c);
    return '/console/assets' + (p.size ? `?${p}` : '');
  };
  return (
    <ConsoleShell title="Asset library" crumbs={[{ href: '/console', label: 'Enterprise' }, { label: 'Asset library' }]}>
      <p className="soft">Every film, deck, kit, page and wizard we have built, in one place, with who can see it and whether its rights are cleared.</p>
      <nav className="tabs" aria-label="Asset kind">
        {KINDS.map(([k, label]) => <Link key={k} href={link(k, sp.client)} aria-current={(sp.kind ?? '') === k ? 'page' : undefined}>{label}</Link>)}
      </nav>
      <div className="row" style={{ gap: 6 }}>
        <Link className={'btn small' + (!client ? ' primary' : '')} href={link(sp.kind ?? '')}>Every client</Link>
        {(tenants ?? []).map((t) => <Link key={t.id} className={'btn small' + (client?.id === t.id ? ' primary' : '')} href={link(sp.kind ?? '', t.slug)}>{t.name}</Link>)}
      </div>
      <AssetGrid assets={(data ?? []) as AssetRow[]} showAudience tenantNames={names} />
    </ConsoleShell>
  );
}
