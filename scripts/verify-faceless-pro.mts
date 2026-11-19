// Verify faceless clips (lib/unedit-shots.ts faceless mode + lib/unedit-faceless-pro.ts) without spend, on a real
// package's script, sources sheet and claims (a JSON file: { script, sheet, claims }). A stand-in Claude shot plan uses
// speaker layouts on purpose; code must turn every frame into a grounded graphic beat.
//   npx tsx --conditions=react-server scripts/verify-faceless-pro.mts <package.json> [props-out.json]
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) as { script: { part: string; lines: { say: string }[] }[]; sheet: string; claims: { text: string; status: string; attribution: string | null; approved: boolean }[] };
let fails = 0;
const ok = (c: unknown, what: string, extra = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${what}${extra ? `  (${extra})` : ''}`); if (!c) fails++; };

const { sentences } = await import('../lib/unedit-moments');
const { toShots, playOrder, SPEAKER_LAYOUTS } = await import('../lib/unedit-shots');
const { facelessProps, verdictOf, findSaid } = await import('../lib/unedit-faceless-pro');
const { parseSheet } = await import('../lib/unedit-news');

// The narration as timed words (a narrator's pace, a short breath between sentences).
let t = 0;
const words = pkg.script.flatMap((p) => p.lines.map((l) => l.say)).join(' ').split(/\s+/).filter(Boolean).map((w) => {
  const x = { w, s: t, e: t + 0.32 }; t += /[.!?]$/.test(w) ? 0.62 : 0.38; return x;
});
const ss = sentences(words as never);
// The clip: from the hook to "watch, and don't assume."
const last = ss.findIndex((x) => /don't assume/.test(x.text));
const from = ss[0].s, to = ss[last].e;
const order = playOrder(ss, from, to, null, null);
// A stand-in plan that makes every mistake the code guards against: speaker layouts, a figure never said, a verdict.
const raw = order.map((i, k) => {
  const text = ss[i].text;
  if (/8-K/.test(text)) return { s: i, layout: 'number', figure: '8-K', accent: 'filed' };
  if (/interim CEO/.test(text)) return { s: i, layout: 'number', figure: '$65 billion', accent: 'interim' };
  if (/haven't confirmed/.test(text)) return { s: i, layout: 'verdict', accent: 'confirmed' };
  if (/resignation/.test(text)) return { s: i, layout: 'word', accent: 'resignation' };
  return { s: i, layout: ['face', 'card', 'screen', 'split'][k % 4], accent: '', screen: 'ent-unedit' };
});
const shots = toShots(raw as never, ss, order, true);
ok(shots.every((s) => !SPEAKER_LAYOUTS.includes(s.layout)), 'no speaker layout survives in a faceless clip', [...new Set(shots.map((s) => s.layout))].join(','));
ok(shots[0].layout === 'hook', 'the first shot is the hook card');
ok(shots.every((s) => s.screen == null), 'no screen-library insert in a faceless clip');
ok(!shots.some((s) => s.figure === '$65 billion'), 'a figure the narrator never says is refused');
ok(shots.some((s) => s.layout === 'number' && s.figure === '8-K'), 'a figure the narrator says is kept');
ok(toShots(raw as never, ss, order, false)[0].layout === 'face', 'a real take still opens on the speaker (unchanged)');

const sheet = parseSheet(pkg.sheet).entries;
const spans = [{ from, to }];
const props = facelessProps('', words as never, spans as never, shots, [], { title: 'Huang resigns: what we know', sheet, claims: pkg.claims });
const kinds = props.beats.map((b) => b.kind);
ok(props.beats.every((b) => (b.text && b.text.trim()) || b.figure || b.accent || b.confirmed?.length || b.items?.length || b.scene), 'every beat has something to show (no empty frame)', kinds.join(','));
ok(props.beats[0].kind === 'hook' && props.beats[0].s === 0, 'the clip opens on the hook at 0 s');
ok(kinds.includes('source'), 'the SEC filing appears as an article card where it is said');
ok(props.beats.some((b) => b.kind === 'statement' && b.who) && !props.beats.some((b) => b.kind === 'source' && b.text && !pkg.sheet.includes(b.text)), 'a source chip is the narrator’s sentence with the outlet cited, never dressed as the document', props.beats.find((b) => b.who && b.kind === 'statement')?.who);
const v = props.beats.find((b) => b.kind === 'verdict');
const approvedConfirmed = pkg.claims.filter((c) => c.approved && c.status === 'confirmed').map((c) => c.text);
ok(v && v.confirmed!.every((x) => approvedConfirmed.includes(x)), 'confirmed lists only approved, confirmed claims', v?.confirmed?.[0]?.slice(0, 60));
ok(v && v.unconfirmed!.every((x) => pkg.claims.some((c) => c.approved && c.text === x.text) || words.map((w) => w.w).join(' ').includes(x.text)), 'not confirmed comes from approved claims or the narrator’s own sentence', v?.unconfirmed?.[0]?.text.slice(0, 60));
ok(!verdictOf(pkg.claims.map((c) => ({ ...c, approved: false })), 'x'), 'no approved claims: no verdict card (a statement instead)');
ok(props.beats.every((b, i) => i === 0 || b.s >= props.beats[i - 1].s), 'beats run in order');
ok(props.beats.every((b) => b.e - b.s > 0.5), 'every beat is long enough to read', Math.min(...props.beats.map((b) => b.e - b.s)).toFixed(2) + ' s min');
const gaps = props.beats.slice(1).map((b, i) => b.s - props.beats[i].e);
ok(gaps.every((g) => Math.abs(g) < 0.001), 'beats touch end to end (never an empty frame)', Math.max(...gaps.map(Math.abs)).toFixed(3) + ' s max');
ok(findSaid(words as never, 'will serve as interim CEO') > 0, 'sheet lines are found by their spoken words');
// The transcript spelled as the script (alignToScript): STT heard "eight k", the narrator read "8-K".
{
  const { alignToScript } = await import('../lib/unedit-faceless-pro');
  const W = (w: string, s: number) => ({ w, s, e: s + 0.3 });
  const heard = [W('Nvidia', 0), W('filed', 0.4), W('a', 0.8), W('form', 1.1), W('eight', 1.5), W('k', 1.9), W('with', 2.3), W('the', 2.6), W('SEC.', 2.9),
    W('Thanks', 4), W('for', 4.4), W('watching', 4.8), W('um', 5.2)];
  const lines = [{ text: 'Nvidia filed a Form 8-K with the SEC.', s: 0, e: 3.2 }, { text: 'Thanks for watching.', s: 3.9, e: 5.6 }];
  const out = alignToScript(heard as never, lines);
  const text = out.map((w) => w.w).join(' ');
  ok(text === 'Nvidia filed a Form 8-K with the SEC. Thanks for watching.', 'faceless captions read the script, not the misheard words', text);
  const k8 = out.find((w) => w.w === '8-K')!;
  ok(k8 && Math.abs(k8.s - 1.5) < 0.01 && Math.abs(k8.e - 2.2) < 0.01, '"8-K" takes the time "eight k" was said', k8 ? `${k8.s}-${k8.e}` : 'missing');
  ok(out.every((w, i) => i === 0 || w.s >= out[i - 1].s - 1e-9), 'aligned words stay in time order');
  const missed = alignToScript([W('Thanks', 4), W('watching.', 4.8)] as never, [lines[1]]);
  ok(missed.map((w) => w.w).join(' ') === 'Thanks for watching.', 'a word the transcript missed is put back in its gap', missed.map((w) => w.w).join(' '));
  const silent = alignToScript([] as never, [lines[0]]);
  ok(silent.length === 8 && silent[0].s === 0 && silent[7].e <= 3.2 + 1e-9, 'a line with no heard words is spread over its own window');
}
const longest = Math.max(...props.beats.map((b) => b.e - b.s));
console.log(`      ${props.beats.length} beats over ${props.secs.toFixed(1)} s (longest ${longest.toFixed(1)} s): ${kinds.join(' → ')}`);
if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(props));
console.log(fails ? `\n${fails} FAILED` : '\nall faceless checks passed');
process.exit(fails ? 1 : 0);
