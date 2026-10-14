// Helix's package tours (genovus.io/tour): what each package includes, step by step, from the same module list the
// agency dashboards unlock (lib/programs.ts), so the tour can never promise more than the package gives. Each live
// step shows its real screen (stills exported from the Screen Library, fictional demo agency); anything still in
// development is said and shown as in development. No prices on the tour.
import { MODULES, type ProgramId } from '@/lib/programs';

export type TourStep = { key: string; label: string; blurb: string; live: boolean; option?: boolean; screen: string | null; device: 'desktop' | 'phone'; inherited?: boolean };
export type PackageTour = { plan: ProgramId; name: string; promise: string; intro: string; steps: TourStep[] };

/** Which Screen Library screen shows each module (and on which device it reads best). */
const SCREEN: Record<string, [string, 'desktop' | 'phone']> = {
  leads: ['agency-leads', 'desktop'], today: ['agency-today', 'phone'], 'follow-ups': ['agency-followups', 'phone'], setup: ['agency-setup', 'desktop'],
  approvals: ['agency-approvals', 'phone'], care: ['agency-care', 'desktop'], performance: ['agency-performance', 'desktop'], assets: ['agency-program', 'desktop'],
  pipeline: ['agency-pipeline', 'desktop'], partners: ['agency-partners', 'desktop'], market: ['agency-market', 'desktop'], calendar: ['agency-calendar', 'desktop'],
  helix: ['agency-helix', 'desktop'], 'helix-notes': ['agency-helix-notes', 'desktop'], kpis: ['agency-performance', 'desktop'], content: ['agency-care', 'desktop'], calls: ['agency-leads', 'phone'],
};
/** Every still the tour shows (the export script and the page read this). */
export const TOUR_STILLS = [...new Set(Object.values(SCREEN).map(([s, d]) => `${s}-${d}`))];
export const stillSrc = (s: TourStep) => (s.screen ? `/tour/${s.screen}-${s.device}.jpg` : null);

const META: Record<ProgramId, { name: string; promise: string; intro: string }> = {
  launch: { name: 'Launch', promise: 'Get found. Answer every lead.', intro: 'Launch is everything an agency needs from day one: get found, answer every lead, and keep every promise.' },
  growth: { name: 'Growth', promise: 'Helix joins your team.', intro: 'Growth adds Helix, the agent that knows and grows with your business, plus a pipeline and calendar that run your week.' },
  premium: { name: 'Premium', promise: 'Run it hands-free.', intro: 'Premium is for running the office hands-free. Most of what it adds is still in development, and Helix will tell you exactly which parts.' },
};
const ORDER: ProgramId[] = ['launch', 'growth', 'premium'];

export function packageTour(plan: ProgramId): PackageTour {
  const rank = ORDER.indexOf(plan);
  const steps: TourStep[] = [];
  if (rank > 0) steps.push({ key: `everything-${ORDER[rank - 1]}`, label: `Everything in ${META[ORDER[rank - 1]].name}`, blurb: `All of ${META[ORDER[rank - 1]].name}, plus what follows.`, live: true, screen: 'agency-home', device: 'desktop', inherited: true });
  for (const m of MODULES.filter((x) => x.tier === plan)) {
    const sc = SCREEN[m.key];
    steps.push({ key: m.key, label: m.label, blurb: m.blurb, live: m.live, option: Boolean(m.option), screen: m.live && sc ? sc[0] : null, device: sc?.[1] ?? 'desktop' });
  }
  return { plan, ...META[plan], steps };
}
export const PACKAGE_TOURS = ORDER.map(packageTour);

/** Helix's voice instructions for one package tour: facts only from the steps, no prices, no coverage advice. */
export function packageTourVoice(t: PackageTour): string {
  const lines = t.steps.map((s) => `- ${s.key}: ${s.label}${s.live ? '' : ' (IN DEVELOPMENT: say so plainly)'}${s.option ? ' (an option on Growth, not included by default)' : ''}. ${s.blurb}`);
  return `You are Helix, the agent inside Genovus that knows and grows with an agency's business. You are giving a short spoken tour of the ${t.name} package to an insurance agency owner on genovus.io.

HOW YOU SPEAK: warm, sharp and brief, like a trusted office manager. One step at a time, two or three sentences each. No lists, no markdown.

THE TOUR: call show_step with a step key before you talk about it, so the screen follows you. Go in order, then ask if they want to see another package (switch_package) or talk to the team (talk_to_team). They can interrupt any time.

RULES (never break):
- Talk only about the steps below. Never invent features, numbers or timelines.
- Steps marked IN DEVELOPMENT are not available yet: say that plainly.
- Never mention prices or costs; say the team covers pricing on a call.
- Never quote insurance, bind, or give coverage advice.
- The agency on screen, Brooks Family Insurance, is a fictional demo agency.

${t.name.toUpperCase()}: ${t.promise} ${t.intro}
STEPS
${lines.join('\n')}

Begin with one sentence of welcome, then show the first step.`;
}

export const PACKAGE_TOOLS = [{
  functionDeclarations: [
    { name: 'show_step', description: 'Show a step of the package tour on screen. Call before talking about it.', parameters: { type: 'OBJECT', properties: { key: { type: 'STRING' } }, required: ['key'] } },
    { name: 'switch_package', description: 'Switch the tour to another package when the person asks.', parameters: { type: 'OBJECT', properties: { plan: { type: 'STRING', enum: ['launch', 'growth', 'premium'] } }, required: ['plan'] } },
    { name: 'talk_to_team', description: 'Show a button to talk to the Genovus team (pricing, questions, getting started).', parameters: { type: 'OBJECT', properties: {} } },
    { name: 'end_tour', description: 'End the conversation when the person says they are done.', parameters: { type: 'OBJECT', properties: {} } },
  ],
}];
