// Renders the social setup wizard for either side of the call. Both get the same steps and kit;
// only the operator's copy carries the talk track, our-side tasks and the console API.
import { hasWelcome, type Client } from './clients';
import { clientStep, type Step } from './channels';
import type { Role } from './social-session';
import { setupFor } from './social-setup';
import { SOCIAL_TEMPLATE } from './templates';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** JSON inside a <script> block: escape anything that could close the tag. */
const safeJson = (v: unknown) =>
  JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/** Talk track for the screens around the channel steps. Operator only. */
const FIXED_TALK: Record<string, Pick<Step, 'say' | 'watch'>> = {
  start: {
    say: 'Today we set up your Facebook Page, Instagram and Google listing together. You own every account; I walk you through each click and your screen fills in as we go.',
    watch: ['Confirm the client has their phone for security codes.', 'If welcome step 2 (who approves marketing) is still open, settle it now.'],
  },
  review: {
    say: 'Before anything goes public, let’s read the copy together. Your marketing approver signs off here.',
    watch: [
      'The facts list the client’s work email address; confirm the approver is happy to show it publicly.',
      'Page names may need to follow carrier naming rules. Let the approver choose between the two.',
    ],
  },
  more: { say: 'Anything else you’d like us to set up later? We confirm scope and cost before doing anything.' },
  finish: {
    say: 'That’s everything for today. Here’s what happens next on our side.',
    watch: ['Check our portfolio and the Google invite before ending the call if they arrived.'],
  },
};

export function renderSocialPage(c: Client, role: Role): string {
  const setup = setupFor(c);
  const pick = (s: Step) => (role === 'operator' ? s : clientStep(s));
  const config = {
    role,
    // The console API sits under the console page so the browser sends the console sign-in with every call.
    api: role === 'operator' ? `/console/social/${c.slug}/api` : `/api/social/${c.token}`,
    storageKey: `gss-social-${c.slug}-v2`,
    clientFirst: c.firstName,
    operatorFirst: c.contactName.split(' ')[0] || 'Genesis',
    operatorName: c.contactName,
    back: role === 'client' && hasWelcome(c) ? `/welcome/${c.token}` : '',
    channels: setup.plan.map((ch) => ({
      id: ch.id,
      name: ch.name,
      summary: ch.summary,
      access: ch.access,
      profileLink: ch.profileLink ?? null,
      steps: ch.steps.map(pick),
    })),
    optional: setup.optional.map((ch) => ({ id: ch.id, name: ch.name, summary: ch.summary, access: ch.access })),
    screens: setup.screens,
    kit: setup.kit,
    talk: role === 'operator' ? FIXED_TALK : {},
  };
  const title = role === 'operator' ? `Console · ${c.fullName} social setup` : `${c.firstName} Social Setup · Genesis Secure Solutions`;
  const fill: Record<string, string> = { TITLE: esc(title), ROLE: role, CONFIG: safeJson(config) };
  return SOCIAL_TEMPLATE.replace(/\{\{([A-Z_]+)\}\}/g, (m, k: string) => (k in fill ? fill[k] : m));
}

export const PAGE_HEADERS = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };
