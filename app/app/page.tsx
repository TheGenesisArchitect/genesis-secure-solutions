import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireViewer } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { Shell } from '@/components/Shell';
import { EcosystemSwitcher } from '@/components/EcosystemSwitcher';
import { Chip, Empty, STAGE_LABEL, PLAN_LABEL, type Stage } from '@/components/ui';

export const metadata = { title: 'Agencies' };

// app.genovus.io lands here. One agency: straight in. Several, or the Genovus team: a searchable list.
export default async function AgencyPicker({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const v = await requireViewer();
  const q = (await searchParams).q?.trim().slice(0, 80) ?? '';
  if (!v.staff && v.memberships.length === 1) redirect(`/app/${v.memberships[0].slug}`);
  if (!v.staff && !v.memberships.length) redirect(v.networks.length ? '/network' : '/signin?e=no-access');
  const supabase = await db();
  let query = supabase.from('tenants').select('slug, name, stage, plan, is_sample').eq('kind', 'agency').order('is_sample').order('name').limit(200);
  if (q) query = query.ilike('name', `%${q.replace(/[%_]/g, '')}%`);
  const { data } = await query;
  const rows = data ?? [];
  return (
    <Shell
      surface="Agency"
      home="/app"
      title={v.staff ? 'Agencies' : 'Your agencies'}
      who={{ name: v.staff?.name ?? v.email, detail: v.staff ? 'Genovus team' : 'Agency member' }}
      switcher={<EcosystemSwitcher current="agency" />}
      back={v.staff ? { href: '/console', label: 'Enterprise' } : undefined}
      nav={[{ items: [{ href: '/app', label: 'All agencies', exact: true }] }]}
    >
      <form className="row" role="search">
        <input className="input" name="q" defaultValue={q} placeholder="Search agencies by name" aria-label="Search agencies" style={{ flex: 1, minWidth: 200 }} />
        <button className="btn" type="submit">Search</button>
      </form>
      {rows.length ? (
        <div className="grid g3">
          {rows.map((t) => (
            <Link key={t.slug} href={`/app/${t.slug}`} className="card" style={{ padding: 16 }}>
              <div className="spread" style={{ flexWrap: 'nowrap' }}><b>{t.name}</b>{t.is_sample ? <Chip kind="sample">Sample</Chip> : null}</div>
              <small>{STAGE_LABEL[t.stage as Stage]} · {t.plan ? PLAN_LABEL[t.plan] : 'Plan not set'}</small>
            </Link>
          ))}
        </div>
      ) : (
        <Empty title={q ? `No agency matches “${q}”` : 'No agencies yet'} />
      )}
    </Shell>
  );
}
