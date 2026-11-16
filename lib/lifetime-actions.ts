'use server';
// The owner closes the founding-client congratulations card on Home (components/LifetimeCongrats.tsx). Staff
// viewing the dashboard can't close it for the client. "Your program" keeps the lifetime details for good.
import { revalidatePath } from 'next/cache';
import { requireTenant } from './session';
import { adminDb } from './supabase/admin';
import type { ActionResult } from './actions';

export async function closeLifetimeCongrats(_: ActionResult, f: FormData): Promise<ActionResult> {
  const slug = String(f.get('slug') ?? '').slice(0, 80);
  const { tenant, asStaff } = await requireTenant(slug);
  if (asStaff) return { err: 'Only the agency owner can close this card, so they see it first.', at: Date.now() };
  if (tenant.role !== 'owner') return { err: 'Only the agency owner can close this card.', at: Date.now() };
  const { error } = await adminDb().from('tenants').update({ lifetime_seen_at: new Date().toISOString() }).eq('id', tenant.tenantId).is('lifetime_seen_at', null);
  revalidatePath(`/app/${slug}`);
  return error ? { err: error.message, at: Date.now() } : { ok: 'Thank you for being our first client.', at: Date.now() };
}
