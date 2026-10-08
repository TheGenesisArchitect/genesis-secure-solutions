'use server';
// Sign-in that is secure and quick: one email carries a "Continue" button and a code. The button opens a
// Genovus page and the one-time token is spent only when the person clicks (corporate link scanners can't
// burn it); the code works on any device. Only invited people get an email, the page never reveals whether
// an address has access, and requests are throttled per address and per network.
import { createHash } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { db } from './supabase/server';
import { adminDb } from './supabase/admin';
import { emailConfigured, sendEmail, signInEmail } from './email';
import { safeNext } from './safe-next';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const hash = (s: string) => createHash('sha256').update(`genovus-signin|${s}`).digest('hex').slice(0, 32);
const COOKIE = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/' };

async function origin() {
  const h = await headers();
  return `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('host')}`;
}

export async function requestSignIn(f: FormData) {
  const email = String(f.get('email') ?? '').trim().toLowerCase();
  const next = safeNext(String(f.get('next') ?? ''));
  const nextQ = next ? `&next=${encodeURIComponent(next)}` : '';
  if (!EMAIL_RE.test(email) || email.length > 200) redirect(`/signin?e=invalid${nextQ}`);
  const jar = await cookies();
  // Remember the address on this device (prefills next time) and carry it to the code step without putting it in the URL.
  jar.set('gv_email', email, { ...COOKIE, maxAge: 60 * 60 * 24 * 365 });
  jar.set('gv_pending', email, { ...COOKIE, maxAge: 60 * 60 });

  if (!emailConfigured()) {
    // No Resend key in this environment: fall back to Supabase's own email (link only).
    const supabase = await db();
    await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: `${await origin()}/auth/confirm${next ? `?next=${encodeURIComponent(next)}` : ''}` } });
    redirect(`/signin?step=code${nextQ}`);
  }

  const admin = adminDb();
  const h = await headers();
  const ipHash = hash((h.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown');
  const emailHash = hash(email);
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const [{ data: recent }, { count: ipCount }] = await Promise.all([
    admin.from('signin_requests').select('at').eq('email_hash', emailHash).gte('at', since).order('at', { ascending: false }),
    admin.from('signin_requests').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('at', since),
  ]);
  const last = recent?.[0] ? Date.parse(recent[0].at) : 0;
  if (Date.now() - last < 25_000) redirect(`/signin?step=code&e=wait${nextQ}`);
  if ((recent?.length ?? 0) >= 8 || (ipCount ?? 0) >= 40) redirect(`/signin?step=code&e=slow${nextQ}`);
  await admin.from('signin_requests').insert({ email_hash: emailHash, ip_hash: ipHash });

  const { data: userId } = await admin.rpc('signin_user_id', { p_email: email });
  if (userId) {
    const { data } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    const p = data?.properties;
    if (p?.hashed_token && p.email_otp) {
      const o = await origin();
      const link = `${o}/auth/continue?t=${encodeURIComponent(p.hashed_token)}${next ? `&next=${encodeURIComponent(next)}` : ''}`;
      const sent = await sendEmail(signInEmail(email, link, p.email_otp, o));
      if (!sent.ok) {
        // Never leave someone without a way in: fall back to Supabase's own sign-in email.
        const supabase = await db();
        await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: `${o}/auth/confirm${next ? `?next=${encodeURIComponent(next)}` : ''}` } });
      } else console.log(`[email] sign-in code sent (${sent.id})`);
    }
  }
  // Same answer whether or not the address has access.
  redirect(`/signin?step=code&e=sent${nextQ}`);
}

export async function verifyCode(f: FormData) {
  const jar = await cookies();
  const email = jar.get('gv_pending')?.value ?? '';
  const code = String(f.get('code') ?? '').replace(/\D/g, '');
  const next = safeNext(String(f.get('next') ?? ''));
  const nextQ = next ? `&next=${encodeURIComponent(next)}` : '';
  if (!email) redirect(`/signin?e=expired${nextQ}`);
  if (code.length < 6 || code.length > 10) redirect(`/signin?step=code&e=code${nextQ}`);
  const supabase = await db();
  const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
  if (error) redirect(`/signin?step=code&e=code${nextQ}`);
  jar.delete('gv_pending');
  redirect(next ?? '/go');
}

/** The "Continue" button on the page the email link opens. Spends the one-time token only on this POST. */
export async function continueSignIn(f: FormData) {
  const token = String(f.get('t') ?? '');
  const next = safeNext(String(f.get('next') ?? ''));
  const supabase = await db();
  const { error } = await supabase.auth.verifyOtp({ token_hash: token, type: 'email' });
  if (error) redirect(`/signin?e=link${next ? `&next=${encodeURIComponent(next)}` : ''}`);
  (await cookies()).delete('gv_pending');
  redirect(next ?? '/go');
}
