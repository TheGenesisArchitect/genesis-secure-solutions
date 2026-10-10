// Ask Helix for an agency: answers from that agency's own live data (leads, pipeline, follow-ups, calendar,
// approvals, care, KPIs), proposes follow-ups the agent adds with one tap, and drafts messages the agent sends
// themselves. Helix never sends anything, never quotes, binds, underwrites or gives coverage advice, and only ever
// sees one agency's data. Reasoning: Claude when configured, else Gemini.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { businessToday } from '@/lib/billing';
import { calendarItems } from '@/lib/agency-calendar';

export type HelixTurn = { role: 'user' | 'helix'; text: string };
export type HelixReply = {
  answer: string;
  followUps: { who: string; reason: string; due: string; at: string }[];
  drafts: { to: string; channel: 'text' | 'email'; body: string }[];
  model: string;
};

const add = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

/** Everything Helix may know about this agency right now, as compact text. Nothing from any other agency. */
export async function agencyBrief(db: SupabaseClient, tenantId: string, name: string, program: string): Promise<string> {
  const today = businessToday();
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [leads, fu, appr, care, cal] = await Promise.all([
    db.from('leads').select('name, phone, email, topic, source, campaign, status, note, booked_for, created_at, first_contact_at').eq('tenant_id', tenantId).gte('created_at', since).order('created_at', { ascending: false }).limit(60),
    db.from('follow_ups').select('who, reason, due_on, due_at').eq('tenant_id', tenantId).eq('status', 'open').lte('due_on', add(today, 14)).order('due_on').limit(80),
    db.from('approvals').select('title, requested_at').eq('tenant_id', tenantId).eq('status', 'pending').eq('approver', 'client').limit(20),
    db.from('care_requests').select('title, status').eq('tenant_id', tenantId).neq('status', 'done').limit(20),
    calendarItems(db, tenantId, today, add(today, 7)),
  ]);
  const L = leads.data ?? [];
  const by = (f: (l: (typeof L)[number]) => string) => Object.entries(L.reduce<Record<string, number>>((a, l) => ({ ...a, [f(l)]: (a[f(l)] ?? 0) + 1 }), {})).map(([k, v]) => `${k} ${v}`).join(', ');
  const replies = L.filter((l) => l.first_contact_at).map((l) => (new Date(l.first_contact_at!).getTime() - new Date(l.created_at).getTime()) / 60_000).sort((a, b) => a - b);
  const et = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
  return [
    `AGENCY: ${name} · program ${program} · today ${today} (America/New_York)`,
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

const SYSTEM = (brief: string) => `You are Helix, the assistant inside Genovus for one insurance agency. You know this agency's business only from the BRIEF below, which is live data. Speak like a sharp, warm office manager: short, specific, names and times.

RULES (never break):
- Answer only from the BRIEF. If something isn't there, say you don't have it and what would add it. Never invent leads, numbers, times or people.
- Never quote prices, premiums or rates, never bind, underwrite or say whether something is covered, and never give coverage advice. For those, say a licensed agent at the agency should handle it.
- You never send anything. When asked to reach out, write a DRAFT the agent sends themselves.
- Proposed follow-ups are suggestions the agent adds with one tap; only propose them when asked or clearly useful.
- Keep the agency's customer data inside your answer; don't add anything about other agencies.

Reply with JSON only: {"answer": string (plain text, under 120 words), "followUps": [{"who": string, "reason": string, "due": "YYYY-MM-DD", "at": "HH:MM"}], "drafts": [{"to": string, "channel": "text"|"email", "body": string (under 400 characters, friendly, no prices or coverage claims, signed as the agency)}]}.

BRIEF
${brief}`;

function parse(raw: string, model: string): HelixReply {
  const m = raw.match(/\{[\s\S]*\}/);
  const j = (m ? JSON.parse(m[0]) : {}) as Partial<HelixReply>;
  const s = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');
  return {
    answer: s(j.answer, 1200) || 'I couldn’t put an answer together. Try asking another way.',
    followUps: (Array.isArray(j.followUps) ? j.followUps : []).slice(0, 5).map((f) => ({ who: s(f.who, 120), reason: s(f.reason, 300), due: /^\d{4}-\d{2}-\d{2}$/.test(String(f.due)) ? String(f.due) : businessToday(), at: /^\d{2}:\d{2}$/.test(String(f.at)) ? String(f.at) : '09:30' })).filter((f) => f.who),
    drafts: (Array.isArray(j.drafts) ? j.drafts : []).slice(0, 3).map((d) => ({ to: s(d.to, 120), channel: d.channel === 'email' ? 'email' : 'text', body: s(d.body, 600) })).filter((d) => d.body) as HelixReply['drafts'],
    model,
  };
}

export async function askHelix(brief: string, history: HelixTurn[], question: string): Promise<HelixReply> {
  const turns = [...history.slice(-8), { role: 'user' as const, text: question.slice(0, 1000) }];
  const anthropic = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (anthropic) {
    const model = (process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5').trim();
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': anthropic, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, signal: AbortSignal.timeout(40_000),
      body: JSON.stringify({ model, max_tokens: 900, system: SYSTEM(brief), messages: turns.map((t) => ({ role: t.role === 'helix' ? 'assistant' : 'user', content: t.text })) }),
    });
    const j = (await r.json().catch(() => ({}))) as { content?: { type: string; text?: string }[]; error?: { message?: string } };
    if (r.ok) return parse((j.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join(''), model);
    console.error(`[helix-agency] Claude failed: ${j.error?.message ?? r.status}`);
  }
  const gemini = (process.env.GEMINI_API_KEY || '').trim();
  if (!gemini) throw new Error('Helix isn’t connected here yet.');
  const model = (process.env.HELIX_AGENCY_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim();
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', headers: { 'x-goog-api-key': gemini, 'content-type': 'application/json' }, signal: AbortSignal.timeout(40_000),
    body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM(brief) }] }, contents: turns.map((t) => ({ role: t.role === 'helix' ? 'model' : 'user', parts: [{ text: t.text }] })), generationConfig: { responseMimeType: 'application/json', temperature: 0.3 } }),
  });
  const j = (await r.json().catch(() => ({}))) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message?: string } };
  if (!r.ok) throw new Error(j.error?.message || `Gemini HTTP ${r.status}`);
  return parse((j.candidates?.[0]?.content?.parts ?? []).map((x) => x.text ?? '').join(''), model);
}
