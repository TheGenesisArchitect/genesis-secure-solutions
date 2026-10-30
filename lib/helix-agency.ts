// Ask Helix for an agency: answers from that agency's own live data (leads, pipeline, follow-ups, calendar,
// approvals, care, KPIs), proposes follow-ups the agent adds with one tap, and drafts messages the agent sends
// themselves. Helix never sends anything, never quotes, binds, underwrites or gives coverage advice, and only ever
// sees one agency's data. Reasoning: Claude when configured, else Gemini (also when Claude fails or times out).
// The same engine runs Enterprise Helix (lib/helix-enterprise.ts) with its own system prompt.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { businessToday } from '@/lib/billing';
import { calendarItems } from '@/lib/agency-calendar';
import { LINES, lineLabels, momentsNow, partnerCategories } from '@/lib/lines';
import { prettyPhone } from '@/lib/twilio';
import { visibility, visibilityLine } from '@/lib/visibility';

export type HelixTurn = { role: 'user' | 'helix'; text: string };
export type HelixReply = {
  answer: string;
  followUps: { who: string; reason: string; due: string; at: string }[];
  drafts: { to: string; channel: 'text' | 'email'; body: string }[];
  /** Durable business facts Helix suggests keeping ("Remember this?"); a person keeps them with one tap. */
  remember: { department: string; kind: string; text: string }[];
  /** Helix doesn't know or isn't set up for this: it becomes a Helix note for the team (lib/helix-gaps.ts). */
  unknown: boolean;
  gap: string;
  /** A page Helix was asked to open (an exact name from PAGES); the route turns it into a link. Never saved. */
  go?: string;
  /** Open one prospect's or client's page by name (Enterprise; resolved by the server, lib/helix-prospects.ts). */
  open?: { kind?: string; name?: string; code?: string; slug?: string };
  /** A change Helix proposes (confirm lane, lib/helix-act.ts); the route signs it for one tap. Never saved. */
  propose?: Record<string, string>;
  /** A lookup Helix wants before answering (lib/helix-lookups.ts); the route runs it and asks again. Never saved. */
  lookup?: { tool: string; args: Record<string, unknown> };
  /** "Make a note": saved by the route to Helix notes (lib/helix-note-save.ts). */
  note?: { kind: string; text: string };
  /** Fill a form on the person's page (and ask to save it): applied by the browser, never saved in the thread. */
  fill?: { form: string; fields: { name: string; value: string }[] };
  save?: boolean;
  /** Set by the server once the gap is filed as a Helix note. */
  noted?: boolean;
  model: string;
};

const add = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

/** Everything Helix may know about this agency right now, as compact text. Nothing from any other agency. */
export async function agencyBrief(db: SupabaseClient, tenantId: string, name: string, program: string): Promise<string> {
  const today = businessToday();
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [leads, fu, appr, care, cal, prof, calls, partners, costs] = await Promise.all([
    db.from('leads').select('name, phone, email, topic, source, campaign, status, note, booked_for, created_at, first_contact_at').eq('tenant_id', tenantId).gte('created_at', since).order('created_at', { ascending: false }).limit(60),
    db.from('follow_ups').select('who, reason, due_on, due_at').eq('tenant_id', tenantId).eq('status', 'open').lte('due_on', add(today, 14)).order('due_on').limit(80),
    db.from('approvals').select('title, requested_at').eq('tenant_id', tenantId).eq('status', 'pending').eq('approver', 'client').limit(20),
    db.from('care_requests').select('title, status').eq('tenant_id', tenantId).neq('status', 'done').limit(20),
    calendarItems(db, tenantId, today, add(today, 7)),
    db.from('agency_profiles').select('city, state, lines, service_radius_mi, carrier, licensed_states').eq('tenant_id', tenantId).maybeSingle(),
    db.from('calls').select('from_e164, started_at, duration_s, status, summary, number_id, tracking_numbers(label)').eq('tenant_id', tenantId).gte('started_at', since).order('started_at', { ascending: false }).limit(40),
    db.from('partner_targets').select('category, line, distance_mi, fit, status, contact_name, next_action_at, ref_code, known_name').eq('tenant_id', tenantId).order('fit', { ascending: false }).limit(400),
    db.from('source_costs').select('source, cents').eq('tenant_id', tenantId).eq('month', today.slice(0, 8) + '01'),
  ]);
  const L = leads.data ?? [];
  const by = (f: (l: (typeof L)[number]) => string) => Object.entries(L.reduce<Record<string, number>>((a, l) => ({ ...a, [f(l)]: (a[f(l)] ?? 0) + 1 }), {})).map(([k, v]) => `${k} ${v}`).join(', ');
  const replies = L.filter((l) => l.first_contact_at).map((l) => (new Date(l.first_contact_at!).getTime() - new Date(l.created_at).getTime()) / 60_000).sort((a, b) => a - b);
  const et = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
  const P = prof.data;
  const lines = lineLabels(P?.lines);
  const C = calls.data ?? [];
  const T = partners.data ?? [];
  const catLabel = (k: string) => partnerCategories(P?.lines).find((c) => c.key === k)?.label ?? k;
  const moments = momentsNow(P?.lines);
  const bySource = L.reduce<Record<string, { n: number; won: number }>>((a, l) => { const k = l.source; a[k] = a[k] ?? { n: 0, won: 0 }; a[k].n++; if (l.status === 'won') a[k].won++; return a; }, {});
  const cost = Object.fromEntries((costs.data ?? []).map((c) => [c.source, c.cents]));
  // Visibility: the same numbers the board shows, so Helix and the board agree. Never blocks the brief.
  const visLine = await visibility(db, tenantId, '').then(visibilityLine).catch(() => 'VISIBILITY: not available right now');
  // A new client's onboarding (their Welcome page): plan, kickoff and welcome form, so Helix can help fill it in.
  const { data: tslug } = await db.from('tenants').select('slug').eq('id', tenantId).maybeSingle();
  const welcome = tslug?.slug ? await import('./welcome').then((m) => m.welcomeBrief(tenantId, tslug.slug as string)).catch(() => []) : [];
  return [
    `AGENCY: ${name} · program ${program} · today ${new Date(`${today}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })} ${today} (America/New_York)${P ? ` · ${P.city ?? ''} ${P.state ?? ''} · carrier ${P.carrier ?? 'n/a'} · licensed ${(P.licensed_states ?? []).join(', ') || 'n/a'}` : ''}`,
    visLine,
    ...welcome,
    `LINES THIS AGENCY SELLS: ${lines.join(', ') || 'not set (ask the Genovus team to set them)'}`,
    `MARKET NOW: ${moments.map((m) => `${LINES[m.line].label}: ${m.label}${m.starting ? ' (starting next month)' : ''} (${m.why})`).join(' | ') || 'no seasonal moments for these lines this month'}`,
    `SOURCES this 30 days (leads / won / cost this month): ${Object.entries(bySource).map(([k, v]) => `${k} ${v.n}/${v.won}${cost[k] != null ? ` $${(cost[k] / 100).toFixed(0)} = $${(cost[k] / 100 / Math.max(1, v.n)).toFixed(0)}/lead` : ''}`).join(', ') || 'none'} · benchmark: vendors charge about $50 per shared lead`,
    `CALLS last 30 days (${C.length}; missed ${C.filter((c) => c.status === 'missed').length}):`,
    ...C.slice(0, 25).map((c) => `- ${et(c.started_at)} | ${prettyPhone(c.from_e164)} | ${c.status}${c.duration_s ? ` ${Math.round(c.duration_s / 60)} min` : ''} | line: ${(c.tracking_numbers as unknown as { label?: string } | null)?.label ?? 'tracking'}${c.summary ? ` | note: ${c.summary}` : ''}`),
    `PARTNERS (referral partners mapped near the office: ${T.length}; working: ${T.filter((t) => t.status !== 'new' && t.status !== 'opted_out' && t.status !== 'not_now').length}):`,
    ...T.filter((t) => t.status !== 'new').slice(0, 25).map((t) => `- ${t.known_name ? `${t.known_name}, ` : ''}${catLabel(t.category)} (${LINES[t.line as keyof typeof LINES]?.label ?? t.line}) ${t.distance_mi} mi | ${t.status}${t.contact_name ? ` | contact ${t.contact_name}` : ''}${t.next_action_at ? ` | next ${et(t.next_action_at)}` : ''}`),
    `Best unworked partners by fit: ${T.filter((t) => t.status === 'new').slice(0, 8).map((t) => `${catLabel(t.category)} ${t.distance_mi} mi (fit ${t.fit})`).join('; ') || 'none mapped yet'}`,
    `LEADS, last 30 days (${L.length}; by status: ${by((l) => l.status) || 'none'}; by source: ${by((l) => l.source) || 'none'}; median time to first call: ${replies.length ? `${Math.round(replies[Math.floor(replies.length / 2)])} min` : 'n/a'}):`,
    ...L.map((l) => `- ${l.name} | ${l.status}${l.booked_for ? ` consult ${et(l.booked_for)}` : ''} | ${l.topic ?? 'no topic'} | from ${l.source}${l.campaign ? `/${l.campaign}` : ''} | ${l.phone ?? ''} ${l.email ?? ''} | arrived ${et(l.created_at)}${l.note ? ` | note: ${l.note}` : ''}`),
    `FOLLOW-UPS open through ${add(today, 14)} (${(fu.data ?? []).length}):`,
    ...(fu.data ?? []).map((f) => `- ${f.due_on}${f.due_at ? ` ${String(f.due_at).slice(0, 5)}` : ''}${f.due_on < today ? ' OVERDUE' : ''} | ${f.who}${f.reason ? ` | ${f.reason}` : ''}`),
    `CALENDAR next 7 days: ${cal.length ? '' : 'nothing scheduled'}`,
    ...cal.map((c) => `- ${et(c.start)} | ${c.title}${c.detail ? ` | ${c.detail}` : ''}`),
    `APPROVALS waiting for the owner: ${(appr.data ?? []).map((a) => a.title).join('; ') || 'none'}`,
    `CARE REQUESTS open: ${(care.data ?? []).map((c) => `${c.title} (${c.status})`).join('; ') || 'none'}`,
  ].join('\n');
}

export const SYSTEM = (brief: string) => `You are Helix, the assistant inside Genovus for one insurance agency. You know this agency's business only from the BRIEF below, which is live data. Speak like a sharp, warm office manager: short, specific, names and times.

RULES (never break):
- Answer only from the BRIEF. Never invent leads, numbers, times or people.
- If the BRIEF doesn't have what's needed to answer, or it's something you aren't set up to do, don't guess: set "unknown": true and "gap" to one short line naming what is missing (the team turns it into a Helix note and makes it work). This is not for the hard lines below: those you decline as usual, with "unknown": false.
- Never quote prices, premiums or rates, never bind, underwrite or say whether something is covered, and never give coverage advice. For those, say a licensed agent at the agency should handle it.
- You never send anything. When asked to reach out, write a DRAFT the agent sends themselves.
- Proposed follow-ups are suggestions the agent adds with one tap; only propose them when asked or clearly useful.
- Keep the agency's customer data inside your answer; don't add anything about other agencies.
- Only talk about the LINES THIS AGENCY SELLS. If asked about any other kind of insurance, say the agency doesn't offer it and don't draft anything for it.
- Partners the agency has worked carry the business name it confirmed (in PARTNERS). Other names come from the screen (ON SCREEN) or a LOOKUP (recall for what the agency did and said before); never repeat a partner's phone, address or Google rating (they're on the card).

Reply with JSON only: {"answer": string (plain text, under 120 words), "unknown": boolean, "gap": string, "followUps": [{"who": string, "reason": string, "due": "YYYY-MM-DD", "at": "HH:MM"}], "drafts": [{"to": string, "channel": "text"|"email", "body": string (under 400 characters, friendly, no prices or coverage claims, signed as the agency)}]}.

BRIEF
${brief}`;

function parse(raw: string, model: string): HelixReply {
  const m = raw.match(/\{[\s\S]*\}/);
  let j: Partial<HelixReply> = {};
  try { j = (m ? JSON.parse(m[0]) : {}) as Partial<HelixReply>; } catch { j = { answer: raw.replace(/[{}"]/g, '').slice(0, 1200) }; }
  const s = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');
  return {
    answer: s(j.answer, 1200) || 'I couldn’t put an answer together. Try asking another way.',
    followUps: (Array.isArray(j.followUps) ? j.followUps : []).slice(0, 5).map((f) => ({ who: s(f.who, 120), reason: s(f.reason, 300), due: /^\d{4}-\d{2}-\d{2}$/.test(String(f.due)) ? String(f.due) : businessToday(), at: /^\d{2}:\d{2}$/.test(String(f.at)) ? String(f.at) : '09:30' })).filter((f) => f.who),
    drafts: (Array.isArray(j.drafts) ? j.drafts : []).slice(0, 3).map((d) => ({ to: s(d.to, 120), channel: d.channel === 'email' ? 'email' : 'text', body: s(d.body, 600) })).filter((d) => d.body) as HelixReply['drafts'],
    remember: (Array.isArray(j.remember) ? j.remember : []).slice(0, 3).map((r) => ({ department: s(r.department, 20), kind: s(r.kind, 20), text: s(r.text, 400) })).filter((r) => r.text.length >= 3),
    unknown: j.unknown === true,
    gap: s(j.gap, 200),
    go: s((j as { go?: unknown }).go, 60) || undefined,
    open: (() => { const o = (j as { open?: unknown }).open; return o && typeof o === 'object' && !Array.isArray(o) ? Object.fromEntries(Object.entries(o as Record<string, unknown>).filter(([k]) => ['kind', 'name', 'code', 'slug'].includes(k)).map(([k, v]) => [k, String(v ?? '').slice(0, 80)])) : undefined; })(),
    fill: (() => { const x = (j as { fill?: { form?: unknown; fields?: unknown } }).fill; if (!x || typeof x !== 'object' || typeof x.form !== 'string' || !Array.isArray(x.fields)) return undefined; return { form: s(x.form, 120), fields: (x.fields as { name?: unknown; value?: unknown }[]).slice(0, 20).filter((f) => f && typeof f.name === 'string').map((f) => ({ name: s(f.name, 60), value: String(f.value ?? '').slice(0, 1000) })) }; })(),
    save: (j as { save?: unknown }).save === true,
    note: (() => { const n = (j as { note?: { kind?: unknown; text?: unknown } }).note; return n && typeof n === 'object' && typeof n.text === 'string' && n.text.trim().length > 1 ? { kind: s(n.kind, 20), text: s(n.text, 600) } : undefined; })(),
    propose: (() => { const p = (j as { propose?: unknown }).propose; return p && typeof p === 'object' && !Array.isArray(p) ? Object.fromEntries(Object.entries(p as Record<string, unknown>).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k.slice(0, 20), String(v).slice(0, 300)]).slice(0, 8)) : undefined; })(),
    lookup: (() => { const l = (j as { lookup?: { tool?: unknown; args?: unknown } }).lookup; return l && typeof l === 'object' && typeof l.tool === 'string' ? { tool: s(l.tool, 30), args: l.args && typeof l.args === 'object' && !Array.isArray(l.args) ? Object.fromEntries(Object.entries(l.args as Record<string, unknown>).slice(0, 8).map(([k, v]) => [k.slice(0, 20), typeof v === 'number' ? v : String(v ?? '').slice(0, 120)])) : {} } : undefined; })(),
    model,
  };
}

/** `context`: what the agent is looking at (a page, a lead, a partner), so Helix answers about that first.
 *  `system`: the prompt builder (the agency one by default; Enterprise Helix passes its own). */
export async function askHelix(brief: string, history: HelixTurn[], question: string, context?: string, system: (brief: string) => string = SYSTEM): Promise<HelixReply> {
  const q = context ? `[Looking at: ${context.slice(0, 600)}]
${question}` : question;
  const turns = [...history.slice(-16), { role: 'user' as const, text: q.slice(0, 1600) }];
  const anthropic = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (anthropic) {
    const model = (process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5').trim();
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'x-api-key': anthropic, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, signal: AbortSignal.timeout(40_000),
        body: JSON.stringify({ model, max_tokens: 1100, system: system(brief), messages: turns.map((t) => ({ role: t.role === 'helix' ? 'assistant' : 'user', content: t.text })) }),
      });
      const j = (await r.json().catch(() => ({}))) as { content?: { type: string; text?: string }[]; error?: { message?: string } };
      if (r.ok) return parse((j.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join(''), model);
      console.error(`[helix] Claude failed: ${j.error?.message ?? r.status}`);
    } catch (e) {
      console.error(`[helix] Claude unreachable: ${e instanceof Error ? e.message : e}`);
    }
  }
  const gemini = (process.env.GEMINI_API_KEY || '').trim();
  if (!gemini) throw new Error('Helix isn’t connected here yet.');
  const model = (process.env.HELIX_AGENCY_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim();
  // GEMINI_API_BASE: a local stand-in for tests (never set in production).
  const base = (process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com').trim();
  const r = await fetch(`${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', headers: { 'x-goog-api-key': gemini, 'content-type': 'application/json' }, signal: AbortSignal.timeout(40_000),
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system(brief) }] }, contents: turns.map((t) => ({ role: t.role === 'helix' ? 'model' : 'user', parts: [{ text: t.text }] })), generationConfig: { responseMimeType: 'application/json', temperature: 0.3 } }),
  });
  const j = (await r.json().catch(() => ({}))) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message?: string } };
  if (!r.ok) throw new Error(j.error?.message || `Gemini HTTP ${r.status}`);
  return parse((j.candidates?.[0]?.content?.parts ?? []).map((x) => x.text ?? '').join(''), model);
}
