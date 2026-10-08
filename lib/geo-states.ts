// State geometry in longitude/latitude (us-atlas, unprojected) for the scanner: each state's bounding box to
// tile searches. Server only; computed once per process.
import 'server-only';
import { feature } from 'topojson-client';
import { geoBounds } from 'd3-geo';
import type { Topology, GeometryCollection } from 'topojson-specification';
import states from 'us-atlas/states-10m.json';
import { STATE_ABBR } from './us-map';

type F = GeoJSON.Feature<GeoJSON.Geometry, { name: string }>;
let feats: { abbr: string; f: F; box: [[number, number], [number, number]] }[] | null = null;

function load() {
  if (feats) return feats;
  const topo = states as unknown as Topology<{ states: GeometryCollection }>;
  const fc = feature(topo, topo.objects.states) as unknown as GeoJSON.FeatureCollection<GeoJSON.Geometry, { name: string }>;
  feats = fc.features.flatMap((f) => {
    const abbr = STATE_ABBR[f.properties.name];
    if (!abbr) return [];
    let [[w, s], [e, n]] = geoBounds(f);
    if (w > e) { w = -180; } // Alaska crosses the antimeridian: keep the US side
    return [{ abbr, f, box: [[w, s], [e, n]] as [[number, number], [number, number]] }];
  });
  return feats;
}

/** [[west, south], [east, north]] for a state, or null. */
export function stateBox(abbr: string) {
  return load().find((x) => x.abbr === abbr)?.box ?? null;
}


/** Split a state's box into starting cells of at most `step` degrees per side. */
export function startingCells(abbr: string, step = 1) {
  const box = stateBox(abbr);
  if (!box) return [];
  const [[w, s], [e, n]] = box;
  const cols = Math.max(1, Math.ceil((e - w) / step)), rows = Math.max(1, Math.ceil((n - s) / step));
  const dx = (e - w) / cols, dy = (n - s) / rows;
  const out: { south: number; west: number; north: number; east: number }[] = [];
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const r = (v: number) => Math.round(v * 1e5) / 1e5;
    out.push({ west: r(w + i * dx), east: r(w + (i + 1) * dx), south: r(s + j * dy), north: r(s + (j + 1) * dy) });
  }
  return out;
}
