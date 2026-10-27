// Says so, plainly, when Google lookups are paused for the month (lib/places.ts placesPaused), instead of leaving
// pages to show codes or blanks without a reason. Staff see the budget and where to raise it; agencies see when
// names come back and that their own records still show.
import Link from 'next/link';
import { placesPaused } from '@/lib/places';

export async function PlacesPausedNotice({ audience }: { audience: 'staff' | 'agency' }) {
  const p = await placesPaused();
  if (!p.paused) return null;
  return (
    <div className="notice warn" role="status" data-places-paused>
      {audience === 'staff' ? (
        <>
          <b>Google names are paused.</b> This month’s Google lookup budget is used (${(p.spent / 100).toFixed(2)} of ${(p.budget / 100).toFixed(0)}), so offices show your team’s saved names, or their code where nobody has logged a call yet. Lookups come back {p.resumes}, or raise the budget in <Link href="/console/carriers">Carriers &amp; scanner</Link>.
        </>
      ) : (
        <>
          <b>Some Google details are paused until {p.resumes}.</b> Names, ratings and addresses from Google Maps come back then. Everything you’ve saved yourself still shows.
        </>
      )}
    </div>
  );
}
