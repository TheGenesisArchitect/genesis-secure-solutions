// The link at the bottom of every consultation follow-up: one button stops them (and puts the address on the
// suppression list). A button rather than stopping on open, so mail scanners that open links don't stop it by accident.
import { notFound } from 'next/navigation';
import { followupStopFrom } from '@/lib/consult';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Stop follow-up emails', robots: { index: false, follow: false } };

export default async function StopFollowups({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> }) {
  const { token } = await params;
  if (!followupStopFrom(token)) notFound();
  const done = (await searchParams).done === '1';
  return (
    <main className="checklist">
      <header className="ck-top"><a href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'inherit', textDecoration: 'none' }}><img src="/brand/genovus/genovus-egg.svg" alt="" width={30} height={38} /><span>Genovus</span></a></header>
      <section className="ck-hero">
        <h1>{done ? 'Done. No more follow-ups.' : 'Stop follow-up emails?'}</h1>
        <p className="ck-sub">{done ? 'You won’t get any more follow-up emails about your consultation. If you ever want to talk, you’re welcome to book a time on genovus.io.' : 'You’ll stop getting follow-up emails from Genovus about your consultation.'}</p>
      </section>
      {done ? <div className="ck-msg ok"><b>You’re unsubscribed.</b></div> : (
        <form method="post" action={`/api/followups/stop/${token}`}>
          <button className="btn primary" type="submit">Stop the emails</button>
        </form>
      )}
    </main>
  );
}
