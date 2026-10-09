// Loads Genovus Studio Season 1 (data/studio-season1.json): the series, its episodes and shots, the posts for
// each platform with tracked links, and the soft-launch campaign. Safe to re-run: content is refreshed, but shot
// progress, render links, approvals and posts already edited or published are never overwritten.
//   node --env-file=<env file> scripts/seed-studio.mjs
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const S = JSON.parse(fs.readFileSync(new URL('../data/studio-season1.json', import.meta.url), 'utf8'));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data; };

const c = S.campaign;
must(await db.from('campaigns').upsert({ slug: c.slug, name: c.name, channel: 'social', segment: 'mixed', starts_on: c.starts_on, ends_on: c.ends_on, notes: 'Studio Season 1 soft launch: Facebook, Instagram, TikTok, YouTube Shorts. Organic only. Links carry src per platform.' }, { onConflict: 'slug', ignoreDuplicates: true }), 'campaign');

const s = S.series;
const series = must(await db.from('studio_series').upsert({ slug: s.slug, name: s.name, division: s.division, logline: s.logline, bible: s.bible }, { onConflict: 'slug' }).select('id').single(), 'series');

let shots = 0, posts = 0;
for (const e of S.episodes) {
  const ep = must(await db.from('studio_episodes').upsert({ series_id: series.id, code: e.code, kind: e.kind, title: e.title, runtime_s: e.runtime_s, logline: e.logline, script: e.script, music: e.music, sort: e.sort, thumb_prompt: e.thumb ?? null }, { onConflict: 'code' }).select('id').single(), `episode ${e.code}`);
  for (const sh of e.shots) {
    must(await db.from('studio_shots').upsert({ episode_id: ep.id, n: sh.n, timing: sh.timing ?? null, description: sh.description, camera: sh.camera ?? null, dialogue: sh.dialogue ?? null, prompt: sh.prompt ?? null, tool: sh.tool }, { onConflict: 'episode_id,n' }), `shot ${e.code}/${sh.n}`);
    shots++;
  }
  const p = S.posts[e.code];
  for (const platform of ['facebook', 'instagram', 'tiktok', 'youtube']) {
    if (!p?.[platform]) continue;
    const link = S.link.replace('{src}', S.src[platform]);
    must(await db.from('studio_posts').upsert({ episode_id: ep.id, platform, caption: p[platform].caption.replaceAll('{link}', link), title: p[platform].title ?? null, link, scheduled_for: p.when }, { onConflict: 'episode_id,platform', ignoreDuplicates: true }), `post ${e.code}/${platform}`);
    posts++;
  }
}
console.log(`Studio Season 1 loaded: ${S.episodes.length} episodes, ${shots} shots, ${posts} posts.`);
