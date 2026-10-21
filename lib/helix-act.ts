// Helix's confirm lane (Step 8): changes Helix can make for an agency, only after the person says yes. Helix proposes
// (by voice or in the chat), the server resolves the lead and signs exactly what will happen, the person confirms
// (spoken "yes" or a tap), and the change runs through the same database functions as the buttons, with the person's
// own session (row-level security, audit log). Each change can be undone for a few minutes. Nothing here sends,
// posts or spends: anything outward stays a draft the person sends themselves.
import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export type ActName = 'mark_lead' | 'book_lead' | 'add_follow_up' | 'add_event' | 'move_event' | 'cancel_event';
export const ACT_NAMES: ActName[] = ['mark_lead', 'book_lead', 'add_follow_up', 'add_event', 'move_event', 'cancel_event'];
const STATUS_WORD: Record<string, string> = { contacted: 'called (Contacted)', won: 'won', lost: 'lost', new: 'back to New' };

type Lead = { id: string; name: string; status: string; booked_for: string | null; first_contact_at: string | null };
type Ev = { id: string; title: string; starts_at: string; ends_at: string; status: string; sequence: number; invited_at: string | null };
/** An event as it was before Helix moved or cancelled it, so undo can put it back. */
type EvBefore = { id: string; starts: string; ends: string; status: string; seq: number };
type Payload = { a: ActName | 'undo'; t: string; u: string; exp: number; args: Record<string, string>; before?: Partial<Lead> & { id?: string }; after?: string; fu?: string; ev?: string; evBefore?: EvBefore };

const KEY = () => createHmac('sha256', process.env.HELIX_ACT_SECRET || process.env.CRON_SECRET || '').update('genovus helix act v1').digest();
const sign = (p: Payload) => { const body = Buffer.from(JSON.stringify(p)).toString('base64url'); return `${body}.${createHmac('sha256', KEY()).update(body).digest('base64url')}`; };
function verify(token: string, userId: string, tenantId: string): Payload | null {
  const [body, mac] = String(token ?? '').split('.');
  if (!body || !mac || !(process.env.HELIX_ACT_SECRET || process.env.CRON_SECRET)) return null;
  const want = createHmac('sha256', KEY()).update(body).digest();
  const got = Buffer.from(mac, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as Payload;
  return p.u === userId && p.t === tenantId && p.exp > Date.now() ? p : null;
}

const when = (day: string, time: string) => new Date(`${day}T${time}:00Z`).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
const clean = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

/** Leads in this agency whose name contains `q` (newest first). */
async function findLeads(db: SupabaseClient, tenantId: string, q: string): Promise<Lead[]> {
  const like = q.replace(/[%_\\]/g, '').trim();
  if (like.length < 2) return [];
  const { data } = await db.from('leads').select('id, name, status, booked_for, first_contact_at').eq('tenant_id', tenantId).ilike('name', `%${like}%`).order('created_at', { ascending: false }).limit(6);
  return (data ?? []) as Lead[];
}

/** Upcoming, scheduled events in this agency whose title contains `q` (soonest first). */
async function findEvents(db: SupabaseClient, tenantId: string, q: string): Promise<Ev[]> {
  const like = q.replace(/[%_\\]/g, '').trim();
  if (like.length < 2) return [];
  const { data } = await db.from('calendar_events').select('id, title, starts_at, ends_at, status, sequence, invited_at').eq('tenant_id', tenantId).eq('status', 'scheduled')
    .gte('ends_at', new Date().toISOString()).ilike('title', `%${like}%`).order('starts_at').limit(6);
  return (data ?? []) as Ev[];
}
const evWhen = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
const hhmm = /^\d{2}:\d{2}$/;
/** "13:30" → "1:30 PM". */
const clock = (t: string) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };

export type Proposal ={ ok: true; summary: string; token: string } | { ok: false; error: string; choices?: string[] };

/** Work out exactly what a change would do, and sign it for the person to confirm (valid five minutes). */
export async function propose(db: SupabaseClient, userId: string, tenantId: string, action: string, raw: Record<string, unknown>): Promise<Proposal> {
  if (!ACT_NAMES.includes(action as ActName)) return { ok: false, error: 'Helix can’t do that one yet.' };
  // No signing secret, no changes (fail closed): set HELIX_ACT_SECRET or CRON_SECRET.
  if (!(process.env.HELIX_ACT_SECRET || process.env.CRON_SECRET)) return { ok: false, error: 'Helix isn’t set up to make changes here yet.' };
  const a = action as ActName;
  const base = { a, t: tenantId, u: userId, exp: Date.now() + 5 * 60_000 };
  if (a === 'add_follow_up') {
    const who = clean(raw.who ?? raw.lead, 120), due = clean(raw.day ?? raw.due, 10), at = clean(raw.time ?? raw.at, 5) || '09:30';
    if (!who) return { ok: false, error: 'Who is the follow-up with?' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || !/^\d{2}:\d{2}$/.test(at)) return { ok: false, error: 'Which day and time? (YYYY-MM-DD and HH:MM)' };
    const reason = clean(raw.reason, 300);
    return { ok: true, summary: `Add a follow-up with ${who}, ${when(due, at)}${reason ? ` (${reason})` : ''}`, token: sign({ ...base, args: { who, due, at, reason } }) };
  }
  if (a === 'add_event') {
    const title = clean(raw.title ?? raw.what, 160), day = clean(raw.day, 10), start = clean(raw.time ?? raw.start, 5), end = clean(raw.end, 5), location = clean(raw.location ?? raw.where, 200);
    if (!title) return { ok: false, error: 'What is the event called?' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !hhmm.test(start)) return { ok: false, error: 'Which day and start time? (YYYY-MM-DD and HH:MM, office time)' };
    if (end && (!hhmm.test(end) || end <= start)) return { ok: false, error: 'The end time needs to be after the start (HH:MM).' };
    return { ok: true, summary: `Add “${title}” to the calendar, ${when(day, start)}${end ? ` to ${clock(end)}` : ''}${location ? `, at ${location}` : ''}`, token: sign({ ...base, args: { title, day, start, end, location, notes: clean(raw.notes ?? raw.reason, 1000) } }) };
  }
  if (a === 'move_event' || a === 'cancel_event') {
    const q = clean(raw.event ?? raw.title, 160);
    const found = await findEvents(db, tenantId, q);
    if (!found.length) return { ok: false, error: `No upcoming event called “${q.slice(0, 60)}”.` };
    const exact = found.filter((e) => e.title.toLowerCase() === q.toLowerCase());
    const pick = exact.length === 1 ? exact : found;
    if (pick.length > 1) return { ok: false, error: 'More than one event matches. Which one?', choices: pick.map((e) => `${e.title} (${evWhen(e.starts_at)})`) };
    const e = pick[0];
    const evBefore: EvBefore = { id: e.id, starts: e.starts_at, ends: e.ends_at, status: e.status, seq: e.sequence + 1 };
    const invited = e.invited_at ? ' Invites already went out; the Genovus team sends the update.' : '';
    if (a === 'cancel_event') return { ok: true, summary: `Cancel “${e.title}” (${evWhen(e.starts_at)}).${invited}`, token: sign({ ...base, args: { id: e.id, title: e.title }, evBefore }) };
    const day = clean(raw.day, 10), start = clean(raw.time ?? raw.start, 5), end = clean(raw.end, 5);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, error: 'Move it to which day? (YYYY-MM-DD)' };
    if ((start && !hhmm.test(start)) || (end && !hhmm.test(end))) return { ok: false, error: 'Times as HH:MM, office time.' };
    return { ok: true, summary: `Move “${e.title}” from ${evWhen(e.starts_at)} to ${start ? when(day, start) : `${day}, same time`}.${invited}`, token: sign({ ...base, args: { id: e.id, title: e.title, day, start, end }, evBefore }) };
  }
  const found = await findLeads(db, tenantId, clean(raw.lead ?? raw.name, 120));
  if (!found.length) return { ok: false, error: `No lead named “${clean(raw.lead ?? raw.name, 60)}”.` };
  const exact = found.filter((l) => l.name.toLowerCase() === clean(raw.lead ?? raw.name, 120).toLowerCase());
  const pick = exact.length === 1 ? exact : found;
  if (pick.length > 1) return { ok: false, error: 'More than one lead matches. Which one?', choices: pick.map((l) => l.name) };
  const l = pick[0];
  const before = { id: l.id, status: l.status, booked_for: l.booked_for, first_contact_at: l.first_contact_at };
  if (a === 'mark_lead') {
    const status = clean(raw.status, 12);
    if (!STATUS_WORD[status]) return { ok: false, error: 'Mark them called, won, lost or back to new?' };
    if (status === l.status) return { ok: false, error: `${l.name} is already ${l.status}.` };
    return { ok: true, summary: `Mark ${l.name} ${STATUS_WORD[status]}`, token: sign({ ...base, args: { id: l.id, name: l.name, status }, before }) };
  }
  const day = clean(raw.day, 10), time = clean(raw.time, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time)) return { ok: false, error: 'Which day and time? (YYYY-MM-DD and HH:MM, office time)' };
  return { ok: true, summary: `Book ${l.name} for a consult ${when(day, time)}`, token: sign({ ...base, args: { id: l.id, name: l.name, day, time }, before }) };
}

export type ActResult = { ok: true; done: string; undo?: string } | { ok: false; error: string };

/** Run a confirmed proposal with the person's own session; returns an undo token (valid ten minutes). */
export async function confirm(db: SupabaseClient, userId: string, tenantId: string, token: string): Promise<ActResult> {
  const p = verify(token, userId, tenantId);
  if (!p || p.a === 'undo') return { ok: false, error: 'That proposal expired. Ask Helix again.' };
  const undoBase = { a: 'undo' as const, t: tenantId, u: userId, exp: Date.now() + 10 * 60_000, args: {} };
  if (p.a === 'add_follow_up') {
    const { data, error } = await db.rpc('add_follow_up', { p_tenant: tenantId, p_who: p.args.who, p_reason: p.args.reason, p_due: p.args.due, p_at: p.args.at });
    if (error) return { ok: false, error: error.message };
    return { ok: true, done: `Follow-up added with ${p.args.who}, ${when(p.args.due, p.args.at)}.`, undo: sign({ ...undoBase, fu: data as string }) };
  }
  if (p.a === 'add_event') {
    const { data, error } = await db.rpc('add_event', { p_tenant: tenantId, p_title: p.args.title, p_day: p.args.day, p_start: p.args.start, p_end: p.args.end, p_location: p.args.location, p_notes: p.args.notes, p_attendees: '' });
    if (error) return { ok: false, error: error.message };
    return { ok: true, done: `“${p.args.title}” is on the calendar, ${when(p.args.day, p.args.start)}.`, undo: sign({ ...undoBase, ev: data as string }) };
  }
  if (p.a === 'move_event') {
    const { error } = await db.rpc('move_event', { p_id: p.args.id, p_day: p.args.day, p_start: p.args.start, p_end: p.args.end });
    if (error) return { ok: false, error: error.message };
    return { ok: true, done: `“${p.args.title}” moved to ${p.args.start ? when(p.args.day, p.args.start) : p.args.day}.`, undo: sign({ ...undoBase, evBefore: p.evBefore }) };
  }
  if (p.a === 'cancel_event') {
    const { error } = await db.rpc('cancel_event', { p_id: p.args.id });
    if (error) return { ok: false, error: error.message };
    return { ok: true, done: `“${p.args.title}” is cancelled and off the calendar.`, undo: sign({ ...undoBase, evBefore: p.evBefore }) };
  }
  if (p.a === 'mark_lead') {
    const { error } = await db.rpc('update_lead', { p_id: p.args.id, p_status: p.args.status, p_note: '' });
    if (error) return { ok: false, error: error.message };
    return { ok: true, done: `${p.args.name} marked ${STATUS_WORD[p.args.status]}.`, undo: sign({ ...undoBase, before: p.before, after: p.args.status }) };
  }
  const { error } = await db.rpc('book_lead', { p_id: p.args.id, p_when: `${p.args.day} ${p.args.time} America/New_York`, p_note: '' });
  if (error) return { ok: false, error: error.message };
  return { ok: true, done: `${p.args.name} is booked for ${when(p.args.day, p.args.time)}. It’s on the calendar.`, undo: sign({ ...undoBase, before: p.before, after: 'booked' }) };
}

/** Undo a change Helix made, if nothing else changed it since. */
export async function undo(db: SupabaseClient, userId: string, tenantId: string, token: string): Promise<ActResult> {
  const p = verify(token, userId, tenantId);
  if (!p || p.a !== 'undo') return { ok: false, error: 'Too late to undo here.' };
  if (p.ev) {
    const { error } = await db.rpc('helix_remove_event', { p_id: p.ev });
    return error ? { ok: false, error: error.message } : { ok: true, done: 'Undone: the event is gone.' };
  }
  if (p.evBefore) {
    const b = p.evBefore;
    const { error } = await db.rpc('helix_restore_event', { p_id: b.id, p_expect_sequence: b.seq, p_starts: b.starts, p_ends: b.ends, p_status: b.status });
    return error ? { ok: false, error: error.message } : { ok: true, done: 'Undone: the event is back as it was.' };
  }
  if (p.fu) {
    const { error } = await db.rpc('helix_remove_follow_up', { p_id: p.fu });
    return error ? { ok: false, error: error.message } : { ok: true, done: 'Undone: the follow-up is gone.' };
  }
  const b = p.before!;
  const { error } = await db.rpc('helix_restore_lead', { p_id: b.id, p_expect_status: p.after, p_status: b.status, p_booked_for: b.booked_for ?? null, p_first_contact_at: b.first_contact_at ?? null });
  return error ? { ok: false, error: error.message } : { ok: true, done: `Undone: back to ${b.status}.` };
}

/** The rules Helix follows for changes (typed and spoken). */
export const actRules = (voice: boolean) => `
CHANGES YOU CAN MAKE, ONLY WITH A YES: mark a lead called, won, lost or back to new; book a lead's consult (day and
office time); add a follow-up (who, day, time, reason); add an event to the calendar (title, day, start time, end time,
where); move an upcoming event (event = its title, new day, new start and end); cancel an upcoming event (event).
Events are meetings and appointments that aren't a lead's consult, e.g. "carrier training with Genovus Thursday 10:30 to noon".
Use the TODAY date in the BRIEF to turn "Thursday" or "tomorrow" into YYYY-MM-DD. ${voice
  ? 'Call propose_action first; it puts a confirmation card on screen. Read the summary out and ask "Shall I?". Only after the person clearly says yes in this conversation, call confirm_action. If they say no, call nothing. "Undo" right after a change: call undo_last.'
  : 'Add "propose": {"action": "mark_lead"|"book_lead"|"add_follow_up"|"add_event"|"move_event"|"cancel_event", "lead": name, "status": "contacted"|"won"|"lost"|"new", "day": "YYYY-MM-DD", "time": "HH:MM" (a follow-up\'s or an event\'s start), "end": "HH:MM", "who": name, "reason": text, "title": event title, "event": an existing event\'s title, "location": where} to your JSON (only the fields that action needs, at most 8) and ask "Shall I?" in your answer. The person confirms with one tap; you never claim it is done.'}
Never send, post, buy or delete; for messages, write a draft the person sends.`;
