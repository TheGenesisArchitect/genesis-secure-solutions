'use server';
// Send a pick-a-time consultation link (outward: a person's tap; Helix may fill it but never sends it). One private
// link for everyone on the invitation; whoever picks, the invite goes to all of them (lib/consult.ts).
import { revalidatePath } from 'next/cache';
import { db } from './supabase/server';
import { adminDb } from './supabase/admin';
import type { ActionResult } from './actions';
import { consultToken } from './consult';

const s = (f: FormData, k: string, n: number) => String(f.get(k) ?? '').trim().slice(0, n);

export async function sendConsultLink(_: ActionResult, f: FormData): Promise<ActionResult> {
  const supabase = await db();
  const label = s(f, 'label', 120), emails = s(f, 'emails', 600), minutes = Number(s(f, 'minutes', 3)) || 60, prospect = s(f, 'prospect', 64) || null;
  if (label.length < 2) return { err: 'Say who the consultation is for.', at: Date.now() };
  const { data: id, error } = await supabase.rpc('create_consult_invite', { p_label: label, p_emails: emails, p_minutes: minutes, p_prospect: prospect });
  if (error || !id) return { err: error?.message ?? 'The link couldn’t be created.', at: Date.now() };
  const token = consultToken(id as string);
  if (!token) return { err: 'Consultation links aren’t set up on this deployment (no signing secret).', at: Date.now() };
  const admin = adminDb();
  const { data: ci } = await admin.from('consult_invites').select('tenant_id, emails').eq('id', id).single();
  const { data: me } = await supabase.auth.getUser();
  const { data: staff } = me.user ? await admin.from('staff').select('display_name').eq('user_id', me.user.id).maybeSingle() : { data: null };
  const origin = process.env.APP_ORIGIN || 'https://genovus.io';
  for (const to of (ci?.emails ?? []) as string[]) {
    await admin.from('outbox').insert({ tenant_id: ci!.tenant_id, to_email: to, template: 'consult_pick', data: { label, minutes: String(minutes), link: `${origin}/book/${token}`, from_name: staff?.display_name || 'the Genovus team', from_email: me.user?.email ?? '' }, dedupe_key: `consult:${id}:${to}` });
  }
  revalidatePath('/', 'layout');
  return { ok: `Pick-a-time link sent to ${(ci?.emails ?? []).join(', ')}. When they pick, the invite goes to all of them and the session lands on your calendar.`, at: Date.now() };
}
