// US state shapes for the Network view, drawn on the server from us-atlas (pre-projected Albers USA,
// 975 x 610), so the browser receives finished SVG paths, never map data.
import 'server-only';
import { feature, mesh } from 'topojson-client';
import { geoPath } from 'd3-geo';
import type { Topology, GeometryCollection } from 'topojson-specification';
import states from 'us-atlas/states-albers-10m.json';

export const STATE_ABBR: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE',
  'District of Columbia': 'DC', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS',
  Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS',
  Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI',
  'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA',
  'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY',
};
export const STATE_NAME: Record<string, string> = Object.fromEntries(Object.entries(STATE_ABBR).map(([n, a]) => [a, n]));

export type StateShape = { abbr: string; name: string; d: string; cx: number; cy: number };

let cache: { shapes: StateShape[]; borders: string } | null = null;

export function usStates() {
  if (cache) return cache;
  const topo = states as unknown as Topology<{ states: GeometryCollection }>;
  const path = geoPath();
  const fc = feature(topo, topo.objects.states) as unknown as GeoJSON.FeatureCollection<GeoJSON.Geometry, { name: string }>;
  const shapes = fc.features.flatMap((f) => {
    const abbr = STATE_ABBR[f.properties.name];
    const d = path(f);
    if (!abbr || !d) return [];
    const [cx, cy] = path.centroid(f);
    return [{ abbr, name: f.properties.name, d, cx, cy }];
  });
  cache = { shapes, borders: path(mesh(topo, topo.objects.states, (a, b) => a !== b)) ?? '' };
  return cache;
}
