// Draws the homepage's US map outline (land + state borders, pre-projected us-atlas) into public/site/usmap.svg.
// The page used to inline these paths (~118 KB, sent twice: in the HTML and again in the React payload); as a
// static file the browser fetches it once, caches it, and only the office dots stay in the page.
//   node scripts/build-usmap.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { feature, mesh } from 'topojson-client';
import { geoPath } from 'd3-geo';

const topo = JSON.parse(readFileSync(new URL('../node_modules/us-atlas/states-albers-10m.json', import.meta.url), 'utf8'));
const path = geoPath().digits(1); // 0.1 px precision on a 975 px map: invisible, and a much smaller file
const land = path(feature(topo, topo.objects.nation));
const borders = path(mesh(topo, topo.objects.states, (a, b) => a !== b));
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 975 610">`
  + `<path d="${land}" fill="rgba(255,255,255,.03)" stroke="rgba(255,255,255,.12)"/>`
  + `<path d="${borders}" fill="none" stroke="rgba(255,255,255,.07)"/></svg>\n`;
writeFileSync(new URL('../public/site/usmap.svg', import.meta.url), svg);
console.log(`public/site/usmap.svg: ${(svg.length / 1024).toFixed(1)} KB`);
