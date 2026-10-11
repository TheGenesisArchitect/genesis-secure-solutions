// Enterprise Helix ("Helix Knows"): the copilot that knows the Genovus business better over time. One compact brief,
// by department, built from live data with the viewer's own session (row-level security applies), plus everything
// the team has told Helix to remember. Finance is in the brief only for the people who see money (admin, account
// lead), the same rule as the Growth page. Same engine as agency Helix (askHelix), with its own system prompt.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { businessToday } from '@/lib/billing';
import { finance, monthsBack, receivables, runway } from '@/lib/finance';
import { prettyPhone } from '@/lib/twilio';
import { HOUSE_SLUG } from '@/lib/phone-line';

export const canSeeMoney = (role: string | undefined) => role === 'admin' || role === 'account_lead';
export const DEPARTMENTS: [string, string][] = [['sales', 'Sales'], ['pipeline', 'Pipeline'], ['clients', 'Clients & delivery'], ['finance', 'Finance'], ['studio', 'Studio'], ['operations', 'Operations'], ['general', 'General']];

const $ = (c: number | null | undefined) => (c == null ? 'n/a' : `$${Math.round(c / 100).toLocaleString('en-US')}`);
const pct = (x: number | null) => (x == null ? 'n/a' : `${Math.round(x * 100)}%`);
const days = (iso: string | null | undefined) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : null);
const et = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
const tally = (xs: string[]) => Object.entries(xs.reduce<Record<string, number>>((a, k) => ({ ...a, [k]: (a[k] ?? 0) + 1 }), {})).map(([k, n]) => `${k} ${n}`).join(', ');

export type EnterpriseBrief = { text: string; memoryIds: string[]; houseId: string | null };

export async function enterpriseBrief(db: SupabaseClient, opts: { money: boolean }): Promise<EnterpriseBrief> {
  const today = businessToday();
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const window = monthsBack(6);
  const nowIso = new Date().toISOString();
  const { data: house } = await db.from('tenants').select('id').eq('slug', HOUSE_SLUG).maybeSingle();
  const houseId = (house?.id as string | undefined) ?? null;

  const [counts, due, inq, camps, tenants, gates, appr, care, grants, leads, studioSpent, studioBudget, episodes, places, radar, memory, lineCalls, snapshots] = await Promise.all([
    db.rpc('prospect_counts'),
    db.from('prospects').select('id', { count: 'exact', head: true }).in('status', ['new', 'verified', 'contacting']).or(`next_action_at.is.null,next_action_at.lte.${nowIso}`),
    db.from('inquiries').select('kind, status, source, campaign_id, created_at').gte('created_at', since30),
    db.from('campaigns').select('id, name, channel, status, budget_cents'),
    db.from('tenants').select('id, slug, name, kind, stage, stage_since, plan, is_sample, care_active, care_rate_cents'),
    db.from('gates').select('tenant_id, kind, status').in('status', ['open', 'blocked']),
    db.from('approvals').select('tenant_id, title, approver, requested_at').eq('status', 'pending'),
    db.from('care_requests').select('tenant_id, title, kind, status, created_at').neq('status', 'done'),
    db.from('module_grants').select('tenant_id, module_key, until').is('revoked_at', null).not('until', 'is', null).lte('until', new Date(Date.now() + 7 * 86_400_000).toISOString()),
    db.from('leads').select('tenant_id, status, source, created_at, first_contact_at').gte('created_at', since30),
    db.rpc('studio_spent_cents'),
    db.from('studio_budget').select('monthly_cap_cents').maybeSingle(),
    db.from('studio_episodes').select('status'),
    db.rpc('places_month_cents'),
    db.from('partner_scans').select('tenant_id, cost_cents, started_at').gte('started_at', today.slice(0, 8) + '01'),
    houseId ? db.from('helix_memory').select('id, department, kind, text, created_at').eq('tenant_id', houseId).eq('status', 'kept').order('created_at', { ascending: false }).limit(40) : Promise.resolve({ data: [] }),
    houseId ? db.from('calls').select('from_e164, started_at, duration_s, status, summary').eq('tenant_id', houseId).gte('started_at', since30).order('started_at', { ascending: false }).limit(15) : Promise.resolve({ data: [] }),
    houseId && opts.money ? db.from('kpi_snapshots').select('period, metrics').eq('tenant_id', houseId).order('period', { ascending: false }).limit(2) : Promise.resolve({ data: [] }),
  ]);

  const T = (tenants.data ?? []) as { id: string; slug: string; name: string; kind: string; stage: string; stage_since: string | null; plan: string | null; is_sample: boolean; care_active: boolean; care_rate_cents: number | null }[];
  const real = T.filter((t) => t.kind === 'agency' && !t.is_sample);
  const realIds = new Set(real.map((t) => t.id));
  const name = (id: string) => T.find((t) => t.id === id)?.name ?? 'an agency';
  const C = ((counts.data ?? []) as { status: string; state: string; n: number }[]);
  const funnel = Object.entries(C.reduce<Record<string, number>>((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + Number(r.n) }), {})).map(([k, n]) => `${k} ${n}`).join(', ');
  const byState = Object.entries(C.filter((r) => ['replied', 'consult', 'proposal', 'won'].includes(r.status)).reduce<Record<string, number>>((a, r) => ({ ...a, [r.state]: (a[r.state] ?? 0) + Number(r.n) }), {})).map(([k, n]) => `${k} ${n}`).join(', ');
  const I = inq.data ?? [];
  const campName = (id: string | null) => (camps.data ?? []).find((c) => c.id === id)?.name ?? 'no campaign';
  const stuck = real.filter((t) => t.stage !== 'care' && (days(t.stage_since) ?? 0) > 14);
  const A = (appr.data ?? []).filter((a) => a.tenant_id && realIds.has(a.tenant_id));
  const K = (care.data ?? []).filter((c) => c.tenant_id && realIds.has(c.tenant_id));
  const G = (gates.data ?? []).filter((g) => realIds.has(g.tenant_id));
  const L = (leads.data ?? []).filter((l) => realIds.has(l.tenant_id));
  const health = real.map((t) => {
    const mine = L.filter((l) => l.tenant_id === t.id);
    const contacted = mine.filter((l) => l.first_contact_at);
    const mins = contacted.map((l) => (new Date(l.first_contact_at!).getTime() - new Date(l.created_at).getTime()) / 60_000).sort((a, b) => a - b);
    return `- ${t.name} (${t.plan ?? 'launch'}, ${t.stage}): ${mine.length} leads, contact rate ${mine.length ? pct(contacted.length / mine.length) : 'n/a'}, won ${mine.filter((l) => l.status === 'won').length}, median first call ${mins.length ? `${Math.round(mins[Math.floor(mins.length / 2)])} min` : 'n/a'}`;
  });
  const capCents = Number(studioBudget.data?.monthly_cap_cents ?? 15000);
  const M = (memory.data ?? []) as { id: string; department: string; kind: string; text: string }[];

  const lines: string[] = [
    `GENOVUS (Genesis Secure Solutions): websites, lead systems and the Helix assistant for insurance agencies · today ${today} (America/New_York)`,
    '',
    'SALES',
    `- Prospect funnel (all scanned offices): ${funnel || 'none yet'}. Engaged by state (replied/consult/proposal/won): ${byState || 'none'}.`,
    `- Calls due on the Call list now: ${due.count ?? 0}.`,
    `- Inquiries last 30 days: ${I.length} (by status: ${tally(I.map((i) => i.status)) || 'none'}; by campaign: ${tally(I.map((i) => campName(i.campaign_id))) || 'none'}; by source: ${tally(I.map((i) => i.source ?? 'direct')) || 'none'}).`,
    `- Campaigns: ${(camps.data ?? []).map((c) => `${c.name} (${c.channel}, ${c.status}${c.budget_cents ? `, budget ${$(c.budget_cents)}` : ''})`).join('; ') || 'none'}.`,
    `- Genovus line calls, last 30 days (${(lineCalls.data ?? []).length}):`,
    ...((lineCalls.data ?? []) as { from_e164: string | null; started_at: string; duration_s: number; status: string; summary: string | null }[]).map((c) => `  - ${et(c.started_at)} | ${prettyPhone(c.from_e164) || 'unknown'} | ${c.status}${c.duration_s ? ` ${Math.round(c.duration_s / 60)} min` : ''}${c.summary ? ` | note: ${c.summary}` : ''}`),
    '',
    'PIPELINE',
    `- Real clients by stage: ${tally(real.map((t) => t.stage)) || 'none'}.`,
    `- Stuck more than 14 days in a setup stage: ${stuck.map((t) => `${t.name} (${t.stage}, ${days(t.stage_since)} days)`).join('; ') || 'none'}.`,
    `- Open or blocked gates: ${G.map((g) => `${name(g.tenant_id)}: ${g.kind} ${g.status}`).join('; ') || 'none'}.`,
    '',
    'CLIENTS & DELIVERY',
    `- Live on care: ${real.filter((t) => t.care_active).length} of ${real.length} real clients.`,
    `- Approvals pending: ${A.length} (${A.filter((a) => a.approver === 'team').length} on the team, ${A.filter((a) => a.approver === 'client').length} on clients; oldest ${A.length ? `${Math.max(...A.map((a) => days(a.requested_at) ?? 0))} days` : 'n/a'}).`,
    `- Care requests open: ${K.length}${K.length ? ` (${K.map((k) => `${name(k.tenant_id!)}: ${k.title} [${k.status}, ${days(k.created_at)}d]`).slice(0, 10).join('; ')})` : ''}.`,
    `- Trials ending within 7 days: ${(grants.data ?? []).filter((g) => realIds.has(g.tenant_id)).map((g) => `${name(g.tenant_id)} ${g.module_key} on ${String(g.until).slice(0, 10)}`).join('; ') || 'none'}.`,
    '- Agency health, last 30 days:',
    ...(health.length ? health : ['- no real clients yet']),
    '',
    'STUDIO',
    `- Spend this month ${$(Number(studioSpent.data ?? 0))} of the ${$(capCents)} cap (the cap stays until one clean 45-60 s episode is proven). Episodes by status: ${tally((episodes.data ?? []).map((e) => e.status)) || 'none'}.`,
    '',
    'SPEND METERS (this month)',
    `- Google Places (scanner + radar): ${$(Number(places.data ?? 0))}. Agency partner radar runs: ${(radar.data ?? []).length} costing ${$((radar.data ?? []).reduce((a, r) => a + Number(r.cost_cents), 0))}.`,
  ];

  if (opts.money) {
    const { f, owed, cashRow, run } = await moneyFacts(db, T, window);
    const snap = (snapshots.data ?? []) as { period: string; metrics: Record<string, number> }[];
    lines.push(
      '',
      'FINANCE (last 6 months; real clients only)',
      `- Revenue ${$(f.revenue)} (setup ${$(f.setup)}, care ${$(f.care)}). MRR ${$(f.mrr)}, ARR ${$(f.arr)}, ${f.liveClients} on care.`,
      `- Spend ${$(f.acquisition + f.operating)}: acquisition ${$(f.acquisition)}, operating ${$(f.operating)} (of which AI & production ${$(f.ai)}). Profit ${$(f.profit)}. Gross margin ${pct(f.grossMargin)}.`,
      `- New clients ${f.newClients}; CAC ${$(f.cac)}; payback ${f.payback == null ? 'n/a' : f.payback === 0 ? 'at setup' : `${f.payback.toFixed(1)} months`}; average setup ${$(f.avgSetup)}, average care ${$(f.avgCare)}/mo; cost per inquiry ${$(f.costPerInquiry)}.`,
      `- Owed to us: ${$(owed.cents)} across ${owed.count} open invoices${owed.oldestDays != null ? `, oldest ${owed.oldestDays} days` : ''}.`,
      `- Runway: ${!cashRow ? 'cash on hand not set (an admin sets it on the Growth page)' : run.months == null ? `not burning (cash ${$(Number(cashRow.cents))})` : `${run.months.toFixed(1)} months (cash ${$(Number(cashRow.cents))}, net burn ${$(run.burn)}/mo)`}.`,
      `- By month (setup/care/acquisition/operating): ${f.series.map((s) => `${s.month} ${$(s.setup)}/${$(s.care)}/${$(s.acquisition)}/${$(s.operating)}`).join('; ')}.`,
      ...(snap.length ? [`- Monthly KPI snapshots: ${snap.map((s) => `${s.period}: ${Object.entries(s.metrics ?? {}).slice(0, 8).map(([k, v]) => `${k} ${v}`).join(', ')}`).join(' | ')}`] : []),
    );
  } else {
    lines.push('', 'FINANCE: not available to this viewer (only an admin or account lead sees money).');
  }

  lines.push('', `WHAT HELIX KNOWS (kept by the team; ${M.length}):`, ...(M.length ? M.map((m) => `- [${m.department}/${m.kind}] ${m.text}`) : ['- nothing kept yet']));
  return { text: lines.join('\n'), memoryIds: M.map((m) => m.id), houseId };
}

/** The money picture (admin and account lead only: expenses are readable only by them). */
export async function moneyFacts(db: SupabaseClient, tenants?: Parameters<typeof finance>[0]['tenants'], window = monthsBack(6)) {
  const [T, inv, exp, scans, open, cash, inq] = await Promise.all([
    tenants ? Promise.resolve(tenants) : db.from('tenants').select('id, kind, is_sample, care_active, care_rate_cents').then((r) => r.data ?? []),
    db.from('invoices').select('tenant_id, kind, amount_cents, status, paid_at').eq('status', 'paid'),
    db.from('expenses').select('spent_on, category, amount_cents').gte('spent_on', window[0] + '-01'),
    db.from('places_usage').select('day, cost_cents').gte('day', window[0] + '-01'),
    db.from('invoices').select('tenant_id, amount_cents, created_at').eq('status', 'open'),
    db.rpc('cash_on_hand'),
    db.from('inquiries').select('created_at').gte('created_at', window[0] + '-01'),
  ]);
  const f = finance({ invoices: inv.data ?? [], tenants: T, expenses: exp.data ?? [], scans: (scans.data ?? []).map((u) => ({ started_at: u.day, est_cost_cents: Math.round(Number(u.cost_cents)) })), inquiries: inq.data ?? [], window });
  const owed = receivables(open.data ?? [], T);
  const cashRow = ((cash.data ?? []) as { cents: number }[])[0] ?? null;
  return { f, owed, cashRow, run: runway(cashRow ? Number(cashRow.cents) : null, f.series) };
}

/** The CFO line on the Enterprise overview (money roles only): MRR, this month's collections, margin, owed, runway. */
export async function cfoLine(db: SupabaseClient): Promise<string> {
  const { f, owed, cashRow, run } = await moneyFacts(db);
  const m = f.series[f.series.length - 1];
  return `MRR ${$(f.mrr)} · collected this month ${$((m?.setup ?? 0) + (m?.care ?? 0))} · 6-month margin ${pct(f.grossMargin)} · owed ${$(owed.cents)}${cashRow ? ` · runway ${run.months == null ? 'not burning' : `${run.months.toFixed(1)} mo`}` : ''}`;
}

export const ENTERPRISE_SYSTEM = (brief: string) => `You are Helix, the copilot inside Genovus for the Genovus team. Helix Knows: you know this business from the BRIEF below (live data, by department) and from WHAT HELIX KNOWS, the things the team asked you to remember. Think like a sharp operator and a CFO at once: short, specific, numbers first, then the lever to pull and its likely effect.

RULES (never break):
- Answer only from the BRIEF. If a number or fact isn't there, say "that isn't in my data" and what would add it. Never invent clients, numbers, dates or people.
- If FINANCE says it is not available to this viewer, don't estimate or reveal money; say an admin or account lead can see it.
- You never send, post, publish, buy or change anything. When asked to reach out, write a DRAFT a person sends.
- Never quote insurance prices, bind or give coverage advice. Genovus never does.
- Name agencies when useful, but keep each agency's leads and customers private: talk in counts and rates, not their customers' names or numbers.
- Offer "remember" only for durable business facts, patterns or preferences the team would want you to know next time (e.g. "Florida captive agents answer best before 10 a.m."). Never personal data, contact details, secrets or one-off numbers. Usually zero; at most two.

Reply with JSON only: {"answer": string (plain text, under 140 words), "followUps": [], "drafts": [{"to": string, "channel": "text"|"email", "body": string (under 600 characters)}], "remember": [{"department": "sales"|"pipeline"|"clients"|"finance"|"studio"|"operations"|"general", "kind": "fact"|"preference"|"outcome"|"goal", "text": string (under 200 characters)}]}.

BRIEF
${brief}`;
