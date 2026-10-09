import { VisionShell, Src } from '@/components/vision/VisionShell';
import { VisionMap } from '@/components/vision/VisionMap';
import { usStates, projectLonLat } from '@/lib/us-map';
import { MARKETS } from '@/data/vision';

export const metadata = { title: 'Growth Engine vision', robots: { index: false, follow: false } };

export default function VisionMapPage() {
  const { shapes, borders } = usStates();
  const points = MARKETS.flatMap((m) => {
    const xy = projectLonLat(m.lon, m.lat);
    return xy ? [{ ...m, x: xy[0], y: xy[1] }] : [];
  });
  return (
    <VisionShell
      slug=""
      lede={<>Genovus doesn’t wait for agents to find us. <b>Radar</b> maps every agency office in a state, by carrier and fit, then lines up the markets we’ll win next. This is where every campaign starts.</>}
      spec={[
        { title: 'Data', items: [
          { k: 'Source', v: <>Google Places API (New), text search per area, every carrier in the catalog + independents. <Src href="https://developers.google.com/maps/documentation/places/web-service/text-search">docs</Src></> },
          { k: 'Stored', v: 'Place ID + our own data only (carrier, segment, state, pipeline). Names and phones load live.' },
          { k: 'Cost guard', v: 'Every Google call metered against a monthly budget; the sweep stops itself.' },
        ] },
        { title: 'Built today', items: [
          { k: 'Scanner', v: 'Live in production: GA complete, AL/FL/TX in progress.' },
          { k: 'Tables', v: <code>prospects · carriers · scan_cells · places_usage</code> },
          { k: 'Next', v: <><code>markets</code>: metro clusters, the unit of plan, budget and reporting.</> },
        ] },
        { title: 'Agent', items: [
          { k: 'Radar (Lane 1)', v: 'Read-only sweeps on a schedule: new offices, closures, competitor ads. “Autonomous eyes, gated hands.”' },
          { k: 'Output', v: 'Ranked market queue + a brief per market, delivered in the Daily Briefing.' },
        ] },
      ]}
    >
      <VisionMap shapes={shapes.map((s) => ({ abbr: s.abbr, d: s.d }))} borders={borders} points={points} />
    </VisionShell>
  );
}
