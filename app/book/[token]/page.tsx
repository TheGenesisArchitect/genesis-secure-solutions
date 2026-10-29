// Pick a time for a Genovus consultation (lib/consult.ts): the open times, by day, one tap to book. Private link;
// never indexed. Website bookings (from the intake form) are a first conversation; team links are onboarding calls.
import { notFound } from 'next/navigation';
import { consultSlots, inviteFor, whenLabel } from '@/lib/consult';
import { ConsultPicker } from '@/components/ConsultPicker';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Pick a time', robots: { index: false, follow: false } };

export default async function Book({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = await inviteFor(token);
  if (!inv) notFound();
  const slots = inv.bookedAt || inv.expired ? [] : await consultSlots(inv);
  const first = inv.firstCall;
  const help = first ? 'Email hello@genovus.io and we’ll find one.' : 'Reply to the email and we’ll find one.';
  return (
    <main className="checklist">
      <header className="ck-top"><a href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'inherit', textDecoration: 'none' }}><img src="/brand/genovus/genovus-egg.svg" alt="" width={30} height={38} /><span>Genovus</span></a></header>
      <section className="ck-hero">
        <p className="ck-eye">{first ? `Thanks, ${inv.label.split(',')[0].split(' ')[0]}` : inv.label}</p>
        <h1>{first ? 'Pick a time to talk' : 'Pick a time for your Genovus consultation'}</h1>
        <p className="ck-sub">
          {first && inv.carrier
            ? `${inv.minutes} minutes on video with the Genovus team: your network, what a pilot would show, and how it would run. No obligation. Times are Eastern.`
            : first
            ? `${inv.minutes} minutes on video with the Genovus team. We’ll learn about your office and show you what Genovus would set up for it. No obligation. Times are Eastern.`
            : `${inv.minutes} minutes on video. We’ll walk through your dashboard, your website and the Growth tools together. Times are Eastern.`}
        </p>
      </section>
      {inv.bookedAt ? <div className="ck-msg ok"><b>You’re booked{inv.eventStart ? ` for ${whenLabel(inv.eventStart)}` : ''}.</b> The calendar invite went to {inv.emails.join(', ')}. Need a different time? Reply to the invite.</div>
        : inv.expired ? <div className="ck-msg err">This link has expired. {first ? 'Email hello@genovus.io and we’ll send a new one.' : 'Reply to the email and we’ll send a new one.'}</div>
          : <ConsultPicker token={token} slots={slots} help={help} />}
    </main>
  );
}
