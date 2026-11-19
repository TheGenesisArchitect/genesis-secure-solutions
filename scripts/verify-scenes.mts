// Verify the scene plan (lib/unedit-scenes.ts) without spend: the real draft code path against a stand-in Claude
// reply (three proposals that should pass, four that must not), then the sheet round trip and placement.
//   npx tsx --conditions=react-server --env-file=.env.local scripts/verify-scenes.mts <article.txt>
// The article file is the source article's text (for GPT-6.2 Astra: the openai.com page, read in a browser).
import fs from 'node:fs';
import http from 'node:http';

const articleText = fs.readFileSync(process.argv[2], 'utf8');
let fails = 0;
const ok = (cond: unknown, what: string, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${what}${extra ? `  (${extra})` : ''}`); if (!cond) fails++; };

// What the speaker says (before recording: the script).
const script = [
  'OpenAI just dropped GPT 6.2 Astra and Sol.',
  'Astra is priced at eight dollars per million input tokens.',
  'It can work down to individual parts in CAD and simulation tools.',
  'It can model a mechanical system part by part and show how it goes together.',
  'And they turned a Chicago landmark into a paper lamp.',
].join('\n');

// The stand-in reply: what Claude might propose, including the mistakes the checks exist for.
const reply = { scenes: [
  { type: 'assembly', title: 'A mechanical system, part by part', facts: [], source: 'OpenAI',
    passage: 'GPT-6.2 Astra can model a mechanical system part by part, giving engineers a way to show how it goes together and test how design changes affect its behavior.',
    say: 'model a mechanical system part by part', why: 'Mechanical design and assembly' },
  { type: 'cad', title: 'Down to individual parts in CAD', facts: [], source: 'OpenAI',
    passage: 'GPT‑6.2 Astra’s more precise computer use lets it work down to individual parts and connections in CAD and simulation tools.',
    say: 'down to individual parts in CAD', why: 'Computer use in CAD and simulation tools' },
  { type: 'model', title: 'GPT-6.2 Astra — the professional flagship', facts: ['Input, per million tokens: $8', 'Cached input, per million tokens: $0.40', 'Output, per million tokens: $40'], source: 'OpenAI',
    passage: 'In the API, GPT‑6.2 Astra’s input and output token prices are 20% lower than GPT‑6 Astra’s, with a 60% discount on cached input ($8 for input, $0.40 for cached input, and $40 for output, all per million tokens).',
    say: 'priced at eight dollars per million', why: 'API pricing' },
  // Chart numbers: not in the article's text.
  { type: 'bench', title: 'GPT-6.2 Astra vs GPT-6 Astra', facts: ['BenchCAD 2.1 Core: 62.6% → 82.5%', 'AutomationBench: 41.4% → 52.4%'], source: 'OpenAI-reported',
    passage: 'GPT‑6.2 Astra’s more precise computer use lets it work down to individual parts and connections in CAD and simulation tools.', say: 'OpenAI just dropped GPT', why: 'benchmarks' },
  // A paraphrase, not the article's words.
  { type: 'lab', title: 'Faster science', facts: [], source: 'OpenAI', passage: 'Astra makes scientists dramatically faster at running experiments in the lab.', say: '', why: 'science' },
  // Not a scene we make.
  { type: 'driving', title: 'Roadster on a mountain road', facts: [], source: 'OpenAI', passage: 'We asked GPT‑6.2 Astra to visualize chassis dynamics of a car on a mountain road.', say: '', why: 'Driving simulation' },
  // A real passage, but the spoken words aren't in the script: kept, flagged.
  { type: 'cad', title: 'From reference photos to a lamp', facts: [], source: 'OpenAI',
    passage: 'The video follows the design from reference photos through CAD revisions to a physical lamp assembled by hand.', say: 'the Marina City towers lamp', why: 'From CAD to a paper lamp' },
] };

const server = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    const j = JSON.parse(body || '{}');
    ok(String(j.system ?? '').includes('Numbers shown only in charts or images are not in the text'), 'the prompt tells Helix chart-only numbers are out');
    ok(String(j.messages?.[0]?.content ?? '').includes('Mechanical design and assembly'), 'the prompt carries the article text');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(reply) }], stop_reason: 'end_turn', usage: { input_tokens: 9000, output_tokens: 1200 } }));
  });
});
await new Promise<void>((r) => server.listen(3931, r));
process.env.ANTHROPIC_API_BASE = 'http://127.0.0.1:3931';
process.env.ANTHROPIC_API_KEY = 'stand-in';

const { draftScenes, withScenes } = await import('../lib/unedit-scenes');
const { parseSheet, sheetText, placeNews } = await import('../lib/unedit-news');
try {
  const r = await draftScenes({ article: { url: 'https://openai.com/index/introducing-gpt-6-2-astra-sol/', title: 'Introducing GPT-6.2 Astra and Sol', text: articleText }, spoken: script });
  const titles = r.scenes.map((s) => s.title);
  ok(r.scenes.length === 4, 'four proposals pass the checks', titles.join(' | '));
  ok(titles.includes('A mechanical system, part by part') && titles.includes('Down to individual parts in CAD') && titles.includes('GPT-6.2 Astra — the professional flagship'), 'the assembly, CAD and model card are kept');
  ok(r.notes.some((n) => /62\.6.*isn't in its passage/.test(n)), 'chart-only benchmark numbers are left out', r.notes.find((n) => n.includes('62.6')));
  ok(r.notes.some((n) => /Faster science.*word for word/.test(n)), 'a paraphrased passage is left out');
  ok(r.notes.some((n) => /"driving" isn't a scene we make/.test(n)), 'a type not on the list is left out');
  const lamp = r.scenes.find((s) => s.title === 'From reference photos to a lamp');
  ok(lamp && !lamp.placeable && r.notes.some((n) => n.includes('From reference photos') && n.includes('spoken words')), 'a scene whose words aren\'t in the script is kept but flagged');
  ok(r.scenes.filter((s) => s.title !== 'From reference photos to a lamp').every((s) => s.placeable), 'the others can be placed on their spoken words');
  ok(r.cents > 0, 'the run is costed', `${r.cents}¢`);

  // Approve: the chosen scenes join the existing sheet (its other lines untouched); an unplaceable one is refused.
  const plan = { article: { url: 'https://openai.com/index/introducing-gpt-6-2-astra-sol/', title: 'Introducing', chars: articleText.length }, scenes: r.scenes, notes: r.notes, cents: r.cents, drafted_at: new Date().toISOString(), by: null, approved: null };
  const before = parseSheet('source | OpenAI just dropped GPT | openai.com · Nov 2026').entries;
  const keep = r.scenes.map((s, i) => (s.placeable ? i : -1)).filter((i) => i >= 0);
  const { entries, added } = withScenes(before, plan, keep);
  ok(added === 3 && entries.length === 4 && entries[0].kind === 'source', 'approving adds three scene lines and keeps the source line', sheetText(entries).split('\n').length + ' lines');
  // Words that aren't in the script yet can still go on the sheet (the panel says to fix them there; placement then
  // reports it as not placed). No words at all can't: there's nothing to place it on.
  ok(withScenes(before, plan, [r.scenes.indexOf(lamp!)]).added === 1, 'a scene with unmatched words can be added (fixed on the sheet)');
  const noWords = { ...plan, scenes: [{ ...lamp!, say: '' }] };
  let refused = ''; try { withScenes(before, noWords, [0]); } catch (e) { refused = e instanceof Error ? e.message : ''; }
  ok(/spoken words/.test(refused), 'approving a scene with no spoken words is refused', refused);
  const text = sheetText(entries);
  console.log(text.split('\n').map((l) => `      ${l}`).join('\n'));
  const again = parseSheet(text);
  ok(!again.errors.length && sheetText(again.entries) === text, 'the sheet round-trips (parse → text → parse)');
  ok(again.entries.some((e) => e.kind === 'scene' && e.scene === 'model' && e.facts?.length === 3), 'the model card keeps its three facts');
  ok(again.entries.some((e) => e.kind === 'scene' && e.scene === 'assembly' && e.facts?.length === 0), 'a scene with no number writes "-" and reads back empty');
  // Redrafting replaces scene lines; it never stacks them.
  const twice = withScenes(again.entries, plan, keep);
  ok(twice.entries.filter((e) => e.kind === 'scene').length === 3, 'approving again replaces the scene lines');

  // Hand-written lines are checked too.
  ok(parseSheet('scene | down to individual parts | cad | CAD | BenchCAD: 62.6% → 82.5% | OpenAI-reported').errors.length === 0, 'a hand-added chart number on a CAD scene parses (a person\'s call)');
  ok(parseSheet('scene | down to individual parts | cad | CAD | 62.6% | OpenAI').errors.length === 1, 'a fact without a label is refused');
  ok(parseSheet('scene | down to individual parts | model | Astra | Input: $8 → $9 ; Output: $40 | OpenAI').errors.length === 1, 'a model card refuses before → after facts');
  ok(parseSheet('scene | down to individual parts | cad | CAD | - |').errors.length === 1, 'a scene without its source shown is refused');

  // Placement: on a recording, scenes are placed where their words are said (drawn in the next release).
  let t = 0; const words = script.split(/\s+/).map((w) => ({ w: w.replace(/[.,]/g, ''), s: (t += 0.4) - 0.4, e: t }));
  const placed = placeNews(again.entries, words as never, (s) => s, 60);
  ok(placed.items.length === 1 && placed.items[0].kind === 'source', 'scenes don\'t enter the graphics reel yet; the source chip does');
  ok(placed.notes.filter((n) => n.startsWith('scene') && n.includes('lands at')).length === 3, 'each scene reports where it lands', placed.notes.filter((n) => n.startsWith('scene')).join(' · '));
} finally { server.close(); }
console.log(fails ? `\n${fails} FAILED` : '\nall scene-plan checks passed');
process.exit(fails ? 1 : 0);
