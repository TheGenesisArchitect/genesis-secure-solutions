// Social channel registry: the wizard's steps, in order, for every channel Genesis supports.
// A client record lists which channels are in their plan; every other channel shows as optional.
// Adding a channel later = one entry here (steps only once verified) and one id in the client's JSON.
// Click paths were checked against each platform's help pages on 2026-10-05; re-check yearly.
// `say`, `watch` and `ours` are the operator's talk track: the server strips them before the client sees a step.

export type KitTextKey = 'category' | 'fbBio' | 'igName' | 'igBio' | 'gDescription' | 'services';
export type KitAssetKey = 'cover' | 'mark' | 'googleLogo';
export type FieldKey = 'pageName' | 'igUsername' | 'hours';

export type KitBlock =
  | { type: 'pick'; field: 'pageName'; label: string }
  | { type: 'copy'; key: KitTextKey; label: string; limit?: number; note?: string }
  | { type: 'facts' }
  | { type: 'field'; field: 'igUsername' | 'hours'; label: string; placeholder: string }
  | { type: 'asset'; key: KitAssetKey; label: string; note: string }
  | { type: 'link'; channel: ChannelId }
  | { type: 'tip'; text: string };

export type Step = {
  id: string;
  title: string;
  why?: string;
  how: string[];
  link?: { label: string; url: string };
  /** A question step is done once it has an answer, not by ticking it. */
  kind?: 'question';
  kit?: KitBlock[];
  say?: string;
  watch?: string[];
  ours?: string;
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

/** Answering "who looks after your Google listing" is a step of its own. */
export const GOOGLE_QUESTION = 'g-owner';
export const GOOGLE_OWNERS = ['me', 'carrier', 'none', 'unsure'] as const;
export type GoogleOwner = (typeof GOOGLE_OWNERS)[number];
/** The remaining Google steps only apply when the agent runs the listing or there isn't one yet. */
export const googleStepsApply = (o: GoogleOwner | '') => o === 'me' || o === 'none';

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
          why: 'Your Page is managed from your personal Facebook login, so we lock that down first.',
          how: [
            'No Facebook account yet? Sign up at facebook.com with your own name. Pages are always managed from a personal account, and nobody sees which one.',
            'In Facebook, open Settings, then Accounts Center.',
            'Choose Password and security, then Two-factor authentication, and follow the prompts. A text message or an authenticator app both work.',
          ],
          link: { label: 'Facebook: how two-factor authentication works', url: 'https://www.facebook.com/help/148233965247823' },
          say: 'Your Page will run through your personal login, so we protect that first. This takes two minutes and stops most account takeovers.',
          watch: ['If the client has no Facebook account, they sign up with their own name; a business name on a personal profile breaks the rules.', 'Have them save the backup codes somewhere they can find them.'],
        },
        {
          id: 'fb-page',
          title: 'Create your business Page',
          why: 'This is the Page your posts, reviews and messages live on. It is public as soon as you create it.',
          how: [
            'Choose Pages in the left menu (it may sit under See more), then Create Page.',
            'Pick Public Page, then Next, then Get Started.',
            'Type the Page name you picked below, and choose the category below.',
            'Skip the optional extras for now; we fill them in on the next step.',
          ],
          link: { label: 'Facebook: create a Page', url: 'https://www.facebook.com/help/104002523024878' },
          kit: [
            { type: 'pick', field: 'pageName', label: 'Page name' },
            { type: 'copy', key: 'category', label: 'Category' },
            { type: 'link', channel: 'facebook' },
          ],
          say: 'Pick the name your approver signed off on. Once the Page is created it is public, so we only do this after the copy review.',
          watch: ['Check the copy review is approved before they press Create.', 'If Facebook suggests a different category, the closest insurance one is fine.'],
        },
        {
          id: 'fb-details',
          title: 'Fill in your Page details',
          why: 'People trust a Page whose details match your website exactly.',
          how: [
            'On your Page, find Intro and choose Add bio or Edit bio. Paste the bio below.',
            'Choose Edit details and add the phone, address, email and hours below, exactly as written.',
            'Add a button that calls your office.',
          ],
          kit: [
            { type: 'copy', key: 'fbBio', label: 'Bio', limit: 100 },
            { type: 'facts' },
            { type: 'field', field: 'hours', label: 'Your office hours', placeholder: 'Example: Mon–Fri 9am–6pm, Sat 10am–2pm' },
            { type: 'tip', text: 'Leave the website empty for now. We add it once your site is approved and live.' },
          ],
          say: 'Everything here is copy and paste. Matching details everywhere is what makes Google and customers trust the Page.',
          watch: ['Hours: type exactly what they say into the hours box so the Google listing matches later.'],
        },
        {
          id: 'fb-photos',
          title: 'Add your profile picture and cover',
          why: 'The cover matches your website, so people know they found the right office.',
          how: [
            'Download the cover and the brand mark below.',
            'On your Page, choose the profile picture circle and upload your portrait. Until your full-size portrait is ready, use the brand mark.',
            'Choose Add cover photo or Edit cover photo and upload the cover. Leave it centred.',
          ],
          kit: [
            { type: 'asset', key: 'cover', label: 'Facebook cover', note: 'Sized for computers and phones. Every word stays visible on a phone.' },
            { type: 'asset', key: 'mark', label: 'Brand mark', note: 'For the profile picture until your portrait is ready. It fits the circle crop.' },
          ],
          say: 'This is the header we designed to match your website. On a phone Facebook trims the sides, and we kept every word in the middle.',
          watch: ['If the cover looks zoomed, drag it back to centre before saving.'],
        },
        {
          id: 'fb-portfolio',
          title: 'Create your business portfolio',
          why: 'A business portfolio is how you share access with us without sharing a password.',
          how: [
            'Go to business.facebook.com and choose to create a business portfolio.',
            'Use your agency’s name and your work email, then confirm the email Meta sends you.',
            'Add your Page to it under Accounts, then Pages.',
          ],
          link: { label: 'Meta: create a business portfolio', url: 'https://www.facebook.com/business/help/1710077379203657' },
          say: 'Think of the portfolio as the folder that holds your Page and Instagram. It is what lets you give us access without a password.',
          watch: ['Meta may ask them to confirm the email before Accounts shows up. Wait for it rather than starting a second portfolio.'],
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
            'No Instagram yet? Download the app, sign up with your office email, and come back to this step.',
            'In the Instagram app, open your profile, then the menu at the top right.',
            'Tap Account type and tools, then Switch to professional account, then Continue.',
            'Pick a category, choose Business, and confirm your contact details.',
          ],
          link: { label: 'Instagram: set up a business account', url: 'https://help.instagram.com/502981923235522' },
          kit: [{ type: 'tip', text: 'A private account becomes public when you switch, so check old posts first if this is a personal account you already use.' }],
          say: 'A professional account is free. It unlocks scheduling and the numbers we report to you each month.',
          watch: ['If the client uses this account personally, suggest a fresh account for the office instead of switching their own.'],
        },
        {
          id: 'ig-profile',
          title: 'Set your username, name, bio and picture',
          why: 'Your username is how people find and tag you, so make it easy to say out loud.',
          how: [
            'On your profile, tap Edit profile.',
            'Change the username to one below, or type your own. Instagram tells you if it is taken.',
            'Paste the name and bio below, and use the brand mark as your picture until your portrait is ready.',
          ],
          kit: [
            { type: 'field', field: 'igUsername', label: 'The username you got', placeholder: 'javaagency.columbus' },
            { type: 'copy', key: 'igName', label: 'Name' },
            { type: 'copy', key: 'igBio', label: 'Bio', limit: 150 },
            { type: 'asset', key: 'mark', label: 'Brand mark', note: 'Fits the circle crop.' },
            { type: 'link', channel: 'instagram' },
          ],
          say: 'Try the first username. If it is taken, the next one. Then paste the name and the bio exactly.',
          watch: ['Usernames: letters, numbers, periods and underscores only, up to 30 characters.'],
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
          say: 'This joins the two, so a post can go to both and messages land in one inbox.',
          watch: ['If Linked accounts is missing, they are in their personal profile; switch into the Page first.'],
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
          say: 'This is the handshake. You keep ownership; we get only the tasks we need, and you can remove us any time.',
          watch: ['Read the business portfolio ID slowly; one wrong digit sends the request to someone else.', 'Partial access only. Full control is never needed.'],
          ours: 'Confirm the Page and Instagram now appear in our business portfolio, then assign them to the team.',
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
          id: GOOGLE_QUESTION,
          kind: 'question',
          title: 'Who looks after your Google listing today?',
          why: 'Some carriers manage their agents’ listings, so we check before changing anything.',
          how: ['Search your office name on Google Maps. If a listing shows up, think about who set it up.'],
          say: 'Before we touch Google, who manages your listing today? If your carrier does, we leave it alone.',
          watch: ['If the client is unsure, pick Not sure and move on; we check with the approver after the call.'],
        },
        {
          id: 'g-claim',
          title: 'Add, claim or verify your listing',
          why: 'Only a verified owner can manage the listing and invite us.',
          how: [
            'No listing yet: go to business.google.com/add, choose Add your business to Google, and follow the prompts.',
            'Listing already there: find your office on Google Maps, choose Claim this business, then Manage now.',
            'Finish whichever verification method Google offers. Some take a few days.',
          ],
          link: { label: 'Google: add or claim your Business Profile', url: 'https://support.google.com/business/answer/2911778' },
          say: 'Google needs to confirm you really run this office. Whatever method it offers, we can carry on while it finishes.',
          watch: ['Verification can take days. Mark the step done once it has started, and note the method below.'],
        },
        {
          id: 'g-match',
          title: 'Match your details and add your description',
          why: 'Customers and Google both trust a listing whose details agree everywhere.',
          how: [
            'In your Business Profile, choose Edit profile.',
            'Use the same name, phone, address and hours as your Facebook Page.',
            'Paste the description below. Google does not allow links or prices in it.',
          ],
          kit: [{ type: 'copy', key: 'gDescription', label: 'Business description', limit: 750 }, { type: 'facts' }, { type: 'link', channel: 'google' }],
          say: 'Same details as Facebook, word for word. The description is written to Google’s rules: no links, no prices.',
        },
        {
          id: 'g-photos',
          title: 'Add your logo and real photos',
          why: 'Google asks for real photos that show your office as it is, so people recognise it when they arrive.',
          how: [
            'Upload the logo below as your logo.',
            'Add a few real photos: the outside of the office, the inside, and you. Bright and in focus.',
            'Google recommends 720 by 720 pixels or larger, as JPG or PNG.',
          ],
          link: { label: 'Google: photo guidelines', url: 'https://support.google.com/business/answer/6103862' },
          kit: [{ type: 'asset', key: 'googleLogo', label: 'Google logo', note: 'Square, 720 × 720.' }],
          say: 'The logo is ready to upload. Real photos beat graphics on Google, so a quick photo of the door and the front desk goes a long way.',
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
          say: 'Manager, not Owner. You stay in charge; we can update the listing and answer reviews.',
          ours: 'Accept the Google manager invite from the email, then confirm the listing shows in our account.',
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

/** Split the registry into the client's plan channels and the optional ones they can ask for. */
export function channelsForClient(all: Channel[], planIds: readonly string[]) {
  const plan = planIds.map((id) => all.find((c) => c.id === id)).filter((c): c is Channel => Boolean(c));
  const optional = all.filter((c) => !planIds.includes(c.id));
  return { plan, optional };
}

/** Every tickable step id in the plan (question steps are answered, not ticked). */
export const tickableStepIds = (plan: Channel[]) => plan.flatMap((c) => c.steps.filter((s) => s.kind !== 'question').map((s) => s.id));

/** The step ids that count toward progress, given the answer about Google. */
export function applicableStepIds(plan: Channel[], owner: GoogleOwner | ''): string[] {
  return plan.flatMap((c) =>
    c.id === 'google' ? c.steps.filter((s) => s.id === GOOGLE_QUESTION || googleStepsApply(owner)).map((s) => s.id) : c.steps.map((s) => s.id),
  );
}

/** How many applicable steps are done; the Google question is done once it has any answer. */
export function countDone(ids: string[], done: string[], owner: GoogleOwner | ''): number {
  return ids.filter((id) => (id === GOOGLE_QUESTION ? owner !== '' : done.includes(id))).length;
}

/** The client's view of a step: the operator's talk track removed. */
export function clientStep(s: Step): Step {
  const { say: _say, watch: _watch, ours: _ours, ...rest } = s;
  return rest;
}
