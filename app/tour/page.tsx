// genovus.io/tour: take the tour with Helix. Pick a package and Helix walks through exactly what it includes, on
// the real product (fictional demo agency). Linked from the end card of Julian's Play-by-Play and its Shorts.
import { SiteChrome } from '@/components/SiteChrome';
import { PackageTour } from '@/components/site/PackageTour';
import { PACKAGE_TOURS } from '@/lib/package-tour';

export const metadata = { title: 'Take the tour with Helix', description: 'Helix walks you through what Launch, Growth and Premium include, on the real Genovus product.' };

export default async function Tour({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  const p = (await searchParams).plan;
  const initial = p === 'launch' || p === 'premium' ? p : 'growth';
  return (
    <SiteChrome>
      <main className="wrapx sec" style={{ paddingTop: 40, display: 'grid', gap: 22 }}>
        <div style={{ display: 'grid', gap: 10 }}>
          <div className="eyebrow">Take the tour with Helix</div>
          <h1 style={{ font: '800 clamp(28px,4.4vw,50px)/1.05 var(--display)', letterSpacing: '-.02em', maxWidth: '20ch', margin: 0 }}>Helix: the agent that knows and grows with your business.</h1>
          <p className="lede" style={{ margin: 0 }}>Pick your package. Helix shows you exactly what it includes, one real screen at a time. Talk with Helix any time to ask as you go.</p>
        </div>
        <PackageTour tours={PACKAGE_TOURS} initial={initial} />
      </main>
    </SiteChrome>
  );
}
