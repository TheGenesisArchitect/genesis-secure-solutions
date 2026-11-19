// The scene plan: Helix reads the episode's source article and proposes purpose-built scenes (a CAD build, a lab
// result, a 3D assembly, a benchmark duel, a model card) that show what the article demonstrates, filled with the
// article's own numbers. Helix only proposes. Code checks every proposal against the article and the spoken words,
// a person approves, and only then does a scene become a `scene` line on the sources sheet (lib/unedit-news.ts),
// which places it where its words are said, like every other sourced graphic.
//
// What code checks (a proposal that fails is dropped with a note, never "fixed" by guessing):
//   - the type is on the closed list below, with the number of facts that type draws;
//   - the passage is copied word for word from the article;
//   - every number in the scene (title, labels, values) appears in that passage;
//   - the spoken words are in the script or transcript (if not, the scene is kept but flagged: it can't be placed).

import 'server-only';
import { adminDb } from '@/lib/supabase/admin';
import { ask, guard, record, settings, type Production } from '@/lib/newsroom';
import { checkAll } from '@/lib/agency-copy';
import { parseSheet, sheetText, type NewsEntry } from '@/lib/unedit-news';
import { SCENES, SCENE_TYPES, checkScene, fold, type ScenePlan, type SceneProposal } from '@/lib/unedit-scene-kit';
export * from '@/lib/unedit-scene-kit';

/** Helix's proposal, checked. `spoken` is the script (before recording) or the transcript (after). */
export async function draftScenes(input: { article: { url: string; title: string; text: string }; spoken: string; topic?: string }): Promise<{ scenes: SceneProposal[]; notes: string[]; cents: number }> {
  const article = input.article.text.slice(0, 60_000);
  if (article.length < 400) throw new Error('The article text is too short to plan from. Paste the full article.');
  const types = SCENE_TYPES.map((t) => `- ${t} (${SCENES[t].label}, ${SCENES[t].facts.min === SCENES[t].facts.max ? SCENES[t].facts.min : `${SCENES[t].facts.min}-${SCENES[t].facts.max}`} ${SCENES[t].facts.pair ? 'before → after facts' : 'facts'}): ${SCENES[t].use}`).join('\n');
  const system = [
    'You are the motion-graphics director for UnEdit Studio. Read the source article and propose the scenes that make viewers ask "how did they do that": each one shows, as a real-world application, something the article demonstrates, using the article\'s own numbers.',
    `Scene types (use only these):\n${types}`,
    'Rules:',
    '- Propose 2 to 5 scenes, the strongest first. Skip a type the article gives no real material for. Never two scenes from the same passage.',
    '- "passage": one or two sentences copied EXACTLY from the article text (same words, same numbers). Every number in the title and facts must appear in that passage. Never compute, round or convert a number. Numbers shown only in charts or images are not in the text: leave them out (a scene with no number is fine where the type allows it).',
    '- "facts": strings of the form "label: value" or "label: before → after", for example "Input, per million tokens: $8" or "Engineering score: 61% → 79%". Values are plain numbers with an optional $ before and %, M, K or x after.',
    '- Write units in words the way the article does ("per million tokens", never "per 1M"): every digit you write, in the title, labels and values, must appear in the passage.',
    '- "source": who reports the numbers, for the label on screen, e.g. "OpenAI-reported" for a company\'s own benchmark claims, or the outlet\'s name.',
    '- "say": 3 to 8 consecutive words copied exactly from the spoken text, at the moment the scene should appear (where the speaker talks about that topic). If the spoken text never mentions it, use "" (the scene can still be approved and placed by hand).',
    '- "why": the article section it shows, in a few words.',
    'Return only JSON: {"scenes":[{"type":"","title":"","facts":[""],"source":"","passage":"","say":"","why":""}]}',
  ].join('\n');
  const user = `Article: ${input.article.title}\n${input.article.url}\n\n${article}\n\n---\nSpoken text${input.topic ? ` (${input.topic})` : ''}:\n${input.spoken.slice(0, 30_000) || '(not written yet)'}`;
  const r = await ask(system, user, { maxTokens: 6000 });
  const m = r.text.match(/\{[\s\S]*\}/);
  let raw: Record<string, unknown>[] = [];
  try { raw = ((m ? JSON.parse(m[0]) : {}) as { scenes?: Record<string, unknown>[] }).scenes ?? []; } catch { throw new Error('Helix did not return a scene plan. Try again.'); }
  const scenes: SceneProposal[] = [], notes: string[] = [];
  for (const s of raw.slice(0, 8)) {
    const c = checkScene(s, article, input.spoken, input.article.url);
    if (typeof c === 'string') notes.push(`left out: ${c}`);
    else if (scenes.some((x) => fold(x.passage) === fold(c.passage))) notes.push(`left out: ${SCENES[c.type].label} "${c.title}" repeats another scene's passage`);
    else scenes.push(c);
  }
  for (const s of scenes) if (!s.placeable) notes.push(`${SCENES[s.type].label} "${s.title}": its spoken words aren't in the ${input.spoken ? 'script' : 'recording'} yet; edit "say" on the sheet after approving`);
  return { scenes: scenes.slice(0, 5), notes, cents: r.cents };
}

// ---- the article ------------------------------------------------------------------------------------------------
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', times: '×', rarr: '→' };
export function htmlText(html: string): { title: string; text: string } {
  const title = (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1] ?? html.match(/<title[^>]*>([^<]+)/i)?.[1] ?? '').trim();
  const body = (html.match(/<article[\s\S]*?<\/article>/i)?.[0] ?? html.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? html)
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|button)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|h[1-6]|li|tr|div|section|figcaption|blockquote)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  const dec = (s: string) => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&([a-z]+);/gi, (x, n) => ENT[n.toLowerCase()] ?? x);
  const text = dec(body).split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
  return { title: dec(title), text };
}
/** Read the article as the Genovus newsroom (an honest user agent). A site that refuses servers gets pasted text instead. */
export async function readArticle(url: string): Promise<{ title: string; text: string }> {
  if (!/^https?:\/\//.test(url)) throw new Error('That isn’t a web address.');
  const r = await fetch(url, { headers: { 'user-agent': 'GenovusNewsroom/1.0 (+https://genovus.io)', accept: 'text/html,application/xhtml+xml' }, signal: AbortSignal.timeout(15_000), redirect: 'follow' }).catch(() => null);
  if (!r || !r.ok) throw new Error(`${new URL(url).hostname} doesn’t let servers read the article${r ? ` (${r.status})` : ''}. Open it, copy the article text and paste it here.`);
  const html = (await r.text()).slice(0, 2_000_000);
  const a = htmlText(html);
  if (a.text.length < 400) throw new Error(`Couldn’t find the article text on ${new URL(url).hostname}. Paste it here.`);
  return a;
}

// ---- the plan on a newsroom production (before recording) and on a recording (after) ----------------------------
const EST = 15; // cents: one Sonnet call over a long article, no search

/** Draft (or redraft) the plan. The article: pasted text, else the link (the story's own link by default). */
async function draft(tenant: string, o: { url: string; text?: string; title?: string; spoken: string; topic?: string; by: string | null; story?: string | null }): Promise<ScenePlan> {
  await guard(tenant, EST);
  const pasted = (o.text ?? '').trim();
  const article = pasted.length >= 400 ? { title: o.title ?? '', text: pasted } : await readArticle(o.url);
  let r: Awaited<ReturnType<typeof draftScenes>>;
  try { r = await draftScenes({ article: { url: o.url, title: article.title || o.title || '', text: article.text }, spoken: o.spoken, topic: o.topic }); }
  catch (e) { await record(tenant, { kind: 'scenes', story_id: o.story ?? null, cost_cents: 0, error: e instanceof Error ? e.message : String(e), by: o.by }); throw e; }
  // Agency desks: scene titles and facts go through the same copy check as the script.
  const prof = (await settings(tenant)).profile;
  if (prof) {
    const keep: SceneProposal[] = [];
    for (const sc of r.scenes) {
      const issues = checkAll([{ where: 'scene', text: [sc.title, ...sc.facts].join('. ') }], prof);
      if (issues.length) r.notes.push(`left out: ${SCENES[sc.type].label} "${sc.title}" breaks a copy rule (${issues[0].why})`); else keep.push(sc);
    }
    r.scenes = keep;
  }
  await record(tenant, { kind: 'scenes', story_id: o.story ?? null, cost_cents: r.cents, stories: r.scenes.length, by: o.by });
  return { article: { url: o.url, title: article.title || o.title || '', chars: article.text.length }, scenes: r.scenes, notes: r.notes, cents: r.cents, drafted_at: new Date().toISOString(), by: o.by, approved: null };
}

/** The sheet with the chosen scenes in it: earlier scene lines are replaced, every other line is kept as it is. */
export function withScenes(sheet: NewsEntry[] | null | undefined, plan: ScenePlan, keep: number[]): { entries: NewsEntry[]; added: number } {
  const chosen = [...new Set(keep)].filter((i) => plan.scenes[i]).map((i) => plan.scenes[i]);
  if (!chosen.length) throw new Error('Pick at least one scene.');
  const unplaced = chosen.filter((s) => s.say.split(/\s+/).filter(Boolean).length < 2);
  if (unplaced.length) throw new Error(`Give "${unplaced[0].title}" the spoken words it should appear on first.`);
  const lines = chosen.map((s) => `scene | ${s.say} | ${s.type} | ${s.title} | ${s.facts.join(' ; ') || '-'} | ${s.source}${s.url && /^https?:/.test(s.url) ? ` | ${s.url}` : ''}`);
  const { entries, errors } = parseSheet([sheetText((sheet ?? []).filter((e) => e.kind !== 'scene')), ...lines].filter(Boolean).join('\n'));
  if (errors.length) throw new Error(`The sheet wouldn't take these scenes: ${errors.slice(0, 2).join('; ')}.`);
  return { entries, added: chosen.length };
}

const scriptText = (p: Production) => (p.script ?? []).flatMap((pt) => pt.lines.map((l) => l.say)).join('\n') || p.teleprompter || '';

export async function planProduction(tenant: string, productionId: string, o: { url?: string; text?: string }, by: string | null): Promise<ScenePlan> {
  const db = adminDb();
  const { data: p } = await db.from('newsroom_productions').select('id, story_id, outputs, vlog_id').eq('id', productionId).eq('tenant_id', tenant).single();
  if (!p) throw new Error('Production not found.');
  const { data: st } = await db.from('newsroom_stories').select('headline, url').eq('id', p.story_id).single();
  const outputs = p.outputs as Production & { scenePlan?: ScenePlan };
  const plan = await draft(tenant, { url: (o.url || st?.url || '').trim(), text: o.text, title: st?.headline, spoken: scriptText(outputs), topic: st?.headline, by, story: p.story_id });
  await db.from('newsroom_productions').update({ outputs: { ...outputs, scenePlan: plan } }).eq('id', p.id);
  return plan;
}

export async function approveProduction(tenant: string, productionId: string, keep: number[]): Promise<number> {
  const db = adminDb();
  const { data: p } = await db.from('newsroom_productions').select('id, outputs, vlog_id').eq('id', productionId).eq('tenant_id', tenant).single();
  if (!p) throw new Error('Production not found.');
  if (p.vlog_id) throw new Error('This package is already on a recording. Approve the scenes on its card.');
  const outputs = p.outputs as Production & { scenePlan?: ScenePlan; sheet?: string };
  if (!outputs.scenePlan) throw new Error('Draft the scene plan first.');
  const { entries, added } = withScenes(parseSheet(String(outputs.sheet ?? '')).entries, outputs.scenePlan, keep);
  await db.from('newsroom_productions').update({ outputs: { ...outputs, sheet: sheetText(entries), scenePlan: { ...outputs.scenePlan, approved: { keep, at: new Date().toISOString() } } } }).eq('id', p.id);
  return added;
}

/** On a recording: the spoken text is its transcript. */
export async function planRecording(tenant: string, v: { id: string; title: string | null; sources: NewsEntry[] | null }, transcript: string, o: { url?: string; text?: string }, by: string | null): Promise<ScenePlan> {
  // The article link: what was given, else the sheet's article entry, else the newsroom story it was produced from.
  let url = (o.url ?? '').trim() || (v.sources ?? []).find((e) => e.kind === 'article')?.url || '';
  let story: string | null = null;
  if (!url) {
    const { data: prod } = await adminDb().from('newsroom_productions').select('story_id').eq('vlog_id', v.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (prod?.story_id) { story = prod.story_id; const { data: st } = await adminDb().from('newsroom_stories').select('url').eq('id', prod.story_id).single(); url = st?.url ?? ''; }
  }
  if (!url && !(o.text ?? '').trim()) throw new Error('Which article? Paste its link or its text.');
  return draft(tenant, { url: url || 'pasted', text: o.text, title: v.title ?? undefined, spoken: transcript, topic: v.title ?? undefined, by, story });
}
