import 'server-only';
// The minute's lead checks (docs/LEAD_ENGINE_SPEC.md §4.3): for each new or changed lead, run the checks it hasn't had
// yet, score it (lib/lead-score.ts) and save both (migration 0095). Each check runs once per lead.
//  * phone: a well-formed US number (free)
//  * line_type: Twilio Lookup, only with LEAD_LOOKUP_ON=1 ($0.008 each, at most LOOKUPS_PER_RUN a run)
//  * email: the domain takes mail (MX, or an address record when there is no MX), over DNS (free)
// A failed check never deletes or hides a lead; it only changes the score.
import { promises as dns } from 'node:dns';
import { adminDb } from './supabase/admin';
import { lookupLineType, twilioConfigured } from './twilio';
import { scoreLead, type Checks } from './lead-score';

const LOOKUPS_PER_RUN = 20;
const lookupOn = () => process.env.LEAD_LOOKUP_ON === '1' && twilioConfigured();

/** The same rule as norm_phone in migration 0094: +1 and ten digits, area code 2–9. */
export function e164Of(phone: string | null | undefined): string | null {
  const d = (phone ?? '').replace(/\D/g, '');
  return /^1[2-9]\d{9}$/.test(d) ? `+${d}` : /^[2-9]\d{9}$/.test(d) ? `+1${d}` : null;
}

const withTimeout = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);

/** Does this email's domain take mail? null when DNS couldn't say (checked again on the next change). */
async function domainTakesMail(domain: string): Promise<{ ok: boolean | null; why: string }> {
  try {
    const mx = await withTimeout(dns.resolveMx(domain), 4000);
    const real = mx.filter((m) => m.exchange && m.exchange !== '.');
    return real.length ? { ok: true, why: 'mx' } : { ok: false, why: 'null mx' };
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'ENOTFOUND') return { ok: false, why: 'no such domain' };
    if (code === 'ENODATA') {
      try { return (await withTimeout(dns.resolve4(domain), 4000)).length ? { ok: true, why: 'address record' } : { ok: false, why: 'no mail records' }; }
      catch { return { ok: false, why: 'no mail records' }; }
    }
    return { ok: null, why: code ?? 'dns error' };
  }
}

type Row = { id: string; tenant_id: string; phone: string | null; email: string | null; topic: string | null; message: string | null; asks: number | null;
  requested_for: string | null; booked_for: string | null; x_date?: string | null; updated_at: string };
type CheckRow = { lead_id: string; kind: string; ok: boolean | null; result: Record<string, unknown> };

export async function runLeadChecks(limit = 50): Promise<{ scored: number; lookups: number }> {
  const db = adminDb();
  const { data, error } = await db.rpc('leads_to_score', { p_limit: limit });
  if (error) throw new Error(`leads_to_score: ${error.message}`);
  const leads = (data ?? []) as Row[];
  if (!leads.length) return { scored: 0, lookups: 0 };
  const tenants = [...new Set(leads.map((l) => l.tenant_id))];
  const [{ data: profiles }, { data: had }] = await Promise.all([
    db.from('agency_profiles').select('tenant_id, lines, licensed_states').in('tenant_id', tenants),
    db.from('lead_checks').select('lead_id, kind, ok, result').in('lead_id', leads.map((l) => l.id)),
  ]);
  const profileOf = new Map((profiles ?? []).map((p) => [p.tenant_id as string, p]));
  const checksOf = new Map<string, CheckRow[]>();
  for (const c of (had ?? []) as CheckRow[]) checksOf.set(c.lead_id, [...(checksOf.get(c.lead_id) ?? []), c]);
  const mail = new Map<string, Promise<{ ok: boolean | null; why: string }>>();
  let lookups = 0, scored = 0;
  for (const l of leads) {
    const have = new Map((checksOf.get(l.id) ?? []).map((c) => [c.kind, c]));
    const fresh: { kind: string; ok: boolean | null; result: Record<string, unknown> }[] = [];
    const e164 = e164Of(l.phone);
    if (l.phone && !have.has('phone')) fresh.push({ kind: 'phone', ok: !!e164, result: { e164 } });
    if (e164 && lookupOn() && !have.has('line_type') && lookups < LOOKUPS_PER_RUN) {
      lookups++;
      const r = await lookupLineType(e164);
      if (r.ok !== null) fresh.push({ kind: 'line_type', ok: r.ok, result: { type: r.type ?? null } });
    }
    const domain = l.email?.split('@')[1]?.toLowerCase();
    if (domain && !have.has('email')) {
      if (!mail.has(domain)) mail.set(domain, domainTakesMail(domain));
      const r = await mail.get(domain)!;
      if (r.ok !== null) fresh.push({ kind: 'email', ok: r.ok, result: { domain, why: r.why } });
    }
    for (const f of fresh) have.set(f.kind, { lead_id: l.id, ...f });
    const lt = have.get('line_type');
    const checks: Checks = {
      phone: have.get('phone')?.ok ?? null,
      line_type: lt ? { ok: lt.ok, type: (lt.result?.type as string | undefined) ?? undefined } : null,
      email: have.get('email')?.ok ?? null,
    };
    const s = scoreLead({ topic: l.topic, message: l.message, phone_e164: e164, asks: l.asks ?? 1, requested_for: l.requested_for, booked_for: l.booked_for, x_date: l.x_date ?? null },
      (profileOf.get(l.tenant_id) as { lines: string[] | null; licensed_states: string[] | null } | undefined) ?? null, checks);
    const { error: e } = await db.rpc('save_lead_score', { p_lead: l.id, p_checks: fresh, p_score: s.score, p_reasons: s.reasons, p_out_of_line: s.outOfLine, p_verified: s.verified, p_seen: l.updated_at });
    if (e) console.error(`[leads] score ${l.id}: ${e.message}`);
    else scored++;
  }
  return { scored, lookups };
}
