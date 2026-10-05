// Social channel registry. One entry per channel; a client record lists which ones are part of their plan.
// Adding a channel later = one entry here (+ steps once they are verified) and one id in the client's JSON.
// Click paths were checked against each platform's help pages on 2026-10-05; platforms move menus, so re-check yearly.
// Safe to import anywhere: holds no secrets, tokens or prices.

export type Step = {
  id: string;
  title: string;
  why?: string;
  how: string[];
  link?: { label: string; url: string };
};

export const CHANNEL_IDS = ['facebook', 'instagram', 'meta-partner', 'google', 'linkedin', 'youtube', 'tiktok', 'nextdoor'] as const;
export type ChannelId = (typeof CHANNEL_IDS)[number];

export type Channel = {
  id: ChannelId;
  name: string;
  summary: string;
  /** How Genesis gets access without ever holding the client's password. */
  access: string;
  steps: Step[];
  /** The public link we ask the client to paste back, and the hosts it may point to. */
  profileLink?: { label: string; placeholder: string; hosts: string[] };
};

/** Values Genesis fills in once and every client sees. Unset = the page says we share it on the call. */
export type PartnerDetails = { metaBusinessId?: string; googleInviteEmail?: string };

export function partnerDetailsFromEnv(): PartnerDetails {
  const id = (process.env.GSS_META_BUSINESS_ID || '').trim();
  const email = (process.env.GSS_GOOGLE_INVITE_EMAIL || '').trim();
  return {
    metaBusinessId: /^\d{8,20}$/.test(id) ? id : undefined,
    googleInviteEmail: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined,
  };
}

export function channelRegistry(p: PartnerDetails): Channel[] {
  const metaId = p.metaBusinessId
    ? `Enter our business portfolio ID: ${p.metaBusinessId}.`
    : 'Enter our business portfolio ID. We read it to you on the call, or reply to your welcome email for it.';
  const googleEmail = p.googleInviteEmail ? `Enter ${p.googleInviteEmail}.` : 'Enter the email we give you on the call.';

  return [
    {
      id: 'facebook',
      name: 'Facebook Page',
      summary: 'Your agency’s public Page. It belongs to you; your personal profile stays private.',
      access: 'You own the Page through your personal Facebook login. We get partner access later in this guide.',
      profileLink: { label: 'Your Page link', placeholder: 'https://www.facebook.com/yourpage', hosts: ['facebook.com', 'www.facebook.com', 'm.facebook.com'] },
      steps: [
        {
          id: 'fb-2fa',
          title: 'Turn on two-factor authentication',
          why: 'Your Page is only as safe as your personal Facebook login, so lock that down first.',
          how: ['In Facebook, open Settings, then Accounts Center.', 'Choose Password and security, then Two-factor authentication, and follow the prompts.'],
          link: { label: 'Facebook: how two-factor authentication works', url: 'https://www.facebook.com/help/148233965247823' },
        },
        {
          id: 'fb-page',
          title: 'Create your business Page',
          why: 'This is the Page your posts, reviews and messages live on.',
          how: [
            'Choose Pages in the left menu, then Create Page.',
            'Pick Public Page, then Next, then Get Started.',
            'Use the office name your marketing approver signed off on, and an insurance agency category.',
          ],
          link: { label: 'Facebook: create a Page', url: 'https://www.facebook.com/help/104002523024878' },
        },
        {
          id: 'fb-details',
          title: 'Fill in your Page details',
          why: 'People trust a Page whose details match your website exactly.',
          how: [
            'Add your phone, address and hours exactly as they appear on your site.',
            'Use your portrait as the profile photo. We can supply a cover image.',
            'Add a button that calls your office or opens your website.',
          ],
        },
        {
          id: 'fb-portfolio',
          title: 'Create your business portfolio',
          why: 'A business portfolio is how you share access with us without sharing a password.',
          how: ['Go to business.facebook.com and create a business portfolio in your agency’s name.', 'Add your Page to it under Accounts, then Pages.'],
          link: { label: 'Meta: create a business portfolio', url: 'https://www.facebook.com/business/help/1710077379203657' },
        },
      ],
    },
    {
      id: 'instagram',
      name: 'Instagram',
      summary: 'A professional account linked to your Page, so one post can go to both.',
      access: 'Linked to your Page and shared with us through your business portfolio.',
      profileLink: { label: 'Your Instagram link', placeholder: 'https://www.instagram.com/yourhandle', hosts: ['instagram.com', 'www.instagram.com'] },
      steps: [
        {
          id: 'ig-pro',
          title: 'Switch to a professional account',
          why: 'Only professional accounts can link to a Page, schedule posts and show insights.',
          how: [
            'In the Instagram app, open your profile, then the menu at the top right.',
            'Tap Account type and tools, then Switch to professional account, then Continue.',
            'Pick a category, choose Business, and confirm your contact details.',
            'A private account becomes public when you switch.',
          ],
          link: { label: 'Instagram: set up a business account', url: 'https://help.instagram.com/502981923235522' },
        },
        {
          id: 'ig-link',
          title: 'Connect Instagram to your Facebook Page',
          why: 'Linking lets us manage both from one place and answer messages from one inbox.',
          how: [
            'On your Facebook Page, open Settings, then Linked accounts.',
            'Choose Instagram, then Connect account, and log in to Instagram.',
            'One Instagram account connects to one Page.',
          ],
        },
      ],
    },
    {
      id: 'meta-partner',
      name: 'Partner access for Genesis',
      summary: 'One step gives us access to your Page and Instagram. You can remove it any time.',
      access: 'Partner access in your business portfolio. You keep full control.',
      steps: [
        {
          id: 'mp-access',
          title: 'Give Genesis Secure Solutions partner access',
          why: 'This is what lets us post, reply and report for you without your password.',
          how: [
            'Go to business.facebook.com/settings and pick your business portfolio.',
            'Under Users, choose Partners, then Add, then Give a partner access to your assets.',
            metaId,
            'Select your Page and Instagram account. Choose partial access for content, messages, comments and insights. Leave full control off.',
            'If Instagram is missing from the list, add it first under Accounts, then Instagram accounts.',
          ],
          link: { label: 'Meta: give a partner access to your assets', url: 'https://www.facebook.com/business/help/1717412048538897' },
        },
      ],
    },
    {
      id: 'google',
      name: 'Google Business Profile',
      summary: 'Your listing on Google Search and Maps, where most people check hours and reviews.',
      access: 'You add us as a Manager. Managers can’t add or remove people or delete the profile.',
      profileLink: {
        label: 'Your Google listing link',
        placeholder: 'https://maps.app.goo.gl/…',
        hosts: ['maps.app.goo.gl', 'g.page', 'www.google.com', 'google.com', 'maps.google.com', 'business.google.com', 'g.co'],
      },
      steps: [
        {
          id: 'g-claim',
          title: 'Add, claim or verify your listing',
          why: 'Only a verified owner can manage the listing and invite us.',
          how: [
            'No listing yet: go to business.google.com/add, choose Add your business to Google, and follow the prompts.',
            'Listing already there: find your office on Google Maps, choose Claim this business, then Manage now.',
            'Finish whichever verification method Google offers.',
          ],
          link: { label: 'Google: add or claim your Business Profile', url: 'https://support.google.com/business/answer/2911778' },
        },
        {
          id: 'g-match',
          title: 'Match your details to your website',
          why: 'Customers and Google both trust a listing whose details agree everywhere.',
          how: ['Use the same office name, address, phone and hours as your site and Facebook Page.'],
        },
        {
          id: 'g-manager',
          title: 'Add Genesis as a Manager',
          why: 'This lets us post updates and answer reviews for you.',
          how: [
            'Open your Business Profile, then More, then Business Profile settings, then People and access.',
            `Choose Add. ${googleEmail}`,
            'Under Access, choose Manager, then Invite.',
          ],
          link: { label: 'Google: add owners and managers', url: 'https://support.google.com/business/answer/3403100' },
        },
      ],
    },
    {
      id: 'linkedin',
      name: 'LinkedIn Page',
      summary: 'Useful for recruiting team members and reaching local employers.',
      access: 'You stay Super admin and add us as a Content admin. We walk through it together on a call.',
      steps: [],
    },
    {
      id: 'youtube',
      name: 'YouTube channel',
      summary: 'Short videos answering the coverage questions people already search for.',
      access: 'You invite us by email from Settings, then Permissions, as a Manager or Editor.',
      steps: [],
    },
    {
      id: 'tiktok',
      name: 'TikTok',
      summary: 'Short videos that reach younger drivers and first-time renters.',
      access: 'Set up as a business account. We confirm the access steps with you on a call.',
      steps: [],
    },
    {
      id: 'nextdoor',
      name: 'Nextdoor Business Page',
      summary: 'Where neighbors recommend local businesses to each other.',
      access: 'A free page you claim at nextdoor.com/business. We set it up with you on a call.',
      steps: [],
    },
  ];
}

export const GOOGLE_OWNERS = ['me', 'carrier', 'none', 'unsure'] as const;
export type GoogleOwner = (typeof GOOGLE_OWNERS)[number];
/** Google steps only apply when the agent runs the listing or there isn't one yet. */
export const googleStepsApply = (o: GoogleOwner | '') => o === 'me' || o === 'none';

/** Answering "who looks after your Google listing" counts as a step of its own. */
export const GOOGLE_QUESTION = 'g-owner';

/** The step ids that count toward this client's progress, given their answer about Google. */
export function applicableStepIds(plan: Channel[], owner: GoogleOwner | ''): string[] {
  return plan.flatMap((c) =>
    c.id === 'google' ? [GOOGLE_QUESTION, ...(googleStepsApply(owner) ? c.steps.map((s) => s.id) : [])] : c.steps.map((s) => s.id),
  );
}

/** How many applicable steps are done; the Google question is done once it has any answer. */
export function countDone(ids: string[], done: string[], owner: GoogleOwner | ''): number {
  return ids.filter((id) => (id === GOOGLE_QUESTION ? owner !== '' : done.includes(id))).length;
}

/** Split the registry into the client's plan channels and the optional ones they can ask for. */
export function channelsForClient(all: Channel[], planIds: readonly string[]) {
  const plan = planIds.map((id) => all.find((c) => c.id === id)).filter((c): c is Channel => Boolean(c));
  const optional = all.filter((c) => !planIds.includes(c.id));
  return { plan, optional };
}
