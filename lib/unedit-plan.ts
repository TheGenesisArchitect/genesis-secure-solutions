// UnEdit posting plan: when each approved post goes out. Three ways, picked on the Approve card:
//   now       every post within the next minutes (the old behaviour)
//   plan      Helix's plan: a rhythm (flood, drip or steady) laid on the calendar at each network's best hours,
//             spread around the brand's other scheduled posts so no day is overloaded
//   calendar  the same plan, with the times the user moved
// Pure and deterministic (no I/O): the card previews exactly what the server will schedule. Times are New York.
export type Rhythm = 'flood' | 'drip' | 'steady';
export type PostMode = 'now' | 'plan' | 'calendar';
export type Net = 'instagram' | 'facebook' | 'youtube' | 'tiktok' | 'twitter' | 'linkedin';

/** One post to place. unit groups the posts that go out together (a clip on every network, or the full video);
 *  rank orders the units (0 = the strongest hook, which leads). */
export type PlanPost = { key: string; unit: string; platform: Net; kind: string; rank: number };
/** A post the brand already has scheduled (another episode), so this plan spreads around it. */
export type Busy = { platform: string; at: string };

export const RHYTHMS: Record<Rhythm, { name: string; blurb: string }> = {
  flood: { name: 'Flood', blurb: 'Most posts in the first two days, while the story is hot.' },
  drip: { name: 'Drip', blurb: 'One clip every other day for two weeks, for depth and comments.' },
  steady: { name: 'Steady', blurb: 'One clip a day at your usual rhythm, for awareness week after week.' },
};

/** The hours (New York) each network's posts go out, best first. Metricool's best times replace these once the
 *  account has enough history to rank hours (the Genovus brand has none yet, 2026-11-16). */
export const DEFAULT_HOURS: Record<Net, number[]> = {
  instagram: [11, 18, 13, 20], facebook: [12, 9, 15, 19], youtube: [15, 12, 18, 10],
  tiktok: [19, 12, 9, 21], twitter: [9, 12, 17, 8], linkedin: [8, 12, 10, 17],
};
/** The brand's rhythm: at most this many posts per network per day, across every scheduled episode. */
export const DAILY_CAP: Record<Net, number> = { instagram: 2, facebook: 2, youtube: 2, tiktok: 3, twitter: 4, linkedin: 1 };

/** Nothing is scheduled sooner than this after Approve (Metricool needs time to copy the video). */
export const LEAD_MIN = 20;

// ---- New York time without a library: the offset at a moment, and a wall-clock time made into a Date. ----
const NY_PARTS = (d: Date) => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(d).map((p) => [p.type, p.value]));
/** The New York calendar day of a moment, as y-m-d numbers. */
export function nyDay(d: Date): { y: number; m: number; d: number } { const p = NY_PARTS(d); return { y: +p.year, m: +p.month, d: +p.day }; }
/** A New York wall-clock time (day offset from a given NY day, hour, minute) as a real moment. */
export function nyAt(day: { y: number; m: number; d: number }, plusDays: number, hour: number, minute = 0): Date {
  const guess = new Date(Date.UTC(day.y, day.m - 1, day.d + plusDays, hour, minute));
  // New York is UTC-4 or UTC-5: read what wall time the guess shows there and correct by the difference (twice
  // covers the hour the clocks change).
  let t = guess.getTime();
  for (let i = 0; i < 2; i++) {
    const p = NY_PARTS(new Date(t));
    const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    t += guess.getTime() - shown;
  }
  return new Date(t);
}
const dayKey = (d: Date) => { const x = nyDay(d); return `${x.y}-${x.m}-${x.d}`; };

/** Which day (from today = 0) each unit leads on, for a rhythm. The full video always goes on day 0 (or with the
 *  first clip); clips follow by rank. */
function unitDays(rhythm: Rhythm, ranks: number[]): number[] {
  // Units of the same rank (the full video and the first clip) share a day.
  const order = [...new Set(ranks)].sort((a, b) => a - b);
  return ranks.map((r) => { const i = order.indexOf(r); return rhythm === 'flood' ? Math.floor(i / 2) : rhythm === 'drip' ? i * 2 : i; });
}

/** Place every post. Returns post key → ISO time. Deterministic for the same inputs. */
export function planPosts(posts: PlanPost[], o: { rhythm: Rhythm; start: Date; busy?: Busy[]; hours?: Partial<Record<Net, number[]>> }): Record<string, string> {
  const earliest = o.start.getTime() + LEAD_MIN * 60_000;
  // Approved late in the evening (8 PM on in New York), the plan starts tomorrow, so day 0 of the rhythm is a real day.
  const late = Number(NY_PARTS(new Date(earliest)).hour) >= 20;
  const today = late ? nyDay(nyAt(nyDay(o.start), 1, 12)) : nyDay(o.start);
  // Per network per NY day: how many posts are already there (other episodes, then this plan as it fills).
  const load = new Map<string, number>();
  const bump = (net: string, k: string) => load.set(`${net}|${k}`, (load.get(`${net}|${k}`) ?? 0) + 1);
  const used = new Set<string>();
  for (const b of o.busy ?? []) { const at = new Date(b.at); if (!Number.isNaN(at.getTime())) { bump(b.platform, dayKey(at)); used.add(`${b.platform}|${at.toISOString().slice(0, 13)}`); } }
  // Units in rank order: the full video sits with the first clip.
  const ranks = new Map<string, number>();
  for (const p of posts) ranks.set(p.unit, Math.min(ranks.get(p.unit) ?? Infinity, p.rank));
  const units = [...ranks.keys()].sort((a, b) => ranks.get(a)! - ranks.get(b)! || a.localeCompare(b));
  const days = unitDays(o.rhythm, units.map((u) => ranks.get(u)!));
  const out: Record<string, string> = {};
  // A drip or steady rhythm is about spacing: when a clip spills past its day (its hours have passed, or the day is full
  // with other episodes), every later clip moves by the same number of days, so the gaps between clips hold.
  let slip = 0;
  units.forEach((u, ui) => {
    const target = days[ui] + (o.rhythm === 'flood' ? 0 : slip);
    let firstDay = Infinity;
    for (const p of posts.filter((x) => x.unit === u).sort((a, b) => a.platform.localeCompare(b.platform) || a.kind.localeCompare(b.kind))) {
      const hours = (o.hours?.[p.platform]?.length ? o.hours[p.platform]! : DEFAULT_HOURS[p.platform]) ?? [12];
      // A flood is allowed one more post a day than the usual rhythm: that is the point of it.
      const cap = (DAILY_CAP[p.platform] ?? 2) + (o.rhythm === 'flood' ? 1 : 0);
      let placed: Date | null = null;
      // Its day first, then later days until one has room under the brand's daily rhythm and a free best hour.
      for (let d = target; d < target + 21 && !placed; d++) {
        const k = dayKey(nyAt(today, d, 12));
        if ((load.get(`${p.platform}|${k}`) ?? 0) >= cap) continue;
        for (const h of hours) {
          const at = nyAt(today, d, h);
          if (at.getTime() < earliest) continue;
          if (used.has(`${p.platform}|${at.toISOString().slice(0, 13)}`)) continue;
          placed = at; firstDay = Math.min(firstDay, d); break;
        }
      }
      // Every hour taken for three weeks (never in practice): right after the lead time.
      placed ??= new Date(Math.ceil(earliest / 300_000) * 300_000);
      out[p.key] = placed.toISOString();
      bump(p.platform, dayKey(placed));
      used.add(`${p.platform}|${placed.toISOString().slice(0, 13)}`);
    }
    if (Number.isFinite(firstDay)) slip = Math.max(slip, firstDay - days[ui]);
  });
  return out;
}

/** Post now: everything right after the lead-in, a few minutes apart per unit so the feeds don't get a wall. */
export function nowTimes(posts: PlanPost[], start: Date): Record<string, string> {
  const units = [...new Set([...posts].sort((a, b) => a.rank - b.rank).map((p) => p.unit))];
  return Object.fromEntries(posts.map((p) => [p.key, new Date(start.getTime() + (15 + units.indexOf(p.unit) * 5) * 60_000).toISOString()]));
}

/** What the story behind a recording tells the planner. heat and ageH come from the Newsroom (the morning brief's
 *  heat for the story, and how long ago it broke); both are null for a recording that isn't from a story. */
export type Signal = { headline: string | null; heat: number | null; ageH: number | null; fit: number | null };

/** Helix's recommendation and its reason, from real numbers only (never a heat that wasn't measured). */
export function recommend(s: Signal): { rhythm: Rhythm; why: string } {
  const story = s.headline ? `“${s.headline.length > 60 ? `${s.headline.slice(0, 57)}…` : s.headline}”` : null;
  if (!story) return { rhythm: 'steady', why: 'This recording isn’t tied to a news story, so a steady clip a day keeps you visible without crowding your feed.' };
  const age = s.ageH != null ? (s.ageH < 24 ? `broke ${Math.max(1, Math.round(s.ageH))} h ago` : `is ${Math.round(s.ageH / 24)} day${Math.round(s.ageH / 24) === 1 ? '' : 's'} old`) : null;
  if (s.heat != null && s.heat >= 70 && (s.ageH == null || s.ageH <= 48)) return { rhythm: 'flood', why: `${story} is heat ${s.heat}${age ? ` and ${age}` : ''}. Most clips in the first two days, while people are searching for it.` };
  if ((s.ageH != null && s.ageH > 96) || (s.heat != null && s.heat < 45)) return { rhythm: 'drip', why: `${story}${age ? ` ${age}` : ''}${s.heat != null ? `${age ? ',' : ' is'} heat ${s.heat}` : ''}: past the rush, so one deeper clip every other day builds depth and comments.` };
  return { rhythm: 'steady', why: `${story}${age ? ` ${age}` : ''}${s.heat != null ? `${age ? ',' : ' is'} heat ${s.heat}` : ''}: still current, so one clip a day keeps the conversation going.` };
}

/** "Mon 9:00 AM" in New York. */
export const slotLabel = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
/** "Mon, Nov 17" in New York. */
export const dayLabel = (iso: string) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' });

/** The networks UnEdit posts to today: the formats read back from real Metricool posts. TikTok, X and LinkedIn join
 *  once they are connected to the brand and one post of each has been checked in Metricool. */
export const POSTING_NETS: Net[] = ['instagram', 'facebook', 'youtube'];
/** Each clip's posts: a Reel on Instagram and Facebook, a Short on YouTube. */
export const CLIP_FORMATS: { platform: Net; kind: string }[] = [{ platform: 'instagram', kind: 'reel' }, { platform: 'facebook', kind: 'reel' }, { platform: 'youtube', kind: 'short' }];
export const postKey = (clip: string | null, platform: string, kind: string) => `${clip ?? 'video'}:${platform}:${kind}`;

/** The campaign's posts for the planner: every clip that will be approved (the hook clips lead, then by order), and
 *  the full video on YouTube unless it already went out. */
export function campaignPosts(clips: { id: string; n: number; hook: boolean }[], longform: boolean): PlanPost[] {
  const order = [...clips].sort((a, b) => Number(b.hook) - Number(a.hook) || a.n - b.n);
  const out: PlanPost[] = order.flatMap((c, i) => CLIP_FORMATS.filter((f) => POSTING_NETS.includes(f.platform)).map((f) => ({ key: postKey(c.id, f.platform, f.kind), unit: c.id, platform: f.platform, kind: f.kind, rank: i })));
  if (longform) out.push({ key: postKey(null, 'youtube', 'video'), unit: 'video', platform: 'youtube', kind: 'video', rank: 0 });
  return out;
}

/** A moment as the value of a datetime-local field in New York ("2026-11-17T09:00"). */
export function nyInput(iso: string): string {
  const d = new Date(iso);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
/** A datetime-local value read as New York time; null when it isn't a time. */
export function fromNyInput(v: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v);
  if (!m) return null;
  return nyAt({ y: +m[1], m: +m[2], d: +m[3] }, 0, +m[4], +m[5]).toISOString();
}
