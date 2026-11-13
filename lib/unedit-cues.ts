// The Cue Engine: the words decide the edit. Every graphic, animation, sound, effect and camera move lands on the
// exact word that earns it. Two halves:
//   tagger    code, instant and consistent: each word is tagged by what it is (a number or money, a span of time, a
//             brand, a list, a contrast, a question, an action in the product, a call to action, emphasis)
//   director  Claude reads the tagged transcript in the same call that plans the clips and writes a cue sheet from a
//             fixed vocabulary; code owns it like the cuts and shots: the cue must sit on a word whose tag fits it,
//             and pacing rules space the big moments so the edit feels intentional, never busy.
// Sounds and animations are named slots (lib side) rendered by Genovus Motion; licensed packs swap into the slots.
import type { Word } from '@/lib/unedit-media';

export const CUE_KINDS = ['counter', 'logo', 'list', 'whip', 'question', 'tap', 'headline', 'cta', 'icon'] as const;
/** Icons the director may pop on a real-world noun (Lucide, ISC license; every name checked against lucide-react). */
export const ICONS = new Set(["Coffee", "Candy", "Cookie", "Heart", "HeartPulse", "Brain", "Dumbbell", "Apple", "Pill", "Car", "House", "Briefcase", "Clock", "Calendar", "Phone", "Smartphone", "Camera", "Video", "Mic", "Mail", "MessageCircle", "Users", "User", "Baby", "Dog", "Plane", "MapPin", "Globe", "Sun", "Moon", "Flame", "Zap", "Rocket", "Trophy", "Target", "TrendingUp", "TrendingDown", "DollarSign", "Wallet", "PiggyBank", "CreditCard", "ShoppingCart", "Gift", "Book", "GraduationCap", "Lightbulb", "Shield", "Lock", "Key", "Wrench", "Hammer", "Code", "Laptop", "Bot", "Sparkles", "Star", "ThumbsUp", "ThumbsDown", "Check", "X", "AlertTriangle", "Ban", "Hourglass", "Timer", "Bed", "Utensils", "Pizza", "Beer", "Wine", "Droplet", "Leaf", "Music", "Gamepad2", "Church", "HandHeart", "Smile", "Frown", "Footprints", "Activity", "Stethoscope", "Scale", "Megaphone", "Eye", "Crown", "Gem", "Store", "Building2", "Factory", "Truck", "Fuel", "Umbrella", "CloudRain", "Snowflake", "Bike", "Medal", "Repeat", "RefreshCw", "Send", "Upload", "Download", "Play", "Pause", "Film", "Image", "Sofa", "Shirt", "Watch", "Ticket", "Puzzle", "Handshake", "Landmark", "Receipt", "Calculator", "ChartLine", "ChartPie", "Banknote", "Coins", "Bitcoin", "HandCoins", "Siren", "Skull", "Bug", "Cake", "IceCreamCone", "Croissant", "Salad", "Sandwich", "Soup", "Milk", "CupSoda", "Sprout", "Mountain", "Waves", "Tent", "Anchor", "Ship", "Train", "Bus", "Fish"]);
export type CueKind = (typeof CUE_KINDS)[number];
export const SOUND_SLOTS = ['hit', 'whoosh', 'riser', 'pop', 'click', 'tick', 'swish', 'sting'] as const;
export type SoundSlot = (typeof SOUND_SLOTS)[number];
export const CAMERA = ['punch', 'push', 'pull', 'shake', 'whip'] as const;
export type CameraMove = (typeof CAMERA)[number];
export type Tag = 'number' | 'money' | 'time' | 'brand' | 'list' | 'contrast' | 'question' | 'action' | 'cta' | 'emphasis';

/** A cue on the recording's timeline: anchored to word w (global index), held until word w1. */
export type Cue = { kind: CueKind; w: number; w1: number; s: number; e: number; text: string; icon?: string; items?: string[]; value?: number; prefix?: string; suffix?: string; screen?: string | null; sound: SoundSlot | null; cam: CameraMove | null };
export type RawCue = { w?: string; s?: number; kind?: string; text?: string; icon?: string; items?: unknown[]; screen?: string | null; sound?: string | null; cam?: string | null };

// Each kind's default sound and camera move: the director may change them only to another slot in the vocabulary.
export const DEFAULTS: Record<CueKind, { sound: SoundSlot | null; cam: CameraMove | null; needs: Tag[] }> = {
  counter: { sound: 'tick', cam: 'punch', needs: ['number', 'money', 'time'] },
  logo: { sound: 'whoosh', cam: null, needs: ['brand'] },
  list: { sound: 'pop', cam: 'push', needs: ['list'] },
  whip: { sound: 'swish', cam: 'whip', needs: ['contrast'] },
  question: { sound: 'riser', cam: 'push', needs: ['question'] },
  tap: { sound: 'click', cam: 'punch', needs: ['action'] },
  headline: { sound: 'hit', cam: 'shake', needs: ['emphasis', 'number', 'money'] },
  cta: { sound: 'sting', cam: 'pull', needs: ['cta'] },
  icon: { sound: 'pop', cam: null, needs: [] },
};

const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9$%.,']/g, '').replace(/[.,]$/, '');
const NUMBER_WORDS: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100, thousand: 1000, million: 1_000_000, half: 0.5 };
const TIME = /^(seconds?|minutes?|hours?|days?|weeks?|months?|years?|mins?|hrs?)$/;
const BRANDS = /^(genovus|helix|unedit|metricool|geico|statefarm|allstate|progressive|instagram|youtube|facebook|tiktok|google|claude)(['’]s)?$/;
const CONTRAST = new Set(['but', 'instead', 'however', 'actually', 'except', 'unless', 'yet']);
const ACTIONS = /^(tap|taps|tapped|click|clicks|upload|uploads|uploaded|approve|approves|approved|record|records|recorded|post|posts|posted|press|hit|swipe|open|send|sends|book|schedule)$/;
const CTA = /^(subscribe|follow|comment|link|dm|join|sign|start|try|book|visit|download)$/;
const EMPHASIS = new Set(['never', 'always', 'every', 'everything', 'nothing', 'nobody', 'only', 'zero', 'free', 'biggest', 'fastest', 'secret', 'truth', 'mistake', 'wrong', 'game', 'changer', 'insane', 'crazy', 'finally', 'stop', 'real']);
const LIST = /^(first|second|third|fourth|fifth|firstly|secondly|lastly|finally)$/;

/** The number a word says, if any: "40,000", "$40k", "3", "three", "2.5", "50%". */
export function numberOf(w: string): { value: number; prefix: string; suffix: string } | null {
  const t = w.toLowerCase().replace(/[^a-z0-9$%.,k]/g, '').replace(/[.,]$/, '');
  const m = t.match(/^(\$?)([0-9][0-9,]*(?:\.[0-9]+)?)(k|m|%|x)?$/);
  if (m) {
    let value = Number(m[2].replace(/,/g, ''));
    if (m[3] === 'k') value *= 1000;
    if (m[3] === 'm') value *= 1_000_000;
    return Number.isFinite(value) ? { value, prefix: m[1], suffix: m[3] === '%' ? '%' : m[3] === 'x' ? '×' : '' } : null;
  }
  return t in NUMBER_WORDS ? { value: NUMBER_WORDS[t], prefix: '', suffix: '' } : null;
}

/** Tags for every word (empty when a word is ordinary). */
export function tagWords(words: Word[]): Tag[][] {
  const n = words.map((w) => norm(w.w));
  return words.map((w, i) => {
    const tags: Tag[] = [];
    const num = numberOf(w.w);
    if (num) {
      tags.push('number');
      if (/\$/.test(w.w) || /^(dollars?|bucks|k)$/.test(n[i + 1] ?? '')) tags.push('money');
      if (TIME.test(n[i + 1] ?? '')) tags.push('time');
      if (/^(things?|ways?|steps?|reasons?|mistakes?|tips?|rules?|lessons?)$/.test(n[i + 1] ?? '')) tags.push('list');
    }
    if (LIST.test(n[i])) tags.push('list');
    if (BRANDS.test(n[i])) tags.push('brand');
    if (CONTRAST.has(n[i])) tags.push('contrast');
    if (/\?["')\]]?$/.test(w.w)) tags.push('question');
    if (ACTIONS.test(n[i])) tags.push('action');
    if (CTA.test(n[i]) && /^(up|the|in|below|today|now|for|link|me|us)$/.test(n[i + 1] ?? '')) tags.push('cta');
    if (EMPHASIS.has(n[i])) tags.push('emphasis');
    return tags;
  });
}

/** The tagged transcript line for the prompt: tagged words are marked inline, e.g. "saved [40,000|number,money] a year". */
export function taggedText(words: Word[], tags: Tag[][], w0: number, w1: number): string {
  const out: string[] = [];
  for (let i = w0; i <= w1; i++) out.push(tags[i]?.length ? `[${words[i].w}|${tags[i].join(',')}]` : words[i].w);
  return out.join(' ');
}

/** The prompt's instructions for the "cues" field of each clip. */
export const CUES_RULES = [
  'For every clip also write "cues": the graphics, sounds and camera moves, each placed on ONE exact word of the transcript. Tagged words look like [word|tags]. A cue goes on a tagged word whose tag fits it:',
  'counter = a number counts up on screen (on a number, money or time word; "text" is what it measures, e.g. "hours a week"). logo = the brand mark reveals (on a brand). list = items build one by one as they are said (on a list word; "items": the 2-5 items, each copied from the transcript, under 5 words). whip = a whip transition into the contrast (on "but", "instead"…). question = a question card (on the question\'s last word; "text" is the question, under 10 words). tap = the product screen gets a tap (on an action word; "screen" is a screen code from the list). headline = the line hits as kinetic type (on an emphasis word; "text" is 2-5 words copied from the sentence). cta = the closing call to action (on a call-to-action word; "text" under 6 words). icon = a real thing the speaker names gets its icon (on that noun, ANY word, tagged or not; "icon" is one name from: ' + [...ICONS].join(', ') + '). Icons suit everyday, personal and story talk where there are no numbers or brands.',
  'Each cue: {"w":"<the exact word>","s":<sentence #>,"kind":"<kind>","text":"…","items":[…],"screen":null,"icon":null,"sound":"' + SOUND_SLOTS.join('|') + '|null","cam":"' + CAMERA.join('|') + '|null"}. Sound and camera are optional; leave them out for the default.',
  'Fewer, better cues: one for the hook, then at most one every 4 seconds of talk; skip quiet, emotional or personal moments (let the face carry them). Pick the moments a top editor would: the number that surprises, the brand when it is the point, the list when the speaker counts, the turn of the argument.',
].join('\n');

const MAJOR_GAP = 3.2; // seconds between two cues
const PRIORITY: CueKind[] = ['counter', 'list', 'tap', 'logo', 'question', 'cta', 'headline', 'icon', 'whip'];
const MAX_PER_CLIP = 8;

/** Repair the director's cues for one clip into code-checked cues on words inside the clip's sentences. */
export function toCues(raw: RawCue[] | undefined, ss: { i: number; w0: number; w1: number }[], order: number[], words: Word[], tags: Tag[][], screens: Set<string>): Cue[] {
  const allowed = new Set(order);
  const out: Cue[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const kind = (CUE_KINDS as readonly string[]).includes(String(r?.kind)) ? (r.kind as CueKind) : null;
    const sen = ss[Number(r?.s)];
    if (!kind || !sen || !allowed.has(sen.i)) continue;
    const want = norm(String(r.w ?? ''));
    let w = -1;
    for (let i = sen.w0; i <= sen.w1; i++) if (norm(words[i].w) === want) { w = i; break; }
    if (w < 0) continue;
    const d = DEFAULTS[kind];
    // The word must carry a tag that fits the cue (a counter needs a number, a logo a brand…).
    if (d.needs.length && !d.needs.some((t) => tags[w]?.includes(t))) continue;
    const text = typeof r.text === 'string' ? r.text.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
    const sound = (SOUND_SLOTS as readonly string[]).includes(String(r.sound)) ? (r.sound as SoundSlot) : r.sound === null ? null : d.sound;
    const cam = (CAMERA as readonly string[]).includes(String(r.cam)) ? (r.cam as CameraMove) : r.cam === null ? null : d.cam;
    const cue: Cue = { kind, w, w1: Math.min(sen.w1, w + 6), s: words[w].s, e: words[Math.min(sen.w1, w + 6)].e, text, sound, cam };
    if (kind === 'counter') {
      const num = numberOf(words[w].w);
      if (!num || num.value <= 0) continue;
      Object.assign(cue, { value: num.value, prefix: num.prefix || (tags[w].includes('money') ? '$' : ''), suffix: num.suffix });
    }
    if (kind === 'list') {
      const sentence = words.slice(sen.w0, sen.w1 + 30).map((x) => norm(x.w)).join(' ');
      const items = (Array.isArray(r.items) ? r.items : []).map((x) => String(x).replace(/\s+/g, ' ').trim()).filter((x) => x && x.split(' ').length <= 5 && sentence.includes(norm(x.split(' ')[0])));
      if (items.length < 2) continue;
      cue.items = items.slice(0, 5);
      cue.e = words[Math.min(words.length - 1, sen.w1 + 30)].e;
    }
    if (kind === 'icon') {
      // A real thing the speaker names (coffee, sugar, a car, money): its icon pops beside them, labeled with their word.
      const name = String(r.icon ?? '');
      if (!ICONS.has(name) || norm(words[w].w).length < 3) continue;
      cue.icon = name;
      cue.text = words[w].w.replace(/[^\p{L}\p{N}'-]/gu, '').toLowerCase();
      cue.e = Math.min(cue.e, cue.s + 1.8);
    }
    if (kind === 'tap') { cue.screen = typeof r.screen === 'string' && screens.has(r.screen) ? r.screen : null; if (!cue.screen) continue; }
    if ((kind === 'question' || kind === 'headline' || kind === 'cta') && !text) continue;
    if (kind === 'headline') {
      // The headline's words must be the speaker's own.
      const said = new Set(words.slice(sen.w0, sen.w1 + 1).map((x) => norm(x.w)));
      if (!text.split(' ').every((t) => said.has(norm(t)))) continue;
    }
    out.push(cue);
  }
  // Pacing: when two cues crowd each other, the stronger kind wins (a number the viewer can see beats a styled line);
  // every kept cue is at least MAJOR_GAP from the others, at most MAX_PER_CLIP, in time order.
  const kept: Cue[] = [];
  for (const c of out.sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind) || a.s - b.s)) {
    if (kept.length >= MAX_PER_CLIP || kept.some((k) => Math.abs(k.s - c.s) < MAJOR_GAP)) continue;
    kept.push(c);
  }
  return kept.sort((a, b) => a.s - b.s);
}
