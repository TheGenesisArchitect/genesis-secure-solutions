'use server';
// Public intake from the website. Validates every field, drops bots (honeypot + time check), limits each
// address to a few submissions an hour, stores the exact consent text shown, and lands in the console.
// Uses the service role because the person is not signed in; nothing here reads data back to them.
import { createHash } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { adminDb } from './supabase/admin';
import { supabaseConfigured } from './supabase/env';
import { CONSENT_TEXT } from '@/data/consent';

type Ref = { c?: string; src?: string; p?: string; l?: string };
function readRef(raw: string | undefined): Ref {
  try {
    const r = JSON.parse(decodeURIComponent(raw ?? '')) as Ref;
    const ok = (v: unknown, re: RegExp) => (typeof v === 'string' && re.test(v) ? v : undefined);
    return { c: ok(r.c, /^[a-z0-9-]{2,41}$/), src: ok(r.src, /^[a-z0-9-]{1,20}$/), p: ok(r.p, /^[a-z0-9]{6,24}$/), l: ok(r.l, /^\/[\w\-/]{0,79}$/) };
  } catch { return {}; }
}
/** Prospects carry a short public code for links; the table arrives with the scanner (migration 0014). */
async function prospectFromCode(db: ReturnType<typeof adminDb>, code: string): Promise<string | null> {
  const { data, error } = await db.from('prospects').select('id').eq('code', code).maybeSingle();
  return error ? null : data?.id ?? null;
}

const s = (f: FormData, k: string, max: number) => String(f.get(k) ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

export async function submitInquiry(f: FormData) {
  const kind = s(f, 'kind', 10) === 'carrier' ? 'carrier' : 'agency';
  const backTo = s(f, 'back', 60);
  const page = /^\/for\/[a-z-]{2,30}$/.test(backTo) ? backTo : kind === 'carrier' ? '/partners' : '/start';
  const fail = (m: string) => redirect(`${page}?err=${encodeURIComponent(m)}`);

  // Bots fill the hidden field, or submit faster than a person can read the form.
  const started = Number(s(f, 't', 20));
  if (s(f, 'website', 200) || !started || Date.now() - started < 2500) redirect('/thanks');

  const name = s(f, 'name', 120);
  const email = s(f, 'email', 200).toLowerCase();
  const phone = s(f, 'phone', 40).replace(/[^\d+()\-. ]/g, '');
  const org = s(f, 'org', 160);
  if (name.length < 2) fail('Please enter your name.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('Please enter a valid email address.');
  if (org.length < 2) fail(kind === 'carrier' ? 'Please enter your organization.' : 'Please enter your agency’s name.');
  if (f.get('consent') !== 'yes') fail('Please confirm we may contact you.');

  const fields = kind === 'carrier' ? ['role', 'type', 'agencies', 'regions', 'goals'] : ['carrier', 'states', 'presence', 'plan', 'goals'];
  const details = Object.fromEntries(fields.map((k) => [k, s(f, k, k === 'goals' ? 2000 : 200)]).filter(([, v]) => v));

  if (!supabaseConfigured()) fail('Our intake is being connected. Please email us instead.');
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const ipHash = createHash('sha256').update(`genovus-intake|${ip}`).digest('hex').slice(0, 32);
  const db = adminDb();
  const { count } = await db.from('inquiries').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('created_at', new Date(Date.now() - 3_600_000).toISOString());
  if ((count ?? 0) >= 5) fail('We already have several requests from you this hour. We will be in touch soon.');

  // First-touch attribution from a tracked link (see components/RefCapture.tsx); unknown codes are ignored.
  const ref = readRef((await cookies()).get('gv_ref')?.value);
  const campaignId = ref.c ? (await db.from('campaigns').select('id').eq('slug', ref.c).maybeSingle()).data?.id ?? null : null;
  const prospectId = ref.p ? await prospectFromCode(db, ref.p) : null;

  const { data, error } = await db
    .from('inquiries')
    .insert({ kind, name, email, phone: phone || null, org, details, consent_text: CONSENT_TEXT, ip_hash: ipHash,
      campaign_id: campaignId, source: ref.src || null, landing: ref.l || null, prospect_id: prospectId })
    .select('id')
    .single();
  if (error || !data) fail('Something went wrong saving your request. Please try again.');
  await db.from('audit_events').insert({ tenant_id: null, actor: null, actor_label: 'website', action: 'inquiry.new', subject: org, after: { kind, id: data!.id }, prev_hash: '', hash: '' });
  redirect(`/thanks?k=${kind}`);
}
