'use server';
// Public intake from the website. Validates every field, drops bots (honeypot + time check), limits each
// address to a few submissions an hour, stores the exact consent text shown, and lands in the console.
// Uses the service role because the person is not signed in; nothing here reads data back to them.
import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { adminDb } from './supabase/admin';
import { supabaseConfigured } from './supabase/env';
import { CONSENT_TEXT } from '@/data/consent';

const s = (f: FormData, k: string, max: number) => String(f.get(k) ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

export async function submitInquiry(f: FormData) {
  const kind = s(f, 'kind', 10) === 'carrier' ? 'carrier' : 'agency';
  const page = kind === 'carrier' ? '/partners' : '/start';
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

  const { data, error } = await db
    .from('inquiries')
    .insert({ kind, name, email, phone: phone || null, org, details, consent_text: CONSENT_TEXT, ip_hash: ipHash })
    .select('id')
    .single();
  if (error || !data) fail('Something went wrong saving your request. Please try again.');
  await db.from('audit_events').insert({ tenant_id: null, actor: null, actor_label: 'website', action: 'inquiry.new', subject: org, after: { kind, id: data!.id }, prev_hash: '', hash: '' });
  redirect(`/thanks?k=${kind}`);
}
