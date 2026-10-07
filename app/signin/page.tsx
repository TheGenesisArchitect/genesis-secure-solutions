import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { db } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/supabase/env';
import { getViewer, homeFor } from '@/lib/session';

export const metadata = { title: 'Sign in' };

const MESSAGES: Record<string, { kind: 'ok' | 'err'; text: string }> = {
  sent: { kind: 'ok', text: 'Check your email. The sign-in link works once and expires in an hour.' },
  invalid: { kind: 'err', text: 'Enter a valid email address.' },
  failed: { kind: 'err', text: 'We could not send a link to that address. If you were invited, check the spelling or ask your Genovus contact.' },
  link: { kind: 'err', text: 'That sign-in link has expired or was already used. Request a new one.' },
  'no-access': { kind: 'err', text: 'You are signed in, but no workspace is linked to this account yet. Ask your Genovus contact.' },
};

async function sendLink(formData: FormData) {
  'use server';
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) redirect('/signin?e=invalid');
  const h = await headers();
  const origin = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('host')}`;
  const supabase = await db();
  // Invited people only: a sign-in link never creates an account.
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: `${origin}/auth/confirm` } });
  redirect(error ? '/signin?e=failed' : '/signin?e=sent');
}

export default async function SignIn({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const { e } = await searchParams;
  const viewer = await getViewer();
  if (viewer && e !== 'no-access') redirect(homeFor(viewer));
  const msg = e ? MESSAGES[e] : undefined;
  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div className="panel" style={{ width: 'min(100%, 420px)', padding: 28, gap: 18 }}>
        <div className="row" style={{ gap: 12 }}>
          <img src="/brand/genovus/genovus-mark-128.png" alt="" width={36} height={36} style={{ borderRadius: 9 }} />
          <div>
            <div style={{ font: '800 16px/1 var(--display)', letterSpacing: '.12em' }}>GENOVUS</div>
            <div className="eyebrow" style={{ color: 'var(--muted)', marginTop: 4 }}>Sign in</div>
          </div>
        </div>
        <p className="soft">One sign-in for the Genovus team, agencies and carrier partners. We email you a link; there is no password to remember.</p>
        {msg ? <div className={'notice ' + msg.kind}>{msg.text}</div> : null}
        {supabaseConfigured() ? (
          <form action={sendLink} className="form">
            <label className="field">
              <span>Work email</span>
              <input className="input" type="email" name="email" autoComplete="email" required maxLength={200} />
            </label>
            <button className="btn primary" type="submit" style={{ justifyContent: 'center' }}>Email me a sign-in link</button>
          </form>
        ) : (
          <div className="notice err">Sign-in is not connected in this environment yet.</div>
        )}
        <a href="/" className="muted" style={{ fontSize: 13 }}>Back to genovus</a>
      </div>
    </main>
  );
}
