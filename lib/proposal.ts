// The client's proposal: one private page per client (/proposal/<token>), signed so only the link opens it, built
// from the package on their record and the Genovus offer (data/offers.ts). Sending it is outward: a person's tap
// (the client page, or the "Send proposal and deposit" approval) opens the deposit invoice in Mercury when it's
// connected and emails the proposal link to the client's email on record. Server only.
import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { adminDb } from './supabase/admin';
import { PLANS } from '@/data/offers';

const SECRET = () => process.env.PROPOSAL_LINK_SECRET || process.env.MEDIA_LINK_SECRET || process.env.CRON_SECRET || '';
const sig = (id: string) => createHmac('sha256', SECRET()).update(`proposal:${id}`).digest('base64url').slice(0, 32);
export const DEPOSIT_SHARE = 0.7;

export function proposalToken(tenantId: string): string | null {
  return SECRET() ? `${tenantId}.${sig(tenantId)}` : null;
}
export function proposalTenant(token: string): string | null {
  const [id, s] = token.split('.');
  if (!SECRET() || !id || !s || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const want = Buffer.from(sig(id)), got = Buffer.from(s);
  return want.length === got.length && timingSafeEqual(want, got) ? id : null;
}

export type PackageId = 'launch' | 'growth' | 'premium';
export const packageOf = (v: unknown): PackageId => (v === 'growth' || v === 'premium' ? v : 'launch');
export const planFor = (pkg: PackageId) => PLANS.find((p) => p.id === pkg)!;
/** The deposit for a package: 70% of its setup (the 30% balance is due at launch). */
export const depositCents = (pkg: PackageId) => Math.round((planFor(pkg).setupCents ?? 0) * DEPOSIT_SHARE);

/** Draft the deposit invoice for the client's package if it has none yet (never a second one). */
export async function ensureDepositDraft(tenantId: string, pkg: PackageId): Promise<string> {
  const db = adminDb();
  const { data: have } = await db.from('invoices').select('id').eq('tenant_id', tenantId).eq('kind', 'deposit').neq('status', 'void').limit(1);
  if (have?.length) return have[0].id as string;
  const plan = planFor(pkg);
  const cents = depositCents(pkg);
  const { data, error } = await db.from('invoices').insert({
    tenant_id: tenantId, kind: 'deposit', amount_cents: cents, status: 'draft',
    note: `${plan.name} setup deposit (70% of $${((plan.setupCents ?? 0) / 100).toLocaleString('en-US')})`,
    lines: [{ label: `${plan.name} setup: 70% deposit`, cents }],
    due_date: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
  }).select('id').single();
  if (error) throw new Error(error.message);
  return data.id as string;
}
