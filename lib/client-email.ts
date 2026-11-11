'use server';
// The client page's Client email panel: schedule a site review or a note, send yourself a test, or cancel one before
// the outbox picks it up. Outward: an admin or account lead taps it. The work is in lib/client-email-core.ts, shared
// with the team's ops endpoint (app/api/ops/client-emails), so both run the same checks.
import { revalidatePath } from 'next/cache';
import { db } from './supabase/server';
import type { ActionResult } from './actions';
import { scheduleNote, scheduleSiteReview, cancelClientEmail, type Actor, type CoreResult } from './client-email-core';

async function actor(): Promise<Actor | null> {
  const supabase = await db();
  const { data } = await supabase.rpc('has_role', { roles: ['admin', 'account_lead'] });
  const { data: me } = await supabase.auth.getUser();
  return data && me.user ? { id: me.user.id, email: me.user.email ?? '', label: me.user.email ?? 'staff' } : null;
}

const result = (r: CoreResult): ActionResult => {
  if (r.ok) revalidatePath('/', 'layout');
  return r.ok ? { ok: r.message, at: Date.now() } : { err: r.error, at: Date.now() };
};
const denied: ActionResult = { err: 'Only an admin or account lead can send client email.', at: Date.now() };

export async function scheduleClientEmailAction(_: ActionResult, f: FormData): Promise<ActionResult> {
  const me = await actor();
  return me ? result(await scheduleNote(f, me)) : denied;
}

export async function scheduleSiteReviewAction(_: ActionResult, f: FormData): Promise<ActionResult> {
  const me = await actor();
  return me ? result(await scheduleSiteReview(f, me)) : denied;
}

export async function cancelClientEmailAction(_: ActionResult, f: FormData): Promise<ActionResult> {
  const me = await actor();
  return me ? result(await cancelClientEmail(Number(String(f.get('id') ?? '')), String(f.get('tenant') ?? ''), me)) : denied;
}
