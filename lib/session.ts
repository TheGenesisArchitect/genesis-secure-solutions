// Who is signed in, and what they may open. Every dashboard page starts with one of the require* calls;
// row-level security still enforces the same rules in the database if a page check is ever missed.
import 'server-only';
import { cache } from 'react';
import { redirect, notFound } from 'next/navigation';
import { db } from './supabase/server';
import { supabaseConfigured } from './supabase/env';

export type StaffRole = 'admin' | 'account_lead' | 'operator' | 'reviewer';
export type Membership = { tenantId: string; slug: string; name: string; role: 'owner' | 'staff'; isSample: boolean };
export type Viewer = {
  userId: string;
  email: string;
  staff: { role: StaffRole; name: string } | null;
  memberships: Membership[];
  networks: { id: string; slug: string; name: string; isSample: boolean }[];
};

export const getViewer = cache(async (): Promise<Viewer | null> => {
  if (!supabaseConfigured()) return null;
  const supabase = await db();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const uid = auth.user.id;
  const [staff, members, nets] = await Promise.all([
    supabase.from('staff').select('role, display_name').eq('user_id', uid).maybeSingle(),
    supabase.from('memberships').select('role, tenants(id, slug, name, is_sample)').eq('user_id', uid),
    supabase.from('network_members').select('networks(id, slug, name, is_sample)').eq('user_id', uid),
  ]);
  type T = { id: string; slug: string; name: string; is_sample: boolean };
  return {
    userId: uid,
    email: auth.user.email ?? '',
    staff: staff.data ? { role: staff.data.role as StaffRole, name: staff.data.display_name } : null,
    memberships: (members.data ?? []).flatMap((m) => {
      const t = m.tenants as unknown as T | null;
      return t ? [{ tenantId: t.id, slug: t.slug, name: t.name, role: m.role as 'owner' | 'staff', isSample: t.is_sample }] : [];
    }),
    networks: (nets.data ?? []).flatMap((n) => {
      const t = n.networks as unknown as T | null;
      return t ? [{ id: t.id, slug: t.slug, name: t.name, isSample: t.is_sample }] : [];
    }),
  };
});

/** Where a signed-in person lands: staff in the console, agencies in their dashboard, networks in theirs. */
export function homeFor(v: Viewer): string {
  if (v.staff) return '/console';
  if (v.memberships.length) return `/app/${v.memberships[0].slug}`;
  if (v.networks.length) return '/network';
  return '/signin?e=no-access';
}

export async function requireViewer(): Promise<Viewer> {
  const v = await getViewer();
  if (!v) redirect('/signin');
  return v;
}

export async function requireStaff(): Promise<Viewer & { staff: NonNullable<Viewer['staff']> }> {
  const v = await requireViewer();
  if (!v.staff) redirect(homeFor(v));
  return v as Viewer & { staff: NonNullable<Viewer['staff']> };
}

/** A member of this agency, or staff viewing it as the agency would. */
export async function requireTenant(slug: string): Promise<{ viewer: Viewer; tenant: Membership; asStaff: boolean }> {
  const v = await requireViewer();
  const m = v.memberships.find((x) => x.slug === slug);
  if (m) return { viewer: v, tenant: m, asStaff: false };
  if (!v.staff) notFound();
  const supabase = await db();
  const { data } = await supabase.from('tenants').select('id, slug, name, is_sample').eq('slug', slug).maybeSingle();
  if (!data) notFound();
  return { viewer: v, tenant: { tenantId: data.id, slug: data.slug, name: data.name, role: 'owner', isSample: data.is_sample }, asStaff: true };
}

export async function requireNetwork(): Promise<Viewer> {
  const v = await requireViewer();
  if (!v.networks.length && !v.staff) redirect(homeFor(v));
  return v;
}
