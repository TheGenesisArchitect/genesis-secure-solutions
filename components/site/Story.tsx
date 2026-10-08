// The scroll story on genovus.io: five pinned scenes, from one record to the whole network.
// Server part: draws the US map (pre-projected us-atlas states) and the illustrative office dots, so the
// browser receives finished SVG paths instead of map data. Animation lives in StoryClient.
import { feature, mesh } from 'topojson-client';
import { geoPath } from 'd3-geo';
import type { Topology, GeometryCollection } from 'topojson-specification';
import states from 'us-atlas/states-albers-10m.json';
import { StoryClient, type MapData } from './StoryClient';

function buildMap(): MapData {
  const topo = states as unknown as Topology<{ states: GeometryCollection; nation: GeometryCollection }>;
  const path = geoPath();
  const fc = feature(topo, topo.objects.states) as unknown as GeoJSON.FeatureCollection;
  const land = path(feature(topo, topo.objects.nation) as unknown as GeoJSON.FeatureCollection) ?? '';
  const borders = path(mesh(topo, topo.objects.states, (a, b) => a !== b)) ?? '';
  // Illustrative offices: a few per state around its centroid, deterministic so the picture never changes.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const dots: { x: number; y: number; live: boolean }[] = [];
  for (const f of fc.features) {
    const [cx, cy] = path.centroid(f);
    if (!isFinite(cx)) continue;
    const area = path.area(f);
    const n = Math.max(1, Math.min(14, Math.round(Math.sqrt(area) / 22)));
    for (let i = 0; i < n; i++) {
      const r = Math.sqrt(area) * 0.22 * Math.sqrt(rnd());
      const a = rnd() * Math.PI * 2;
      dots.push({ x: +(cx + Math.cos(a) * r).toFixed(1), y: +(cy + Math.sin(a) * r).toFixed(1), live: rnd() < 0.24 });
    }
  }
  return { land, borders, dots };
}

export function Story() {
  return <StoryClient map={buildMap()} />;
}
