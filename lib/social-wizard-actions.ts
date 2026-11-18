'use server';
// Saves for the Social setup wizard (components/SocialWizard.tsx). Members of the agency and Genovus staff (helping on
// a call) can answer, paste links, tick steps and approve wording. Only staff confirm the Genovus side: access
// granted and the network showing in the agency's Metricool brand. Facebook plus Instagram access clears the
// "Meta access" launch item. A saved link also fills the matching Welcome form answer.
import { revalidatePath } from 'next/cache';
import { requireTenant } from './session';
import { adminDb } from './supabase/admin';
import { db } from './supabase/server';
import { checklistStatus } from './checklist';
import { WIZARD_CHANNELS, INTAKE_FIELD, cleanLink, type WizardChannel } from './social-wizard';

export type SocialResult = { ok?: string; err?: string };
const isChannel = (c: string): c is WizardChannel => (WIZARD_CHANNELS as readonly string[]).includes(c);
const STEP_ID = /^[a-z0-9-]{1,40}$/;

async function who(slug: string) {
  const { tenant, asStaff, viewer } = await requireTenant(String(slug).slice(0, 80));
  if (tenant.isSample && !asStaff) return { err: 'This is the sample agency: nothing here is saved.' } as const;
  return { tenantId: tenant.tenantId, asStaff, label: viewer.staff?.name ?? viewer.email ?? 'agency' } as const;
}

async function upsert(tenantId: string, channel: WizardChannel, patch: Record<string, unknown>, action: string, label: string) {
  const a = adminDb();
  const { error } = await a.from('social_setup').upsert({ tenant_id: tenantId, channel, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'tenant_id,channel' });
  if (error) return error.message;
  await a.rpc('log_event', { p_tenant: tenantId, p_action: `social.${action}`, p_subject: channel, p_before: null, p_after: { ...patch, by: label } });
  return null;
}
const done = (slug: string, ok: string): SocialResult => { revalidatePath(`/app/${slug}/social`); revalidatePath(`/app/${slug}/setup`); return { ok }; };

/** "Do you already have it?" (and, for Google, who runs the listing). */
export async function socialChoose(slug: string, channel: string, path: 'have' | 'create' | 'skip' | null, googleOwner?: string): Promise<SocialResult> {
  const w = await who(slug); if ('err' in w) return { err: w.err };
  if (!isChannel(channel) || (path !== null && !['have', 'create', 'skip'].includes(path))) return { err: 'Unknown choice.' };
  const owner = channel === 'google' && googleOwner && ['me', 'carrier', 'none', 'unsure'].includes(googleOwner) ? googleOwner : undefined;
  const e = await upsert(w.tenantId, channel, { path, ...(owner ? { google_owner: owner } : {}) }, 'choose', w.label);
  return e ? { err: e } : done(slug, path === 'skip' ? 'Skipped for now. You can come back any time.' : 'Saved.');
}

export async function socialLink(slug: string, channel: string, raw: string): Promise<SocialResult> {
  const w = await who(slug); if ('err' in w) return { err: w.err };
  if (!isChannel(channel)) return { err: 'Unknown channel.' };
  const c = cleanLink(channel, String(raw ?? ''));
  if (!c.ok) return { err: c.error };
  const e = await upsert(w.tenantId, channel, { link: c.url }, 'link', w.label);
  if (e) return { err: e };
  const field = INTAKE_FIELD[channel];
  if (field) {
    const a = adminDb();
    const { data: r } = await a.from('agent_records').select('data').eq('tenant_id', w.tenantId).eq('is_current', true).maybeSingle();
    const rec = (r?.data ?? {}) as Record<string, unknown>;
    const intake = { ...((rec.intake ?? {}) as object), [field]: c.url };
    await a.rpc('save_intake', { p_tenant: w.tenantId, p_intake: { [field]: c.url }, p_done: checklistStatus({ ...rec, intake }).done, p_attest: null });
  }
  return done(slug, 'Link saved.');
}

export async function socialStep(slug: string, channel: string, step: string, on: boolean): Promise<SocialResult> {
  const w = await who(slug); if ('err' in w) return { err: w.err };
  if (!isChannel(channel) || !STEP_ID.test(step)) return { err: 'Unknown step.' };
  const { data } = await adminDb().from('social_setup').select('steps').eq('tenant_id', w.tenantId).eq('channel', channel).maybeSingle();
  const cur = new Set<string>((data?.steps as string[] | undefined) ?? []);
  if (on) cur.add(step); else cur.delete(step);
  const e = await upsert(w.tenantId, channel, { steps: [...cur].slice(0, 40) }, on ? 'step.done' : 'step.undo', w.label);
  return e ? { err: e } : done(slug, on ? 'Step done.' : 'Step reopened.');
}

const LIMITS: Record<string, number> = { category: 60, fbBio: 100, igName: 64, igBio: 150, gDescription: 750 };
/** Profile wording: saved as typed; "approve" locks in the wording the agency signed off on. */
export async function socialCopy(slug: string, channel: string, copy: Record<string, string>, approve: boolean): Promise<SocialResult> {
  const w = await who(slug); if ('err' in w) return { err: w.err };
  if (!isChannel(channel)) return { err: 'Unknown channel.' };
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(copy ?? {})) {
    if (!(k in LIMITS)) continue;
    const t = String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();
    if (t.length > LIMITS[k]) return { err: `That’s ${t.length} characters; this one allows ${LIMITS[k]}.` };
    if (k === 'gDescription' && /https?:\/\/|www\.|\$\s?\d/i.test(t)) return { err: 'Google doesn’t allow links or prices in the description.' };
    if (approve && !t) return { err: 'Fill in every box before approving.' };
    clean[k] = t;
  }
  if (w.asStaff && approve) return { err: 'The agency approves its own wording. Save it, and they approve it here.' };
  const e = await upsert(w.tenantId, channel, { copy: clean, ...(approve ? { copy_ok_at: new Date().toISOString(), copy_ok_by: w.label } : { copy_ok_at: null, copy_ok_by: null }) }, approve ? 'copy.approve' : 'copy.save', w.label);
  return e ? { err: e } : done(slug, approve ? 'Approved. You can create your profile now.' : 'Saved.');
}

/** The agency's side: "I sent access" / "I connected it in Metricool". */
export async function socialSent(slug: string, channel: string, what: 'access' | 'metricool'): Promise<SocialResult> {
  const w = await who(slug); if ('err' in w) return { err: w.err };
  if (!isChannel(channel) || !['access', 'metricool'].includes(what)) return { err: 'Unknown step.' };
  const { data } = await adminDb().from('social_setup').select(what).eq('tenant_id', w.tenantId).eq('channel', channel).maybeSingle();
  const cur = (data as Record<string, string> | null)?.[what];
  if (cur === 'granted' || cur === 'connected') return done(slug, 'Already confirmed by Genovus.');
  const e = await upsert(w.tenantId, channel, { [what]: 'sent', [`${what}_at`]: new Date().toISOString() }, `${what}.sent`, w.label);
  return e ? { err: e } : done(slug, 'Thanks. Genovus confirms it on our side, usually within one business day.');
}

/** Staff only: what Genovus can see on its side. */
export async function socialConfirm(slug: string, channel: string, what: 'access' | 'metricool', value: string): Promise<SocialResult> {
  const w = await who(slug); if ('err' in w) return { err: w.err };
  if (!w.asStaff) return { err: 'Only the Genovus team confirms this.' };
  if (!isChannel(channel)) return { err: 'Unknown channel.' };
  const ok = what === 'access' ? ['none', 'sent', 'granted'] : what === 'metricool' ? ['none', 'sent', 'connected', 'na'] : [];
  if (!ok.includes(value)) return { err: 'Unknown value.' };
  const e = await upsert(w.tenantId, channel, { [what]: value, [`${what}_at`]: new Date().toISOString() }, `${what}.${value}`, w.label);
  if (e) return { err: e };
  if (what === 'access' && value === 'granted' && (channel === 'facebook' || channel === 'instagram')) {
    const { data: rows } = await adminDb().from('social_setup').select('channel, path, access').eq('tenant_id', w.tenantId).in('channel', ['facebook', 'instagram']);
    const st = new Map((rows ?? []).map((r) => [r.channel as string, r]));
    const fb = st.get('facebook'), ig = st.get('instagram');
    if (fb?.access === 'granted' && (ig?.access === 'granted' || ig?.path === 'skip')) {
      await (await db()).rpc('set_gate', { p_tenant: w.tenantId, p_kind: 'meta_access', p_status: 'cleared', p_evidence: `Partner access confirmed in the Genovus business portfolio (social setup, ${new Date().toISOString().slice(0, 10)}).` });
    }
  }
  return done(slug, 'Confirmed.');
}

/** Staff only: the agency's Metricool connection link (made in Metricool for the agency's brand). */
export async function socialConnectUrl(slug: string, url: string): Promise<SocialResult> {
  const w = await who(slug); if ('err' in w) return { err: w.err };
  if (!w.asStaff) return { err: 'Only the Genovus team sets this.' };
  const v = String(url ?? '').trim();
  if (v && !/^https:\/\/[^\s]+\.[^\s]+$/.test(v)) return { err: 'Paste the full https:// link from Metricool.' };
  const { error } = await adminDb().from('tenants').update({ metricool_connect_url: v || null }).eq('id', w.tenantId);
  if (error) return { err: error.message };
  await adminDb().rpc('log_event', { p_tenant: w.tenantId, p_action: 'social.metricool_link', p_subject: 'metricool', p_before: null, p_after: { set: Boolean(v), by: w.label } });
  return done(slug, v ? 'Connection link saved.' : 'Connection link removed.');
}
