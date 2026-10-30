// Where a first consultation's follow-up stands (migration 0090): the steps for how the call went, which were sent,
// the next one and when it's due, or why none can go. The database decides (consult_followup_block); this shapes it
// for the consult page and the Command Brief. Drafts come from data/consult-followups.ts.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminDb } from './supabase/admin';
import { consultToken } from './consult';
import { stepsFor, followupDraft, type FollowupStep } from '@/data/consult-followups';

const DAY = 86_400_000;
type One<T> = T | T[] | null;
const one = <T,>(x: One<T>): T | null => (Array.isArray(x) ? x[0] ?? null : x);

export type FollowupState = {
  invite: string; label: string; first: string; org: string; goal: string | null; emails: string[]; outcome: string | null;
  steps: { step: FollowupStep; label: string; dueAt: string; sent: { at: string; subject: string } | null }[];
  next: { step: FollowupStep; label: string; dueAt: string; due: boolean } | null;
  blocked: string | null; stopped: boolean;
};

export async function followupState(db: SupabaseClient, invite: string): Promise<FollowupState | null> {
  const { data: c } = await db.from('consult_invites')
    .select('id, label, emails, outcome, followups_stopped_at, event:calendar_events!consult_invites_event_id_fkey(ends_at), inquiry:inquiries(org, details), prospect:prospects(known_name)')
    .eq('id', invite).maybeSingle();
  if (!c) return null;
  const [{ data: blocked }, { data: sent }] = await Promise.all([
    db.rpc('consult_followup_block', { p_invite: invite }),
    db.from('consult_followups').select('step, subject, sent_at').eq('invite_id', invite),
  ]);
  const ends = one(c.event as One<{ ends_at: string }>)?.ends_at;
  const inq = one(c.inquiry as One<{ org: string; details: Record<string, string> | null }>);
  const pr = one(c.prospect as One<{ known_name: string | null }>);
  const steps = stepsFor(c.outcome).map((s) => {
    const done = (sent ?? []).find((x) => x.step === s.step);
    return { step: s.step, label: s.label, dueAt: new Date(Date.parse(ends ?? '') + s.day * DAY).toISOString(), sent: done ? { at: done.sent_at as string, subject: done.subject as string } : null };
  });
  const n = ends ? steps.find((s) => !s.sent) : undefined;
  const label = c.label as string;
  return {
    invite, label, first: label.split(/[ ,]/)[0], org: inq?.org || pr?.known_name || label.split(',').slice(1).join(',').trim() || 'your agency',
    goal: inq?.details?.goals ?? null, emails: c.emails as string[], outcome: c.outcome as string | null,
    steps, next: n ? { step: n.step, label: n.label, dueAt: n.dueAt, due: Date.parse(n.dueAt) <= Date.now() + 2 * 3_600_000 } : null,
    blocked: (blocked as string | null) ?? null, stopped: Boolean(c.followups_stopped_at),
  };
}

/** A fresh pick-a-time link for a no-show: the open one if there is one, else a new invitation (same inquiry). */
export async function rebookLink(invite: string, origin: string): Promise<string | null> {
  const db = adminDb();
  const { data: c } = await db.from('consult_invites').select('id, label, emails, inquiry_id, prospect_id').eq('id', invite).maybeSingle();
  if (!c) return null;
  const match = c.inquiry_id ? { inquiry_id: c.inquiry_id } : c.prospect_id ? { prospect_id: c.prospect_id } : null;
  if (!match) return null;
  const { data: open } = await db.from('consult_invites').select('id').match(match).neq('id', c.id).is('booked_at', null).gt('expires_at', new Date(Date.now() + 3 * DAY).toISOString()).order('created_at', { ascending: false }).limit(1);
  let id = open?.[0]?.id as string | undefined;
  if (!id) {
    const r = await db.rpc('create_public_consult', { p_inquiry: c.inquiry_id, p_label: c.label, p_email: (c.emails as string[])[0], p_prospect: c.prospect_id });
    id = r.data as string | undefined;
  }
  const t = id ? consultToken(id) : null;
  return t ? `${origin}/book/${t}` : null;
}

/** The draft for a step. On no-show steps the button's link is made when it's sent (rebookLink), never on a page view;
 *  pass it in then. */
export function draftFor(s: FollowupState, step: FollowupStep, origin: string, rebook?: string | null) {
  return followupDraft(step, { first: s.first, org: s.org, goal: s.goal, origin, rebook: rebook ?? (step.startsWith('n') ? `${origin}/book` : null) });
}

export async function postalAddress(): Promise<string> {
  const { data } = await adminDb().from('app_settings').select('value').eq('key', 'business_postal_address').maybeSingle();
  return (data?.value as string | undefined)?.trim() ?? '';
}
