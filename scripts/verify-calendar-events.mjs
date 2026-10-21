// Verify calendar events and meeting invites on the PREVIEW database (no email is sent; invites stop at the outbox):
//  1. an agency member adds, moves and cancels an event; the length is kept on a move; an outsider can't see or add one
//  2. members can't send invites; Genovus staff can: one outbox email per attendee, a re-send of the same version is a
//     no-op, a moved event sends an update, a cancelled one sends the cancellation
//  3. Helix's confirm lane adds, moves and cancels events only through a signed proposal, and undo puts each back;
//     a forged token is refused
//  4. the invite email carries a calendar invite (REQUEST, then CANCEL) with every attendee and a stable UID
//  5. every change is in the audit log
// Uses the "test-launch" agency from verify-agency-dashboard.mjs.
//   node --conditions=react-server --env-file=.env.local scripts/verify-calendar-events.mjs
import { createClient } from '@supabase/supabase-js';

if (/prod/i.test(process.env.VERCEL_ENV ?? '')) throw new Error('refusing: production environment');
process.env.HELIX_ACT_SECRET ||= 'verify-calendar-events';
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL, ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const db = createClient(URL_, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed++; };

const SLUG = 'test-launch';
const t = must(await db.from('tenants').select('id, name').eq('slug', SLUG).maybeSingle(), 'tenant');
if (!t) throw new Error(`${SLUG} is missing: run verify-agency-dashboard.mjs first`);
const OWNER = `owner@${SLUG}.example`, OUTSIDER = 'verify-outsider@calendar.example', OPS = 'verify-ops@calendar.example';

const users = async () => (await db.auth.admin.listUsers({ perPage: 1000 })).data?.users ?? [];
async function clean() {
  must(await db.from('calendar_events').delete().eq('tenant_id', t.id).like('title', 'Verify:%'), 'clear events');
  must(await db.from('outbox').delete().eq('template', 'meeting_invite').like('to_email', '%.example'), 'clear outbox');
  for (const x of (await users()).filter((x) => x.email === OUTSIDER || x.email === OPS)) { await db.from('staff').delete().eq('user_id', x.id); await db.auth.admin.deleteUser(x.id); }
}
await clean();
const owner = (await users()).find((x) => x.email === OWNER);
if (!owner) throw new Error(`${OWNER} is missing: run verify-agency-dashboard.mjs first`);
const outsider = must(await db.auth.admin.createUser({ email: OUTSIDER, email_confirm: true }), 'outsider').user;
const ops = must(await db.auth.admin.createUser({ email: OPS, email_confirm: true }), 'operator').user;
must(await db.from('staff').insert({ user_id: ops.id, role: 'operator', display_name: 'Verify Operator' }), 'operator staff');

async function signedIn(email) {
  const link = must(await db.auth.admin.generateLink({ type: 'magiclink', email }), `link for ${email}`);
  const c = createClient(URL_, ANON, { auth: { persistSession: false } });
  must(await c.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' }), `sign in ${email}`);
  return c;
}
const asOwner = await signedIn(OWNER), asOutsider = await signedIn(OUTSIDER), asOps = await signedIn(OPS);
const day = (n) => new Date(Date.now() + n * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const ev = async (id) => must(await db.from('calendar_events').select('*').eq('id', id).single(), 'event');
const et = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/New_York' });

// 1. members add, move and cancel; outsiders can't
const id1 = must(await asOwner.rpc('add_event', { p_tenant: t.id, p_title: 'Verify: team training', p_day: day(2), p_start: '10:30', p_end: '12:00', p_location: 'The office', p_notes: '', p_attendees: '' }), 'owner add');
let e1 = await ev(id1);
check(e1.host === 'agency' && et(e1.starts_at) === '10:30' && et(e1.ends_at) === '12:00', 'a member adds an event in office time (10:30 to 12:00 Eastern), hosted by the agency');
must(await asOwner.rpc('move_event', { p_id: id1, p_day: day(3), p_start: '14:00', p_end: '' }), 'owner move');
e1 = await ev(id1);
check(et(e1.starts_at) === '14:00' && et(e1.ends_at) === '15:30' && e1.sequence === 1, 'moving keeps the length (2:00 to 3:30) and bumps the version');
const out = await asOutsider.rpc('add_event', { p_tenant: t.id, p_title: 'Verify: intruder', p_day: day(2), p_start: '09:00', p_end: '', p_location: '', p_notes: '', p_attendees: '' });
const seen = await asOutsider.from('calendar_events').select('id').eq('tenant_id', t.id);
check(Boolean(out.error) && (seen.data ?? []).length === 0, 'someone outside the agency can neither add nor see its events');
const bad = await asOwner.rpc('add_event', { p_tenant: t.id, p_title: 'Verify: bad', p_day: day(2), p_start: '11:00', p_end: '10:00', p_location: '', p_notes: '', p_attendees: '' });
check(/before the start/.test(bad.error?.message ?? ''), 'an end before the start is refused with a plain message');

// 2. invites: staff only, one per attendee, versioned
const memberSend = await asOwner.rpc('send_event_invite', { p_id: id1 });
check(/Genovus team/.test(memberSend.error?.message ?? ''), 'an agency member cannot send invites');
const defaults = must(await asOps.rpc('event_default_attendees', { p_tenant: t.id }), 'defaults');
check(String(defaults).includes(OWNER) && String(defaults).includes(OPS), `the invite list starts with the agency owner and the sender (${defaults})`);
const id2 = must(await asOps.rpc('add_event', { p_tenant: t.id, p_title: 'Verify: carrier setup and back-office training', p_day: day(1), p_start: '10:30', p_end: '12:00', p_location: '6053 Veterans Pkwy, Columbus GA', p_notes: 'Bring the GEICO login.', p_attendees: `${OWNER}, ${OPS}, ${OWNER.toUpperCase()}` }), 'ops add');
let e2 = await ev(id2);
check(e2.host === 'genovus' && e2.attendees.length === 2, 'staff schedule a meeting hosted by Genovus; duplicate addresses fold into one');
const badMail = await asOps.rpc('add_event', { p_tenant: t.id, p_title: 'Verify: bad mail', p_day: day(1), p_start: '10:00', p_end: '', p_location: '', p_notes: '', p_attendees: 'not-an-email' });
check(/not an email address/.test(badMail.error?.message ?? ''), 'a bad address is refused');
const n1 = must(await asOps.rpc('send_event_invite', { p_id: id2 }), 'send 1');
const n1b = must(await asOps.rpc('send_event_invite', { p_id: id2 }), 'send again');
check(n1 === 2 && n1b === 0, 'staff send the invite: two emails queued; sending the same version again queues none');
must(await asOps.rpc('move_event', { p_id: id2, p_day: day(1), p_start: '11:00', p_end: '12:30' }), 'ops move');
const n2 = must(await asOps.rpc('send_event_invite', { p_id: id2 }), 'send update');
must(await asOps.rpc('cancel_event', { p_id: id2 }), 'ops cancel');
const n3 = must(await asOps.rpc('send_event_invite', { p_id: id2 }), 'send cancel');
const rows = must(await db.from('outbox').select('to_email, data, status').eq('template', 'meeting_invite').eq('data->>event', id2), 'outbox');
check(n2 === 2 && n3 === 2 && rows.length === 6 && rows.filter((r) => r.data.status === 'cancelled').length === 2, 'a move sends an update and a cancel sends the cancellation (6 emails in all)');
must(await db.from('outbox').update({ status: 'skipped', last_error: 'verify' }).eq('template', 'meeting_invite').eq('data->>event', id2), 'park outbox');

// 3. Helix's confirm lane
const act = await import('../lib/helix-act.ts');
const p1 = await act.propose(asOwner, owner.id, t.id, 'add_event', { title: 'Verify: carrier training with Genovus', day: day(4), time: '10:30', end: '12:00', location: 'The office' });
check(p1.ok && /Add “Verify: carrier training with Genovus” to the calendar/.test(p1.summary) && /12:00 PM/.test(p1.summary), `Helix proposes the event and nothing is saved yet (${p1.summary})`);
const before = (await db.from('calendar_events').select('id').eq('tenant_id', t.id).like('title', 'Verify: carrier training%')).data ?? [];
check(before.length === 0, 'nothing is on the calendar before the yes');
const c1 = await act.confirm(asOwner, owner.id, t.id, p1.token);
const added = (await db.from('calendar_events').select('id, starts_at, ends_at').eq('tenant_id', t.id).like('title', 'Verify: carrier training%')).data ?? [];
check(c1.ok && added.length === 1 && et(added[0].starts_at) === '10:30', 'after the yes it is on the calendar at 10:30');
const pm = await act.propose(asOwner, owner.id, t.id, 'move_event', { event: 'carrier training', day: day(5), time: '13:00' });
const cm = pm.ok ? await act.confirm(asOwner, owner.id, t.id, pm.token) : pm;
let moved = await ev(added[0].id);
check(cm.ok && et(moved.starts_at) === '13:00' && et(moved.ends_at) === '14:30', 'Helix moves it by name (1:00 to 2:30, same length)');
const um = cm.ok ? await act.undo(asOwner, owner.id, t.id, cm.undo) : cm;
moved = await ev(added[0].id);
check(um.ok && moved.starts_at === added[0].starts_at && moved.ends_at === added[0].ends_at, 'undo puts the move back exactly');
const pc = await act.propose(asOwner, owner.id, t.id, 'cancel_event', { event: 'Verify: carrier training with Genovus' });
const cc = pc.ok ? await act.confirm(asOwner, owner.id, t.id, pc.token) : pc;
const cancelled = (await ev(added[0].id)).status;
const uc = cc.ok ? await act.undo(asOwner, owner.id, t.id, cc.undo) : cc;
check(cc.ok && cancelled === 'cancelled' && uc.ok && (await ev(added[0].id)).status === 'scheduled', 'Helix cancels it after a yes, and undo brings it back');
const ua = c1.ok ? await act.undo(asOwner, owner.id, t.id, c1.undo) : c1;
const gone = (await db.from('calendar_events').select('id').eq('id', added[0].id)).data ?? [];
check(!ua.ok || gone.length === 0, `undoing the add removes it, or refuses once it changed (${ua.ok ? 'removed' : ua.error})`);
const forged = p1.ok ? await act.confirm(asOwner, owner.id, t.id, p1.token.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'))) : { ok: true };
const foreign = await act.confirm(asOutsider, outsider.id, t.id, p1.ok ? p1.token : '');
check(!forged.ok && !foreign.ok, 'a forged token, or one signed for someone else, is refused');
const vague = await act.propose(asOwner, owner.id, t.id, 'move_event', { event: 'nothing like this', day: day(5) });
check(!vague.ok && /No upcoming event/.test(vague.error), 'an event Helix can’t find is reported, not guessed');

// 4. the invite email
// The app's own imports are extensionless (the bundler resolves them); let plain Node find the .ts beside them.
const { register } = await import('node:module');
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; } }`));
const { outboxEmail } = await import('../lib/email.ts');
const sample = rows.find((r) => r.data.status === 'scheduled' && r.data.sequence === '0');
const mail = outboxEmail('meeting_invite', sample.to_email, sample.data, 'https://genovus.io');
// Long lines are folded (RFC 5545); unfold before reading, as calendar apps do.
const rawIcs = mail?.attachments?.[0]?.content ?? '', ics = rawIcs.replace(/\r\n /g, '');
check(rawIcs.split('\r\n').every((l) => Buffer.byteLength(l) <= 75), 'every line of the invite is within the 75-octet limit');
check(/^Invitation: Verify: carrier setup/.test(mail?.subject ?? '') && /10:30 AM – 12:00 PM ET/.test(mail?.subject ?? ''), `the invite reads plainly (${mail?.subject})`);
check(/METHOD:REQUEST/.test(ics) && ics.includes(`UID:ev-${id2}@genovus.io`) && ics.includes(`mailto:${OWNER}`) && ics.includes(`mailto:${OPS}`) && /DTSTART:\d{8}T143000Z/.test(ics), 'it carries a calendar invite with both attendees, a stable UID and 10:30 Eastern (14:30 UTC)');
const cancelRow = rows.find((r) => r.data.status === 'cancelled');
const cmail = outboxEmail('meeting_invite', cancelRow.to_email, cancelRow.data, 'https://genovus.io');
check(/^Cancelled:/.test(cmail?.subject ?? '') && /METHOD:CANCEL/.test(cmail?.attachments?.[0]?.content ?? '') && /method=CANCEL/.test(cmail?.attachments?.[0]?.contentType ?? ''), 'the cancellation removes it from calendars (METHOD:CANCEL)');

// 5. audit trail
const audit = must(await db.from('audit_events').select('action').eq('tenant_id', t.id).like('action', 'event.%').gte('at', new Date(Date.now() - 10 * 60_000).toISOString()), 'audit');
const acts = new Set(audit.map((a) => a.action));
check(['event.add', 'event.move', 'event.cancel', 'event.invite', 'event.cancel_sent', 'event.undo'].every((a) => acts.has(a)), `every change is in the audit log (${[...acts].sort().join(', ')})`);

await clean();
console.log(failed ? `\n${failed} check(s) failed` : '\nAll calendar checks passed');
process.exit(failed ? 1 : 0);
