'use server';
// Helix Knows, the people side: keep what Helix suggested ("Remember this?"), add, edit or retire a memory, turn an
// answer into a note for the Helix notes inbox, and (admin) set cash on hand for runway. Every write is audited.
import { revalidatePath } from 'next/cache';
import { getViewer } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { adminDb } from '@/lib/supabase/admin';
import { HOUSE_SLUG } from '@/lib/phone-line';
import type { ActionResult } from '@/lib/actions';

type Out = { ok?: string; err?: string };
const DEPTS = ['sales', 'pipeline', 'clients', 'finance', 'studio', 'operations', 'general'];
const KINDS = ['fact', 'preference', 'outcome', 'goal'];

async function houseId() {
  const { data } = await adminDb().from('tenants').select('id').eq('slug', HOUSE_SLUG).single();
  return data?.id as string | undefined;
}

/** Keep one memory for the Genovus business (Enterprise Helix). */
export async function rememberEnterprise(m: { department: string; kind?: string; text: string; source?: 'conversation' | 'person' }): Promise<Out> {
  const v = await getViewer().catch(() => null);
  if (!v?.staff) return { err: 'Staff only.' };
  const tenant = await houseId();
  if (!tenant) return { err: 'The Genovus house account is missing.' };
  const { error } = await (await db()).rpc('remember', {
    p_tenant: tenant, p_department: DEPTS.includes(m.department) ? m.department : 'general', p_kind: KINDS.includes(m.kind ?? '') ? m.kind : 'fact',
    p_text: String(m.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 400), p_source: m.source === 'person' ? 'person' : 'conversation',
  });
  if (error) return { err: error.message === 'too short' ? 'Write a little more.' : error.message };
  revalidatePath('/console/helix', 'layout');
  return { ok: 'Helix will remember that.' };
}

/** Edit, retire or restore a memory. */
export async function decideMemory(id: string, status: 'kept' | 'retired' | '', text?: string, department?: string): Promise<Out> {
  const v = await getViewer().catch(() => null);
  if (!v?.staff) return { err: 'Staff only.' };
  const { error } = await (await db()).rpc('decide_memory', { p_id: id, p_status: status, p_text: text ?? null, p_department: department && DEPTS.includes(department) ? department : null });
  if (error) return { err: error.message };
  revalidatePath('/console/helix', 'layout');
  return { ok: status === 'retired' ? 'Retired: Helix no longer uses it.' : status === 'kept' ? 'Restored.' : 'Saved.' };
}

/** Turn something Helix said into an action item in the Helix notes inbox (the build agent can pick it up there). */
export async function helixNote(text: string): Promise<Out> {
  const v = await getViewer().catch(() => null);
  if (!v?.staff) return { err: 'Staff only.' };
  const t = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 600);
  if (t.length < 2) return { err: 'Empty note.' };
  const { error } = await adminDb().from('helix_notes').insert({ kind: 'action_item', text: t, chapter: 'helix', source: 'person' });
  if (error) return { err: 'The note could not be saved.' };
  revalidatePath('/console/helix');
  return { ok: 'Added to Helix notes.' };
}

/** Admin: cash on hand, so the Growth page and Helix can show runway. */
export async function setCashOnHand(_: ActionResult, f: FormData): Promise<ActionResult> {
  const dollars = Number(String(f.get('cash') ?? '').replace(/[$,\s]/g, ''));
  if (!Number.isFinite(dollars) || dollars < 0) return { err: 'Enter an amount.', at: Date.now() };
  const { error } = await (await db()).rpc('set_cash_on_hand', { p_cents: Math.round(dollars * 100) });
  revalidatePath('/console/growth');
  return error ? { err: error.message === 'admin only' ? 'Only an admin can set cash on hand.' : error.message, at: Date.now() } : { ok: 'Cash on hand saved: runway is updated.', at: Date.now() };
}
