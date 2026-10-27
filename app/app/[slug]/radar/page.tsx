// Competitor Radar (Growth): the insurance offices around this agency, mapped by the competitor sweep and filtered
// on screen by radius, carrier and ZIP. Only place IDs and our own classification are stored (carrier, segment,
// miles, bearing); names, Google ratings and reviews, ZIPs and websites come live from Google Maps for the nearest
// offices on each visit. Each office opens its public Facebook/Instagram and Google ads.
import { PlacesPausedNotice } from '@/components/PlacesPausedNotice';
import { AgencyShell, agencyContext } from '@/components/AgencyShell';
import { ModuleGate } from '@/components/ModuleGate';
import { Empty } from '@/components/ui';
import { RadarBoard, type RadarOffice, type RadarView } from '@/components/RadarBoard';
import { db } from '@/lib/supabase/server';
import { accessFor } from '@/lib/access';
import { GOOGLE_ATTRIBUTION, getOfficeCard } from '@/lib/places';

export const metadata = { title: 'Competitor Radar' };
export const dynamic = 'force-dynamic';

const LIVE = 60; // Google lookups per visit: the nearest offices, which is what the default view shows

type Row = { id: string; place_id: string; segment: 'captive' | 'independent'; distance_mi: number; bearing_deg: number; carrier: string };

export default async function Radar({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await agencyContext(slug);
  const access = await accessFor(ctx.tenant.tenantId, ctx.tenant.plan);
  if (!access.has('radar')) return <AgencyShell ctx={ctx} title="Competitor Radar"><ModuleGate ctx={ctx} moduleKey="radar" /></AgencyShell>;
  const supabase = await db();
  const tid = ctx.tenant.tenantId;
  const [{ data: rows }, { data: scan }, { data: views }, { data: prof }] = await Promise.all([
    supabase.from('competitor_offices').select('id, place_id, carrier, segment, distance_mi, bearing_deg').eq('tenant_id', tid).order('distance_mi').limit(400),
    supabase.from('competitor_scans').select('radius_mi, status, own_place_id, started_at').eq('tenant_id', tid).in('status', ['done', 'budget', 'running']).order('started_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('radar_views').select('id, name, radius_mi, carriers, zips').eq('tenant_id', tid).order('created_at'),
    supabase.from('agency_profiles').select('carrier').eq('tenant_id', tid).maybeSingle(),
  ]);
  const all = (rows ?? []) as Row[];
  if (!all.length || !scan) {
    return (
      <AgencyShell ctx={ctx} title="Competitor Radar">
        <Empty title="Your radar isn’t mapped yet">The Genovus team maps the insurance offices around your office in one sweep (usually a few dollars, never over its cap). Once it’s done, you can narrow by miles, carrier and ZIP code here, for free.</Empty>
      </AgencyShell>
    );
  }
  const near = all.slice(0, LIVE);
  const [cards, ownCard] = await Promise.all([
    Promise.all(near.map((r) => getOfficeCard(r.place_id))),
    scan.own_place_id ? getOfficeCard(scan.own_place_id) : Promise.resolve(null),
  ]);
  const offices: RadarOffice[] = all.map((r, i) => {
    const c = i < LIVE ? cards[i] : null;
    return { id: r.id, placeId: r.place_id, carrier: r.carrier, segment: r.segment, miles: Number(r.distance_mi), bearing: r.bearing_deg, name: c?.name ?? null, rating: c?.rating ?? null, reviews: c?.reviews ?? 0, zip: c?.zip ?? null, website: c?.website ?? null, mapsUrl: c?.mapsUrl ?? null };
  });
  const own = ownCard ? { name: ctx.tenant.name, rating: ownCard.rating, reviews: ownCard.reviews, carrier: prof?.carrier ?? 'Your carrier' } : null;
  return (
    <AgencyShell ctx={ctx} title="Competitor Radar">
      <PlacesPausedNotice audience="agency" />
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        Who else sells insurance around your office. Narrow it by miles, carrier and ZIP code, then open any office’s public ads. Use it to position your own strengths: your ads never name or compare another office, and your carrier still approves them.
      </p>
      <RadarBoard tenantId={tid} offices={offices} swept={scan.radius_mi} own={own} views={(views ?? []) as RadarView[]} unnamed={Math.max(0, all.length - LIVE)} />
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>{GOOGLE_ATTRIBUTION}. Ratings and reviews are Google’s, looked up when you open this page.{scan.status === 'running' ? ' The sweep is still running; more offices appear as it goes.' : ''}</p>
    </AgencyShell>
  );
}
