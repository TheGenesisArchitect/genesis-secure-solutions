// The client's welcome page (app/app/[slug]/welcome), from what's already on the platform: their package and its
// terms (data/offers.ts, the proposal's 70/30), the deposit invoice and its due date, the kickoff on the calendar
// (migration 0092 kickoff_event), the setup checklist grouped by section (lib/checklist.ts), the site preview, and
// the carrier promo library already in their Library. Also the open team times a kickoff can move to. Server only.
import 'server-only';
import { adminDb } from './supabase/admin';
import { checklistStatus, CHECKLIST } from './checklist';
import { packageOf, planFor, depositCents } from './proposal';
import { previewKey } from './site';
import { openTimes } from './helix-lookups';

export type Kickoff = { id: string; title: string; starts: string; ends: string; location: string | null; confirmed: boolean; onHouse: boolean };

export async function kickoffFor(tenantId: string): Promise<Kickoff | null> {
  const db = adminDb();
  const { data: ev } = await db.rpc('kickoff_event', { p_tenant: tenantId });
  const e = (Array.isArray(ev) ? ev[0] : ev) as Record<string, unknown> | null;
  if (!e?.id) return null;
  const { data: t } = await db.from('tenants').select('id').eq('slug', 'genovus').maybeSingle();
  return { id: e.id as string, title: e.title as string, starts: e.starts_at as string, ends: e.ends_at as string, location: (e.location as string) ?? null, confirmed: Boolean(e.confirmed_at), onHouse: e.tenant_id === t?.id };
}

/** Open Genovus team times for the kickoff's length over the next week (the house calendar's free half hours). */
export async function kickoffSlots(k: Kickoff): Promise<{ iso: string; label: string }[]> {
  const db = adminDb();
  const { data: house } = await db.from('tenants').select('id').eq('slug', 'genovus').maybeSingle();
  if (!house) return [];
  const minutes = Math.max(15, Math.round((Date.parse(k.ends) - Date.parse(k.starts)) / 60_000));
  const { easternIso } = await import('./agency-calendar');
  const open = await openTimes(db, house.id as string, { minutes, days: 6, perDay: 6, max: 30 });
  return open.slots.map((s: { day: string; time: string; label: string }) => ({ iso: new Date(easternIso(s.day, s.time)).toISOString(), label: s.label }))
    .filter((s) => Date.parse(s.iso) >= Date.now() + 2 * 3_600_000 && s.iso !== new Date(k.starts).toISOString());
}

export const etWhen = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });

export async function welcomeData(tenantId: string, slug: string) {
  const db = adminDb();
  const [{ data: t }, { data: rec }, { data: dep }, { count: library }, kickoff] = await Promise.all([
    db.from('tenants').select('name, stage, site_live').eq('id', tenantId).single(),
    db.from('agent_records').select('data').eq('tenant_id', tenantId).eq('is_current', true).maybeSingle(),
    db.from('invoices').select('status, amount_cents, due_date').eq('tenant_id', tenantId).eq('kind', 'deposit').neq('status', 'void').order('created_at').limit(1).maybeSingle(),
    // Only the carrier starter promos copied in (lib/welcome-actions.ts), never their own photos.
    db.from('assets').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('kind', 'image').neq('audience', 'internal').ilike('notes', 'Carrier starter promo%'),
    kickoffFor(tenantId),
  ]);
  const record = (rec?.data ?? {}) as Record<string, unknown>;
  const pkg = packageOf(record.package);
  const plan = planFor(pkg);
  const status = checklistStatus(record);
  const filled = status.items.filter((i) => i.done).length;
  const key = previewKey(slug);
  return {
    name: (t?.name as string) ?? slug,
    stage: (t?.stage as string) ?? 'intake',
    live: Boolean(t?.site_live),
    record,
    first: String(record.contactName ?? '').split(/\s+/)[0] || '',
    plan,
    deposit: { cents: dep?.amount_cents ?? depositCents(pkg), due: (dep?.due_date as string) ?? null, paid: dep?.status === 'paid' },
    balanceCents: (plan.setupCents ?? 0) - (dep?.amount_cents ?? depositCents(pkg)),
    status,
    progress: { filled, total: CHECKLIST.length },
    kickoff,
    previewUrl: key ? `/s/${slug}?k=${key}` : null,
    library: library ?? 0,
  };
}

/** What Helix knows about a new client's onboarding (empty once they're live): their plan and terms, the deposit,
 *  the kickoff, and every welcome-form item with its answer or "missing", so Helix can help fill it in. */
export async function welcomeBrief(tenantId: string, slug: string): Promise<string[]> {
  const { data: st } = await adminDb().from('tenants').select('stage').eq('id', tenantId).maybeSingle();
  if (!st || st.stage === 'care') return [];
  const w = await welcomeData(tenantId, slug).catch(() => null);
  if (!w || w.stage === 'care') return [];
  const usd = (c: number) => `$${(c / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  return [
    `WELCOME (this agency is onboarding; their Welcome page is /app/${slug}/welcome): plan ${w.plan.name}: setup ${usd(w.plan.setupCents ?? 0)}; deposit ${usd(w.deposit.cents)} (70%)${w.deposit.paid ? ' paid' : w.deposit.due ? ` due ${w.deposit.due}` : ''}; ${usd(w.balanceCents)} at launch; then ${w.plan.careName ?? 'care'} ${usd(w.plan.careCents ?? 0)}/mo. Includes: ${w.plan.includes.join('; ')}. Support: Helix any time, or reply to any Genovus email for a person. Nothing goes public until the client and their carrier approve it. Never promise dates, results or prices beyond these.`,
    `KICKOFF: ${w.kickoff ? `${etWhen(w.kickoff.starts)} Eastern, ${w.kickoff.confirmed ? 'confirmed' : 'not confirmed yet (they can confirm or pick another time on the Welcome page)'}` : 'not on the calendar yet'}. The kickoff answers questions, closes what's left on the welcome form, covers creative (photos, tone, which line pages) and the carrier-approved promo library, and walks them through the dashboard and sign-in.`,
    `WELCOME FORM (${w.progress.filled} of ${w.progress.total} answered; needed to build: ${w.status.missing.map((m) => m.label).join(', ') || 'all in'}). Help them fill it: suggest wording from what's on file, never invent facts about their business (license, hours, carrier details); ask them. Each section is its own form with a Save button:`,
    ...w.status.items.map((i) => `- [${i.section}] ${i.label}${i.required ? ' (needed)' : ''}: ${i.done ? (i.kind === 'photo' ? 'uploaded' : String(w.status.intake[i.key]).slice(0, 120)) : 'missing'} (${i.help})`),
    `ON FILE FROM THE CONSULT: ${['agencyName', 'contactName', 'address', 'phone', 'email', 'carrier', 'website'].map((k) => (w.record[k] ? `${k} ${String(w.record[k])}` : '')).filter(Boolean).join(' · ')}. PROMO LIBRARY: ${w.library} carrier starter promo(s) copied into their Library (from another agency with the same carrier; theirs to keep, change or drop).`,
  ];
}
