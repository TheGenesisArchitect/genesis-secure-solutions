// Verify the Footage Desk's rules (lib/unedit-footage.ts) without network or spend: which licences are taken, what a
// footage plan may ask for, and which candidates count as on topic.
//   npx tsx --conditions=react-server scripts/verify-footage.mts
const { commonsLicense, checkPlan, onTopic, namesPerson } = await import('../lib/unedit-footage');
let fails = 0;
const ok = (c: unknown, what: string, extra = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${what}${extra ? `  (${extra})` : ''}`); if (!c) fails++; };
const M = (code: string, short: string) => ({ License: { value: code }, LicenseShortName: { value: short } });

ok(commonsLicense(M('cc-by-4.0', 'CC BY 4.0'))?.license === 'cc-by', 'Commons CC BY is taken (credited)');
ok(commonsLicense(M('cc0', 'CC0'))?.license === 'cc0', 'Commons CC0 is taken');
ok(commonsLicense(M('pd', 'Public domain'))?.license === 'public-domain', 'Commons public domain is taken');
ok(!commonsLicense(M('cc-by-sa-4.0', 'CC BY-SA 4.0')), 'share-alike is refused (our cut is an edited, commercial work)');
ok(!commonsLicense(M('cc-by-nc-2.0', 'CC BY-NC 2.0')), 'non-commercial is refused');
ok(!commonsLicense(M('cc-by-nd-3.0', 'CC BY-ND 3.0')), 'no-derivatives is refused');
ok(!commonsLicense(M('', 'Fair use')), 'an unknown or fair-use licence is refused');

const ids = [0, 1, 2, 3, 4];
const plan = checkPlan([
  { i: 0, query: 'computer chip macro', source: 'pixabay' },
  { i: 1, query: 'empty corporate office', source: 'pixabay' },
  { i: 2, query: 'empty corporate office', source: 'pixabay' },
  { i: 3, query: 'rocket launch', source: 'youtube' },
  { i: 4, query: 'jensen huang on stage', source: 'commons' },
  { i: 9, query: 'stock market', source: 'pixabay' },
], ids, ['Jensen', 'Huang', 'Nvidia']);
ok(!plan.some((p) => p?.i === 0), 'never footage on the first line (the hook card)');
ok(plan.filter((p) => p?.query === 'empty corporate office').length === 1, 'the same search is never used on two lines in a row');
ok(!plan.some((p) => p?.i === 3), 'an unknown source (e.g. youtube) is refused');
ok(!plan.some((p) => p?.i === 4), 'a search naming a person or company in the story is refused');
ok(!plan.some((p) => p?.i === 9), 'a line that is not in the clip is refused');
const word = checkPlan([{ i: 1, query: 'cyber security office', source: 'pixabay' }, { i: 2, query: 'cloud platform servers', source: 'pixabay' }], ids, ['SEC', 'Form']);
ok(word.length === 2, 'names match whole words only ("SEC" does not refuse "security", "Form" does not refuse "platform")', word.map((p) => p?.query).join(', '));

const C = (title: string, tags: string[] = [], source: 'pixabay' | 'commons' = 'pixabay', width = 1920) => ({ source, source_id: 'x', page_url: 'u', file_url: 'f', title, author: null, tags, width, height: 1080, secs: 10, license: 'pixabay' as const, license_note: '', credit: null });
ok(onTopic(C('trading screens', ['stock', 'market', 'finance']), 'stock market screens'), 'a clip tagged with the search is on topic');
ok(!onTopic(C('Chinese Fishing nets', [], 'commons'), 'stock exchange'), 'Commons answering "stock exchange" with fishing nets is refused');
ok(!onTopic(C('New York Stock Exchange', [], 'commons', 854), 'stock exchange'), 'a Commons clip under 1280 wide is refused');
ok(onTopic(C('server room corridor', ['servers']), 'data center servers'), 'plural and singular match (servers ↔ server)');

// People (house desk): identity from the source's own text, only people the story names, never on an agency desk.
ok(namesPerson('Jensen huang stanford 2026-04-30 008 (cropped)', 'Jensen Huang'), 'a file whose title names the person counts');
ok(!namesPerson('NVIDIA CEO speaks at Computex', 'Jensen Huang'), 'a file that does not name the person is refused (never picked by face)');
ok(!namesPerson('Jensen Ackles at Comic-Con', 'Jensen Huang'), 'a first name alone is not the person');
const story = ['Jensen', 'Huang', 'Colette', 'Kress', 'Nvidia', 'SEC'];
const ppl = checkPlan([{ i: 1, person: 'Jensen Huang' }, { i: 2, person: 'Jensen Huang' }, { i: 3, person: 'Lisa Su' }, { i: 4, person: 'Colette Kress' }], ids, story, true);
ok(ppl.length === 2 && ppl[0]?.person === 'Jensen Huang' && ppl[1]?.person === 'Colette Kress', 'people the story names are shown; the same person twice in a row and anyone the story does not name are refused', ppl.map((p) => p?.person).join(', '));
ok(checkPlan([{ i: 1, person: 'Jensen Huang' }], ids, story, false).length === 0, 'an agency desk (people off) never shows a person');
ok(checkPlan([{ i: 1, person: 'Huang' }], ids, story, true).length === 0, 'a single name is not enough to pick a person');

console.log(fails ? `\n${fails} FAILED` : '\nall footage checks passed');
process.exit(fails ? 1 : 0);
