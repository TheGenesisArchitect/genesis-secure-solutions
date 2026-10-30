'use server';
// Sending a consultation follow-up (migration 0090): a person on the team reads and edits the draft on the consult
// page, then sends it. The step, its timing and the stop rules are checked again here and in the database; the
// button (a fresh pick-a-time link on no-show steps) and the stop link are made on the server, never from the form.
import { revalidatePath } from 'next/cache';
import { requireStaff } from './session';
import { db } from './supabase/server';
import { followupStopToken } from './consult';
import { followupState, rebookLink, draftFor, postalAddress } from './consult-followups';
import type { ActionResult } from './actions';
import type { FollowupStep } from '@/data/consult-followups';

const str = (f: FormData, k: string, max = 3000) => String(f.get(k) ?? '').trim().slice(0, max);
const done = (ok: string): ActionResult => ({ ok, at: Date.now() });
const fail = (err: string): ActionResult => ({ err, at: Date.now() });

export async function sendFollowup(_: ActionResult, f: FormData): Promise<ActionResult> {
  const v = await requireStaff();
  const invite = str(f, 'invite', 64), step = str(f, 'step', 4) as FollowupStep;
  const subject = str(f, 'subject', 140), body = str(f, 'body', 3000).replace(/\r\n/g, '\n');
  if (subject.length < 3 || body.length < 10) return fail('Add a subject and a message.');
  if (/guarantee/i.test(`${subject} ${body}`)) return fail('Genovus copy never says “guarantee”. Reword it, then send.');
  const supabase = await db();
  const s = await followupState(supabase, invite);
  if (!s) return fail('That consultation wasn’t found.');
  if (s.blocked) return fail(s.blocked);
  if (!s.next || s.next.step !== step) return fail('That follow-up isn’t the next one. Refresh the page.');
  if (!s.next.due) return fail('That follow-up isn’t due yet.');
  const address = await postalAddress();
  if (!address) return fail('Add the business mailing address in Setup → Consultations first. Follow-up emails must carry it.');
  const origin = process.env.APP_ORIGIN || 'https://genovus.io';
  const token = followupStopToken(invite);
  if (!token) return fail('Stop links aren’t configured on this server.');
  const rebook = step.startsWith('n') ? await rebookLink(invite, origin) : null;
  if (step.startsWith('n') && !rebook) return fail('Couldn’t make a new pick-a-time link. Try again.');
  const button = draftFor(s, step, origin, rebook).button;
  const { data: n, error } = await supabase.rpc('send_consult_followup', {
    p_invite: invite, p_step: step, p_subject: subject, p_body: body,
    p_data: { ...(button ? { button_label: button.label, button_url: button.url } : {}), stop_url: `${origin}/followups/stop/${token}`, unsubscribe_url: `${origin}/api/followups/stop/${token}`, address, reply_to: v.email },
  });
  revalidatePath(`/console/consults/${invite}`);
  revalidatePath('/console');
  if (error) return fail(error.message);
  return done(`Sent to ${s.emails.join(', ')}${Number(n) < s.emails.length ? ` (${s.emails.length - Number(n)} skipped: asked not to be contacted)` : ''}. It goes out within a minute.`);
}

export async function stopFollowups(_: ActionResult, f: FormData): Promise<ActionResult> {
  await requireStaff();
  const invite = str(f, 'invite', 64);
  const { error } = await (await db()).rpc('stop_consult_followups', { p_invite: invite, p_reason: 'Stopped by the team.' });
  revalidatePath(`/console/consults/${invite}`);
  return error ? fail(error.message) : done('Follow-ups stopped for this consultation.');
}
