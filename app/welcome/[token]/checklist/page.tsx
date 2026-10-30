// The client's setup checklist (lib/checklist.ts), from their welcome link: what we still need for their site and
// dashboard, filled in their own words and saved to their record. Private link; never indexed.
import { notFound } from 'next/navigation';
import { tenantForToken } from '@/lib/client-checklist';
import { checklistStatus, LINE_OPTIONS } from '@/lib/checklist';
import { ChecklistForm } from '@/components/ChecklistForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your setup checklist', robots: { index: false, follow: false } };

export default async function Checklist({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const who = await tenantForToken(token);
  if (!who) notFound();
  const s = checklistStatus(who.record);
  const first = String(who.record.contactName ?? '').split(/\s+/)[0];
  const values = Object.fromEntries(Object.entries(s.intake).map(([k, v]) => [k, typeof v === 'string' ? v : v ? 'saved' : '']));
  return (
    <main className="checklist">
      <header className="ck-top"><img src="/brand/genovus/genovus-egg.svg" alt="" width={30} height={38} /><span>Genovus</span></header>
      <section className="ck-hero">
        <p className="ck-eye">{who.name}</p>
        <h1>{first ? `${first}, a few things` : 'A few things'} for your site</h1>
        <p className="ck-sub">About ten minutes. Everything here goes straight onto your site and dashboard, and you can come back to this link any time to change it.</p>
      </section>
      <ChecklistForm token={token} items={s.items.map(({ key, label, help, kind, required, options, done }) => ({ key, label, help, kind, required, options: kind === 'lines' ? LINE_OPTIONS : options, done }))} values={values} />
    </main>
  );
}
