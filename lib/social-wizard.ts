// The dashboard's Social setup wizard (app/app/[slug]/social): every channel the agency wants, one at a time.
// Each channel starts with one question, "Do you already have it?":
//   have   -> paste your link -> give Genovus access (no password) -> connect it to your Metricool brand
//   create -> the guided steps from lib/channels.ts (the same click paths the live call uses), with profile wording
//             from the agency's record that they approve before anything public is created -> the same three steps
//   skip   -> "Not now"; they can come back any time
// Google asks first who runs the listing: the carrier's listing is left alone. The talk track (say/watch/ours) is
// stripped here, so it never reaches the browser. Server only; the page passes the result to components/SocialWizard.
import 'server-only';
import { channelRegistry, partnerDetailsFromEnv, type ChannelId, type Step } from './channels';
import { adminDb } from './supabase/admin';

export const WIZARD_CHANNELS = ['facebook', 'instagram', 'google', 'linkedin', 'youtube', 'tiktok', 'nextdoor'] as const;
export type WizardChannel = (typeof WIZARD_CHANNELS)[number];
export const CORE: WizardChannel[] = ['facebook', 'instagram', 'google'];
/** Networks a Metricool brand can connect (Nextdoor can't, so its Metricool step is skipped). */
const METRICOOL_NETWORKS: WizardChannel[] = ['facebook', 'instagram', 'google', 'linkedin', 'youtube', 'tiktok'];
/** The intake field on the Welcome form that a saved link also fills. */
export const INTAKE_FIELD: Partial<Record<WizardChannel, string>> = { facebook: 'facebook', instagram: 'instagram', google: 'googleListing' };

export type Row = {
  channel: WizardChannel; path: 'have' | 'create' | 'skip' | null; google_owner: 'me' | 'carrier' | 'none' | 'unsure' | null;
  link: string | null; steps: string[]; copy: Record<string, string>; copy_ok_at: string | null; copy_ok_by: string | null;
  access: 'none' | 'sent' | 'granted'; access_at: string | null; metricool: 'none' | 'sent' | 'connected' | 'na'; metricool_at: string | null;
};

export type CopyField = { key: string; label: string; limit?: number; value: string; note?: string };
export type WizStep = { id: string; title: string; why?: string; how: string[]; link?: { label: string; url: string }; kind: 'guide' | 'copy' | 'link' | 'access' | 'metricool'; copy?: CopyField[]; facts?: [string, string][] };
export type WizChannel = {
  id: WizardChannel; name: string; summary: string; access: string; core: boolean; linkLabel: string; linkPlaceholder: string;
  createSteps: WizStep[]; tailSteps: WizStep[]; canCreate: boolean; metricool: boolean; row: Row;
  status: 'new' | 'progress' | 'waiting' | 'connected' | 'skipped' | 'carrier';
};
export type WizardData = { channels: WizChannel[]; facts: [string, string][]; connectUrl: string | null; agency: string; done: number; total: number };

const HOSTS: Record<WizardChannel, string[]> = {
  facebook: ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'fb.com'],
  instagram: ['instagram.com', 'www.instagram.com'],
  google: ['maps.app.goo.gl', 'g.page', 'www.google.com', 'google.com', 'maps.google.com', 'business.google.com', 'g.co', 'goo.gl'],
  linkedin: ['www.linkedin.com', 'linkedin.com'],
  youtube: ['www.youtube.com', 'youtube.com', 'm.youtube.com'],
  tiktok: ['www.tiktok.com', 'tiktok.com'],
  nextdoor: ['nextdoor.com', 'www.nextdoor.com', 'business.nextdoor.com'],
};
const PLACEHOLDER: Record<WizardChannel, string> = {
  facebook: 'https://www.facebook.com/yourpage', instagram: 'https://www.instagram.com/yourhandle', google: 'https://maps.app.goo.gl/…',
  linkedin: 'https://www.linkedin.com/company/youragency', youtube: 'https://www.youtube.com/@youragency', tiktok: 'https://www.tiktok.com/@youragency',
  nextdoor: 'https://nextdoor.com/pages/youragency',
};

/** A pasted profile link, cleaned: https only, and on the network's own site. */
export function cleanLink(channel: WizardChannel, raw: string): { ok: true; url: string } | { ok: false; error: string } {
  let v = raw.trim().slice(0, 400);
  if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(v)) v = `https://${v}`;
  let u: URL;
  try { u = new URL(v); } catch { return { ok: false, error: 'Paste the full link, starting with https://' }; }
  if (u.protocol !== 'https:') return { ok: false, error: 'Paste the full link, starting with https://' };
  if (!HOSTS[channel].includes(u.hostname.toLowerCase())) return { ok: false, error: `That doesn’t look like a ${NAME[channel]} link. Open your profile and copy the address from there.` };
  return { ok: true, url: u.toString() };
}
const NAME: Record<WizardChannel, string> = { facebook: 'Facebook', instagram: 'Instagram', google: 'Google', linkedin: 'LinkedIn', youtube: 'YouTube', tiktok: 'TikTok', nextdoor: 'Nextdoor' };

const strip = (s: Step, kind: WizStep['kind'] = 'guide'): WizStep => ({ id: s.id, title: s.title, why: s.why, how: s.how, link: s.link, kind });
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…`);

/** Profile wording from the agency's record, for them to edit and approve before a public profile is created. */
function suggestedCopy(rec: Record<string, unknown>, agency: string) {
  const carrier = str(rec.carrier), city = str(rec.city), state = str(rec.state), phone = str(rec.phone);
  const intake = (rec.intake ?? {}) as Record<string, unknown>;
  const lines = str(intake.linePages) || 'auto, home and more';
  const where = [city, state].filter(Boolean).join(', ');
  const office = carrier ? `${carrier} local office` : 'Local insurance office';
  return {
    category: 'Insurance agency',
    fbBio: clip(`${office}${where ? ` in ${where}` : ''}. ${lines.replace(/^\w/, (c) => c.toUpperCase())}. Call ${phone || 'us'}.`, 100),
    igName: clip(`${agency}${city ? ` · ${city}` : ''}`, 64),
    igBio: clip(`${office}${where ? ` · ${where}` : ''}\n${lines.replace(/^\w/, (c) => c.toUpperCase())}\nCall or tap below for a quote${phone ? ` · ${phone}` : ''}`, 150),
    gDescription: clip(`${agency} is a ${office.toLowerCase()}${where ? ` serving ${where} and nearby communities` : ''}. We help families and businesses with ${lines}. Stop by, call, or request a callback and a licensed member of our team will help you review your options.`, 750),
  };
}

const COPY_FIELDS: Record<string, { label: string; limit?: number; note?: string }> = {
  category: { label: 'Category' },
  fbBio: { label: 'Facebook bio', limit: 100 },
  igName: { label: 'Instagram name', limit: 64 },
  igBio: { label: 'Instagram bio', limit: 150 },
  gDescription: { label: 'Google description', limit: 750, note: 'Google allows no links or prices here.' },
};
const COPY_FOR: Partial<Record<WizardChannel, string[]>> = { facebook: ['category', 'fbBio'], instagram: ['igName', 'igBio'], google: ['gDescription'] };

export async function wizardData(tenantId: string): Promise<WizardData> {
  const db = adminDb();
  const [{ data: t }, { data: r }, { data: rows }] = await Promise.all([
    db.from('tenants').select('name, metricool_connect_url').eq('id', tenantId).single(),
    db.from('agent_records').select('data').eq('tenant_id', tenantId).eq('is_current', true).maybeSingle(),
    db.from('social_setup').select('*').eq('tenant_id', tenantId),
  ]);
  const rec = (r?.data ?? {}) as Record<string, unknown>;
  const intake = (rec.intake ?? {}) as Record<string, unknown>;
  const agency = str(rec.agencyName) || String(t?.name ?? '');
  const facts: [string, string][] = ([
    ['Name', agency], ['Phone', str(rec.phone)], ['Address', [str(rec.address), [str(rec.city), str(rec.state)].filter(Boolean).join(', ')].filter(Boolean).join(', ')],
    ['Email', str(rec.email)], ['Hours', str(intake.hours)], ['Website', str(rec.website)],
  ] as [string, string][]).filter(([, v]) => v);
  const suggested = suggestedCopy(rec, agency);
  const reg = channelRegistry(partnerDetailsFromEnv());
  const byId = new Map(reg.map((c) => [c.id, c]));
  const partner = byId.get('meta-partner')!.steps[0];
  const google = byId.get('google')!;
  const saved = new Map(((rows ?? []) as Row[]).map((x) => [x.channel, x]));

  const channels = WIZARD_CHANNELS.map((id): WizChannel => {
    const c = byId.get(id as ChannelId)!;
    const row: Row = saved.get(id) ?? { channel: id, path: null, google_owner: null, link: str(intake[INTAKE_FIELD[id] ?? '']) || null, steps: [], copy: {}, copy_ok_at: null, copy_ok_by: null, access: 'none', access_at: null, metricool: 'none', metricool_at: null };
    const keys = COPY_FOR[id] ?? [];
    const copyStep: WizStep[] = keys.length ? [{
      id: 'copy', kind: 'copy', title: 'Approve your profile wording',
      why: 'We wrote this from your agency record. Change anything, then approve it. Nothing public is created until you do.',
      how: [], copy: keys.map((k) => ({ key: k, ...COPY_FIELDS[k], value: row.copy[k] ?? (suggested as Record<string, string>)[k] ?? '' })),
    }] : [];
    // The guided build: Google's question step is asked on the card itself, so it's left out here.
    const guided = c.steps.filter((s) => s.kind !== 'question' && s.id !== 'g-manager').map((s) => ({ ...strip(s), facts: s.kit?.some((k) => k.type === 'facts') ? facts : undefined }));
    const createSteps = c.steps.length ? [...copyStep, ...guided] : [];
    const linkStep: WizStep = { id: 'link', kind: 'link', title: `Paste your ${NAME[id]} link`, why: 'So your website, Google and your dashboard all point to the same profile.', how: ['Open your profile, copy the address from the browser bar (or Share, then Copy link in the app), and paste it below.'] };
    const accessStep: WizStep =
      id === 'facebook' ? { ...strip(partner, 'access'), id: 'access', how: ['No business portfolio yet? At business.facebook.com, create one with your agency’s name and work email, then add your Page under Accounts, then Pages.', ...partner.how] }
      : id === 'instagram' ? { id: 'access', kind: 'access', title: 'Include Instagram in your partner access', why: 'Partner access is how we post, reply and report for you without your password.', how: ['Instagram rides on the same partner access as your Facebook Page.', 'In business.facebook.com/settings, under Accounts, then Instagram accounts, make sure your Instagram is in your business portfolio.', 'Then in Partners, select Genesis Secure Solutions LLC and add your Instagram account with the same partial access.'], link: partner.link }
      : id === 'google' ? { ...strip(google.steps.find((s) => s.id === 'g-manager')!, 'access'), id: 'access' }
      : { id: 'access', kind: 'access', title: 'Give Genovus access', why: 'So we can post and report without your password.', how: [c.access] };
    const mc = METRICOOL_NETWORKS.includes(id);
    const mcStep: WizStep = { id: 'metricool', kind: 'metricool', title: `Connect ${NAME[id]} to your Metricool brand`, why: 'Metricool is the scheduler Genovus posts through. Your approved posts go out from it, and your monthly numbers come back from it.', how: ['Open your connection link below. It belongs to your agency’s brand in Metricool.', `Choose ${NAME[id]}, sign in to ${NAME[id]} there, and allow access. You never share your password with us.`, 'You can disconnect it from Metricool or from your account settings any time.'] };
    const tailSteps = [linkStep, accessStep, ...(mc ? [mcStep] : [])];
    const status: WizChannel['status'] =
      row.path === 'skip' ? 'skipped'
      : id === 'google' && row.google_owner === 'carrier' ? 'carrier'
      : row.access === 'granted' && (!mc || row.metricool === 'connected' || row.metricool === 'na') ? 'connected'
      : row.access === 'sent' || row.metricool === 'sent' ? 'waiting'
      : row.path ? 'progress' : 'new';
    return {
      id, name: c.name, summary: c.summary, access: c.access, core: CORE.includes(id), linkLabel: c.profileLink?.label ?? `Your ${NAME[id]} link`, linkPlaceholder: PLACEHOLDER[id],
      createSteps, tailSteps, canCreate: createSteps.length > 0, metricool: mc, row, status,
    };
  });
  const counted = channels.filter((c) => c.core || (c.row.path && c.row.path !== 'skip'));
  return { channels, facts, connectUrl: (t?.metricool_connect_url as string | null) ?? null, agency, done: counted.filter((c) => ['connected', 'carrier', 'skipped'].includes(c.status)).length, total: counted.length };
}

/** For Ask Helix (lib/helix-agency.ts): where the agency is in Social setup and how each open step is done, so
 *  Helix can coach them through it one step at a time. Never includes anything secret. */
export async function socialBrief(tenantId: string, slug: string): Promise<string[]> {
  const d = await wizardData(tenantId);
  const word: Record<WizChannel['status'], string> = { new: 'not started', progress: 'in progress', waiting: 'done on their side, Genovus is confirming access', connected: 'connected', skipped: 'skipped for now', carrier: 'their carrier runs it (left alone)' };
  const lines = [`SOCIAL SETUP (the Social setup page, /app/${slug}/social; ${d.done} of ${d.total} set up; Metricool connection link ${d.connectUrl ? 'ready on the page' : 'not ready yet, Genovus is setting up their brand'}):`];
  for (const c of d.channels) {
    if (!c.core && !c.row.path) continue;
    const r = c.row;
    const steps = r.path === 'create' ? [...c.createSteps, ...c.tailSteps] : r.path === 'have' ? c.tailSteps : [];
    const open = steps.find((s) => !(s.kind === 'copy' ? r.copy_ok_at : s.kind === 'link' ? r.link : s.kind === 'access' ? r.access !== 'none' : s.kind === 'metricool' ? r.metricool !== 'none' : r.steps.includes(s.id)));
    const path = r.path === 'have' ? 'already has one' : r.path === 'create' ? 'building it with Genovus' : r.path === 'skip' ? 'skipped' : c.id === 'google' && !r.google_owner ? 'not answered who runs the listing yet' : 'not chosen yet';
    lines.push(`- ${c.name}: ${word[c.status]} · ${path}${r.link ? ` · link ${r.link}` : ''}${open ? ` · NEXT STEP "${open.title}": ${open.how.join(' ')}` : ''}`);
  }
  return lines;
}
