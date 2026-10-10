// Stage the demo agency (demo-brooks, fictional) for filming Intro Series Ep. 1 "Genovus Knows". Safe to run
// before every take: it only touches the sample tenant (it refuses if demo-brooks is not is_sample) and only its
// follow-ups, client post approvals, the care request typed on camera, and the filming owner's membership.
// Run directly, it stages and prints a one-time sign-in link for the filming owner; capture-intro-ep1.mjs
// imports stage() and uses the link itself without printing it.
//   node --env-file=.env.local scripts/stage-intro-ep1.mjs [origin]
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

export const plan = JSON.parse(fs.readFileSync('data/intro-ep1-filming.json', 'utf8'));
const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data; };

export async function stage(origin = 'http://localhost:3911') {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const t = must(await db.from('tenants').select('id, name, is_sample').eq('slug', 'demo-brooks').maybeSingle(), 'tenant');
  if (!t?.is_sample) throw new Error('demo-brooks is missing or not a sample tenant: refusing to stage');

  // Dates are relative to the office's business day (America/New_York), like the app.
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const day = (n) => { const x = new Date(`${today}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

  must(await db.from('follow_ups').delete().eq('tenant_id', t.id), 'clear follow-ups');
  must(await db.from('follow_ups').insert(plan.follow_ups.map((f) => ({ tenant_id: t.id, who: f.who, reason: f.reason, due_on: day(f.day), due_at: f.at, priority: Boolean(f.priority) }))), 'follow-ups');
  // Client post approvals back to pending, so the on-camera approval can be taken again.
  must(await db.from('approvals').update({ status: 'pending', decided_at: null, decision_note: null, decided_by: null }).eq('tenant_id', t.id).eq('approver', 'client').eq('subject_kind', 'post').neq('title', 'Facebook post: fall coverage check'), 'reset approvals');
  must(await db.from('care_requests').delete().eq('tenant_id', t.id).eq('title', plan.typed_care.title), 'clear typed care request');

  // The filming owner: a fictional address on a reserved domain (no mail is ever sent to it).
  const email = plan.owner_email;
  let user = (await db.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email?.toLowerCase() === email);
  if (!user) user = must(await db.auth.admin.createUser({ email, email_confirm: true }), 'owner user').user;
  must(await db.from('memberships').upsert({ tenant_id: t.id, user_id: user.id, role: 'owner' }, { onConflict: 'tenant_id,user_id' }), 'membership');

  const link = must(await db.auth.admin.generateLink({ type: 'magiclink', email }), 'sign-in link');
  console.log(`staged ${t.name}: ${plan.follow_ups.length} follow-ups, client post approvals pending, owner ${email}`);
  return `${origin}/auth/continue?t=${encodeURIComponent(link.properties.hashed_token)}&next=${encodeURIComponent('/app/demo-brooks/today?film=1')}`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) console.log(await stage(process.argv[2]));
