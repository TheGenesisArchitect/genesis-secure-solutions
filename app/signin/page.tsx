import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { supabaseConfigured } from '@/lib/supabase/env';
import { getViewer, homeFor } from '@/lib/session';
import { requestSignIn, verifyCode } from '@/lib/signin';
import { safeNext } from '@/lib/safe-next';
import { ResendButton } from '@/components/ResendButton';

export const metadata = { title: 'Sign in' };

const MESSAGES: Record<string, { kind: 'ok' | 'err'; text: string }> = {
  sent: { kind: 'ok', text: 'If this address has access, a sign-in email is on its way. Tap its button, or enter the code here.' },
  invalid: { kind: 'err', text: 'Enter a valid email address.' },
  code: { kind: 'err', text: 'That code didn’t work. Check it, or request a new one.' },
  wait: { kind: 'err', text: 'We just sent one. Give it a few seconds to arrive before asking again.' },
  slow: { kind: 'err', text: 'Too many sign-in requests for now. Try again in a little while, or reply to any Genovus email for help.' },
  expired: { kind: 'err', text: 'Start again by entering your email.' },
  link: { kind: 'err', text: 'That sign-in link has expired or was already used. Request a new one; it only takes a moment.' },
  'no-access': { kind: 'err', text: 'You are signed in, but no workspace is linked to this account yet. Reply to any Genovus email and we will sort it out.' },
};

export default async function SignIn({ searchParams }: { searchParams: Promise<{ e?: string; step?: string; next?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const viewer = await getViewer();
  if (viewer && sp.e !== 'no-access') redirect(next ?? homeFor(viewer));
  const jar = await cookies();
  const pending = jar.get('gv_pending')?.value;
  const remembered = jar.get('gv_email')?.value ?? '';
  const codeStep = sp.step === 'code' && !!pending;
  const msg = sp.e ? MESSAGES[sp.e] : undefined;
  const isGmail = /@(gmail|googlemail)\.com$/.test(pending ?? '');
  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div className="panel" style={{ width: 'min(100%, 440px)', padding: 28, gap: 18 }}>
        <div className="row" style={{ gap: 12 }}>
          <img src="/brand/genovus/genovus-mark.svg" alt="" width={36} height={36} style={{ borderRadius: 9 }} />
          <div>
            <div style={{ font: '800 16px/1 var(--display)', letterSpacing: '.12em' }}>GENOVUS</div>
            <div className="eyebrow" style={{ color: 'var(--muted)', marginTop: 4 }}>{codeStep ? 'Check your email' : 'Sign in'}</div>
          </div>
        </div>
        {msg ? <div className={'notice ' + msg.kind} role={msg.kind === 'err' ? 'alert' : 'status'}>{msg.text}</div> : null}
        {!supabaseConfigured() ? (
          <div className="notice err">Sign-in is not connected in this environment yet.</div>
        ) : codeStep ? (
          <>
            <p className="soft">We sent a sign-in email to <b style={{ color: 'var(--ink)' }}>{pending}</b>. Tap <b>Continue to Genovus</b> in it, or type the code.</p>
            <form action={verifyCode} className="form">
              <input type="hidden" name="next" value={next ?? ''} />
              <label className="field">
                <span>Code from the email</span>
                <input className="input" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,12}" maxLength={12} required autoFocus
                  style={{ font: '700 24px/1 var(--mono)', letterSpacing: '.3em', textAlign: 'center' }} />
              </label>
              <button className="btn primary" type="submit" style={{ justifyContent: 'center' }}>Sign in</button>
            </form>
            <div className="row" style={{ justifyContent: 'center' }}>
              <a className="btn small" href={isGmail ? 'https://mail.google.com/mail/u/0/#search/from%3Agenovus' : 'https://mail.google.com/'} target="_blank" rel="noreferrer">Open Gmail</a>
              <a className="btn small" href="https://outlook.office.com/mail/" target="_blank" rel="noreferrer">Open Outlook</a>
            </div>
            <form action={requestSignIn} className="row" style={{ justifyContent: 'space-between' }}>
              <input type="hidden" name="email" value={pending} />
              <input type="hidden" name="next" value={next ?? ''} />
              <a href={`/signin${next ? `?next=${encodeURIComponent(next)}` : ''}`} className="muted" style={{ fontSize: 13 }}>Use a different email</a>
              <ResendButton seconds={25} />
            </form>
          </>
        ) : (
          <>
            <p className="soft">One sign-in for agencies, carrier partners and the Genovus team. No password: we email you a button and a code, and you stay signed in on this device.</p>
            <form action={requestSignIn} className="form">
              <input type="hidden" name="next" value={next ?? ''} />
              <label className="field">
                <span>Work email</span>
                <input className="input" type="email" name="email" autoComplete="email" required maxLength={200} defaultValue={remembered} autoFocus={!remembered} />
              </label>
              <button className="btn primary" type="submit" style={{ justifyContent: 'center' }} autoFocus={!!remembered}>Email me a sign-in code</button>
            </form>
          </>
        )}
        <a href="/" className="muted" style={{ fontSize: 13 }}>Back to Genovus</a>
      </div>
    </main>
  );
}
