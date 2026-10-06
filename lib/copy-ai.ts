// Suggests new versions of a client's profile copy. Server-only (holds API keys).
// Claude is the platform's model; Gemini is a fallback when only a Gemini key is configured.
// Every suggestion is checked against the same hard rules as a manual edit; rule-breakers are dropped,
// and warnings still reach the approver. People approve the final wording; this only drafts.
import { COPY_RULES, cleanCopy, copyWarnings, type CopyKey } from './copy-rules';

export type SuggestContext = {
  key: CopyKey;
  current: string;
  instruction: string;
  agent: string;
  office: string;
  category: string;
  services: string;
  facts: [string, string][];
  otherCopy: Record<string, string>;
};

export type Suggestion = { text: string; warnings: string[] };

const CLAUDE_MODEL = () => (process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5').trim();
const GEMINI_MODEL = () => (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim();

export function aiProvider(): 'claude' | 'gemini' | null {
  if ((process.env.ANTHROPIC_API_KEY || '').trim()) return 'claude';
  if ((process.env.GEMINI_API_KEY || '').trim()) return 'gemini';
  return null;
}

function prompt(c: SuggestContext): { system: string; user: string } {
  const rule = COPY_RULES[c.key];
  const system = [
    'You write short social profile copy for local insurance agency offices.',
    'Rules you must follow:',
    `- Each version is at most ${rule.limit} characters, counting spaces${rule.multiline ? '; line breaks are allowed' : '; one line, no line breaks'}.`,
    rule.noLinks ? '- No links, web addresses or email addresses.' : '- No links unless the current text already has one.',
    '- No guarantees, no promises of savings, no prices, no percentages, no "best rates", "cheapest" or "lowest price".',
    '- No rankings or awards, and no facts that are not in the brief (years in business, reviews, licenses, carriers).',
    '- Plain, warm, local voice. No hashtags. Emoji only if the current text uses them.',
    '- Write in English unless the request asks for another language; a short Spanish line is fine if the office speaks Spanish.',
    'Return only JSON: {"options": ["...", "...", "..."]} with three distinct versions.',
  ].join('\n');
  const user = [
    `Field: ${rule.platform} (limit ${rule.limit} characters).`,
    `Business: ${c.office}. Agent: ${c.agent}. Category: ${c.category}.`,
    c.services ? `Services: ${c.services}.` : '',
    c.facts.length ? `Facts: ${c.facts.map(([k, v]) => `${k}: ${v}`).join('; ')}.` : '',
    Object.keys(c.otherCopy).length ? `Their other profile copy, for consistency: ${Object.entries(c.otherCopy).map(([k, v]) => `${k}: "${v}"`).join('; ')}.` : '',
    `Current text: "${c.current}"`,
    c.instruction ? `What the client wants changed: ${c.instruction}` : 'The client wants fresh alternatives in the same spirit.',
  ]
    .filter(Boolean)
    .join('\n');
  return { system, user };
}

function parseOptions(text: string): string[] {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return [];
  try {
    const j = JSON.parse(m[0]);
    return Array.isArray(j.options) ? j.options.filter((x: unknown): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

async function callClaude(p: { system: string; user: string }): Promise<string> {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': (process.env.ANTHROPIC_API_KEY || '').trim(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: CLAUDE_MODEL(), max_tokens: 1200, system: p.system, messages: [{ role: 'user', content: p.user }] }),
    signal: AbortSignal.timeout(25000),
  });
  const j = (await r.json()) as { content?: { type: string; text?: string }[]; error?: { message?: string } };
  if (!r.ok) throw new Error(j.error?.message || `Claude HTTP ${r.status}`);
  return (j.content || []).filter((b) => b.type === 'text').map((b) => b.text || '').join('');
}

async function callGemini(p: { system: string; user: string }): Promise<string> {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL())}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': (process.env.GEMINI_API_KEY || '').trim(), 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: p.system }] },
      contents: [{ role: 'user', parts: [{ text: p.user }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.9 },
    }),
    signal: AbortSignal.timeout(25000),
  });
  const j = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message?: string } };
  if (!r.ok) throw new Error(j.error?.message || `Gemini HTTP ${r.status}`);
  return (j.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('');
}

/** Up to three rule-abiding versions. Throws when no provider is configured or the provider fails. */
export async function suggestCopy(c: SuggestContext): Promise<Suggestion[]> {
  const provider = aiProvider();
  if (!provider) throw new Error('not-configured');
  const p = prompt(c);
  const raw = provider === 'claude' ? await callClaude(p) : await callGemini(p);
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const o of parseOptions(raw)) {
    const cleaned = cleanCopy(c.key, o);
    if (!('text' in cleaned) || !cleaned.text || seen.has(cleaned.text.toLowerCase()) || cleaned.text === c.current) continue;
    seen.add(cleaned.text.toLowerCase());
    out.push({ text: cleaned.text, warnings: copyWarnings(cleaned.text) });
    if (out.length === 3) break;
  }
  return out;
}
