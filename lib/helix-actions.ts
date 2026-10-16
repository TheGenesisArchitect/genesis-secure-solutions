// What Helix can do on screen for the person it's talking with (Step 7, the "auto" lane): go to a page, find an item
// on it and point at it. Nothing here changes data. The page list is the person's own menu (lib/agency-nav.ts, the
// console rail), so Helix never offers a page they can't open.
import 'server-only';
import type { Viewer } from './session';
import { accessFor } from './access';
import { agencyNav, helixPages } from './agency-nav';
import { consoleNav } from '@/components/ConsoleShell';

export type HelixPage = { label: string; href: string };

/** The pages Helix may open for this person on this surface. */
export async function helixPagesFor(viewer: Viewer, surface: 'agency' | 'enterprise', t?: { id: string; slug: string; plan: string | null }): Promise<HelixPage[]> {
  // Enterprise also gets Helix knows (what Helix has learned), which sits under Helix notes rather than in the rail.
  if (surface === 'enterprise') return viewer.staff ? [...helixPages(consoleNav(viewer.staff.role)), { label: 'Helix knows', href: '/console/helix/knows' }] : [];
  if (!t) return [];
  const access = await accessFor(t.id, t.plan);
  const m = viewer.memberships.find((x) => x.tenantId === t.id);
  return helixPages(agencyNav(`/app/${t.slug}`, (k) => access.has(k), { isOwner: !m || m.role === 'owner', programTitle: '' }));
}

/** The navigation rules for typed Helix: it may add "go" to its JSON reply. */
export const textNavRules = (pages: HelixPage[]) => pages.length ? `
PAGES YOU CAN OPEN for this person (exact names): ${pages.map((p) => p.label).join(', ')}.
When the person asks to go to, open or show one of these pages, add "go": "<exact page name>" to your JSON reply and say in a few words that you're opening it. Only these names; never "go" anywhere else.` : '';

/** The navigation rules for voice Helix, with its tools. */
export const voiceNavRules = (pages: HelixPage[], leads: boolean) => pages.length ? `
MOVING AROUND THE SCREEN: you can open pages for the person and point at things. PAGES (exact names): ${pages.map((p) => p.label).join(', ')}.
- "Go to / open / show me <page>": call go_to with the exact page name, then say where you are in a few words.${leads ? `
- "Open / find / show me <a lead's name>": call open_lead with the name. If it finds more than one, ask which one. It only shows and points; it never changes the lead.` : ''}
- "Point to / where is <something on this page>": call highlight with the words on screen.
- Opening and pointing never change anything. You still never mark, book, send or delete anything yourself.` : '';

/** Voice tools for the confirm lane (agency): propose, then confirm only after a spoken yes; undo the last change. */
export const actTools = [
  { name: 'propose_action', description: 'Propose a change and put a confirmation card on screen. action: mark_lead (lead, status), book_lead (lead, day, time) or add_follow_up (who, day, time, reason). day YYYY-MM-DD, time HH:MM office time. Returns the summary to read out, or what is missing.', parameters: { type: 'OBJECT', properties: { action: { type: 'STRING', enum: ['mark_lead', 'book_lead', 'add_follow_up'] }, lead: { type: 'STRING' }, status: { type: 'STRING', enum: ['contacted', 'won', 'lost', 'new'] }, day: { type: 'STRING' }, time: { type: 'STRING' }, who: { type: 'STRING' }, reason: { type: 'STRING' } }, required: ['action'] } },
  { name: 'confirm_action', description: 'Do the change on the confirmation card. ONLY right after the person clearly said yes to the summary you read out in this conversation.', parameters: { type: 'OBJECT', properties: {} } },
  { name: 'undo_last', description: 'Undo the change Helix just made (within ten minutes), when the person asks to undo it.', parameters: { type: 'OBJECT', properties: {} } },
];

/** Voice tool declarations for moving around the screen. */
export const navTools = (pages: HelixPage[], leads: boolean) => pages.length ? [
  { name: 'go_to', description: 'Open one of the person’s pages. page: an exact page name from PAGES.', parameters: { type: 'OBJECT', properties: { page: { type: 'STRING', enum: pages.map((p) => p.label) } }, required: ['page'] } },
  ...(leads ? [{ name: 'open_lead', description: 'Find a lead by name and point at it on screen (opens Leads if they are not on this page). Returns how many leads match.', parameters: { type: 'OBJECT', properties: { name: { type: 'STRING' } }, required: ['name'] } }] : []),
  { name: 'highlight', description: 'Point at something on the current page: a name, heading or button label as it appears on screen.', parameters: { type: 'OBJECT', properties: { text: { type: 'STRING' } }, required: ['text'] } },
] : [];
