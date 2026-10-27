// Pick a time for a Genovus consultation (lib/consult.ts): the open times, by day, one tap to book. Private link;
// never indexed.
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
  return (
    <main className="checklist">
      <header className="ck-top"><img src="/brand/genovus/genovus-egg.svg" alt="" width={30} height={38} /><span>Genovus</span></header>
      <section className="ck-hero">
        <p className="ck-eye">{inv.label}</p>
        <h1>Pick a time for your Genovus consultation</h1>
        <p className="ck-sub">{inv.minutes} minutes on video. We’ll walk through your dashboard, your website and the Growth tools together. Times are Eastern.</p>
      </section>
      {inv.bookedAt ? <div className="ck-msg ok"><b>You’re booked{inv.eventStart ? ` for ${whenLabel(inv.eventStart)}` : ''}.</b> The calendar invite went to {inv.emails.join(', ')}. Need a different time? Reply to the invite.</div>
        : inv.expired ? <div className="ck-msg err">This link has expired. Reply to the email and we’ll send a new one.</div>
          : <ConsultPicker token={token} slots={slots} />}
    </main>
  );
}
