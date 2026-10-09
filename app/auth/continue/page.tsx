import { continueSignIn } from '@/lib/signin';
import { safeNext } from '@/lib/safe-next';
import { Egg } from '@/components/Wordmark';

export const metadata = { title: 'Continue' };

// Opening this page changes nothing: corporate link scanners can visit it freely. The one-time token is
// spent only when the person presses Continue.
export default async function Continue({ searchParams }: { searchParams: Promise<{ t?: string; next?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <form action={continueSignIn} className="panel" style={{ width: 'min(100%, 420px)', padding: 28, gap: 18, textAlign: 'center' }}>
        <span style={{ justifySelf: 'center' }}><Egg size={52} /></span>
        <h1 style={{ font: '800 22px/1.2 var(--display)' }}>You’re one tap away</h1>
        <p className="soft">Continue to your Genovus dashboard. You will stay signed in on this device.</p>
        <input type="hidden" name="t" value={sp.t ?? ''} />
        <input type="hidden" name="next" value={next ?? ''} />
        <button className="btn primary" type="submit" style={{ justifyContent: 'center', fontSize: 16, padding: '14px 20px' }} autoFocus>Continue to Genovus</button>
      </form>
    </main>
  );
}
