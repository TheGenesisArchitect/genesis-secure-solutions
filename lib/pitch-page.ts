// The Genovus pitch storyboard page. Server-only; the page lives at /pitch/<token> and is noindex.
// Content here is the external story: live features are marked live, planned ones "in development".
import { timingSafeEqual } from 'node:crypto';
import pitch from '@/data/pitch.json';
import { PITCH_TEMPLATE } from './templates';
import { SCENES } from '@/data/story';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function pitchTokenOk(token: string): boolean {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return false;
  const a = Buffer.from(token), b = Buffer.from(pitch.token);
  return a.length === b.length && timingSafeEqual(a, b);
}



const FLOW: [string, string, boolean][] = [
  ['Attract', 'Funnel, live demo and referrals', false], ['Consult', 'A call about the office and its goals', false], ['Propose', 'The right plan, priced', false],
  ['Deposit', '70% to start, 30% at launch', false], ['Intake', 'One agent record', true], ['Build', 'Site, copy, cover art, welcome package', true],
  ['Live setup', 'Profiles set up together on a call', true], ['Approve', 'Approver signs off on every word', true], ['Launch', 'Site and profiles go live together', false], ['Care', 'Monthly posts, leads and reports', false],
];

const PLANS: [string, string, string, string][] = [
  ['Launch', 'A single agency getting started', '$1,500 setup · $249 a month', 'Website, Facebook, Instagram and Google set up live; approval built in; tracked callbacks'],
  ['Growth', 'Agencies ready to grow', '$2,500 setup · $399 a month', 'Everything in Launch, plus monthly posts, booking and reviews, and lead tracking'],
  ['Premium', 'Established agencies', '$5,000 setup · $799 a month', 'Everything in Growth, plus campaign pages, ads management and concierge support'],
  ['Network', 'Groups of agents, such as an agency owner’s network', 'Group pricing', 'Group onboarding, shared approved templates and referral credits'],
  ['Enterprise', 'Carriers', 'Network pricing · starts with a 90-day pilot', 'Carrier wording rules and templates, approval routing and a network dashboard'],
];

const ROAD: [string, string, string[]][] = [
  ['Live today', 'live', ['Agent record and profile kit', 'Personal welcome package', 'Live guided setup with the specialist leading', 'Copy editing, flags and AI suggestions within limits', 'Approver sign-off, reset on any change', 'Tracked callbacks on agency sites']],
  ['In development', 'dev', ['Carrier wording rules and template library', 'Approval routing with audit trail', 'Monthly content drafts from approved templates', 'Agency and network dashboards', 'Consent-tracked lead pipeline']],
  ['Next', 'dev', ['Direct publishing through Meta after App Review', 'Self-serve agency signup', 'More carriers and lines of business']],
];

function eco(): string {
  const node = (x: number, y: number, title: string, sub: string, accent = false) =>
    `<g><rect x="${x - 120}" y="${y - 44}" width="240" height="88" rx="16" fill="${accent ? 'rgba(255,106,43,.14)' : 'rgba(255,255,255,.04)'}" stroke="${accent ? '#ff6a2b' : 'rgba(255,255,255,.18)'}" stroke-width="2"/>` +
    `<text x="${x}" y="${y - 6}" text-anchor="middle" fill="#f4f5f7" font-family="Archivo, Arial Black, sans-serif" font-weight="800" font-size="20">${esc(title)}</text>` +
    `<text x="${x}" y="${y + 22}" text-anchor="middle" fill="#c5c8cf" font-family="Inter, sans-serif" font-size="14">${esc(sub)}</text></g>`;
  const line = (x1: number, y1: number, x2: number, y2: number) => `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="url(#eg)" stroke-width="3" fill="none"/>`;
  return `<svg viewBox="0 0 1100 420" role="img" aria-label="Genovus connects carriers, agencies, agents and customers">
<defs><linearGradient id="eg" x1="0" x2="1"><stop offset="0" stop-color="#ff5a20"/><stop offset="1" stop-color="#ffa31a"/></linearGradient></defs>
${line(550, 210, 160, 90)}${line(550, 210, 940, 90)}${line(550, 210, 160, 330)}${line(550, 210, 940, 330)}
<circle cx="550" cy="210" r="86" fill="#0b0c10" stroke="#ff6a2b" stroke-width="3"/>
<text x="550" y="204" text-anchor="middle" fill="#f4f5f7" font-family="Archivo, Arial Black, sans-serif" font-weight="800" font-size="22" letter-spacing="3">GENOVUS</text>
<text x="550" y="230" text-anchor="middle" fill="#8b909a" font-family="Inter, sans-serif" font-size="13">rules · records · approvals</text>
${node(160, 90, 'Carrier', 'Rules, templates, network view', true)}${node(940, 90, 'Agencies', 'Site, profiles, plan, reports')}
${node(160, 330, 'Agents', 'Live setup, their own words')}${node(940, 330, 'Customers', 'A local office they can trust')}
</svg>`;
}

export function renderPitchPage(): string {
  const base = `/p/${pitch.token}`;
  const fill: Record<string, string> = {
    BASE: base,
    ECO: eco(),
    BOARD: SCENES.map((s, i) => `<article class="sc"><img src="${base}/stills/${s.still}.jpg" alt="Scene ${i + 1}: ${esc(s.title)}" loading="lazy"><div class="b"><div class="k"><span>Scene ${String(i + 1).padStart(2, '0')}</span><span class="chip ${s.live ? 'live' : 'dev'}">${s.live ? 'Live' : 'In development'}</span></div><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p></div></article>`).join(''),
    FLOW: FLOW.map(([t, d, live]) => `<li class="${live ? 'live' : ''}"><b>${esc(t)}</b><span>${esc(d)}</span></li>`).join(''),
    PLANS: PLANS.map(([n, w, p, inc]) => `<tr><td><b>${esc(n)}</b></td><td>${esc(w)}</td><td class="p">${esc(p)}</td><td>${esc(inc)}</td></tr>`).join(''),
    ROAD: ROAD.map(([t, k, items]) => `<div><h3><span class="chip ${k}">${esc(t)}</span></h3><ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join(''),
  };
  return PITCH_TEMPLATE.replace(/\{\{([A-Z_]+)\}\}/g, (m, k: string) => (k in fill ? fill[k] : m));
}
