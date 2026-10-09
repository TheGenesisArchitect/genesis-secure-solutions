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
  const ep = must(await db.from('studio_episodes').upsert({ series_id: series.id, code: e.code, kind: e.kind, title: e.title, runtime_s: e.runtime_s, logline: e.logline, script: e.script, music: e.music, sort: e.sort, thumb_prompt: e.thumb ?? null, format: e.format ?? 'original', fork_mode: e.fork_mode ?? null, target_s: e.target_s ?? null, cut_family: e.cut_family ?? null, seat_map: e.seat_map ?? null }, { onConflict: 'code' }).select('id').single(), `episode ${e.code}`);
  for (const sh of e.shots) {
    const dialogue = sh.dialogue ?? (sh.lines?.length ? sh.lines.map((l) => `${l.who.replace(/d+$/, '')}: ${l.text}`).join(' / ') : null);
    const saved = must(await db.from('studio_shots').upsert({ episode_id: ep.id, n: sh.n, timing: sh.timing ?? null, description: sh.description, camera: sh.camera ?? sh.log?.camera ?? null, dialogue, prompt: sh.prompt ?? null, tool: sh.tool,
      shot_code: sh.shot_code ?? null, beat: sh.beat ?? null, shot_kind: sh.shot_kind ?? null, cast_codes: sh.cast_codes ?? [], lines: sh.lines ?? [] }, { onConflict: 'episode_id,n' }).select('id').single(), `shot ${e.code}/${sh.n}`);
    // The shot log is a working record: only filled when still empty, so edits made in the Studio survive a reload.
    if (sh.log) await db.from('studio_shots').update({ log: sh.log }).eq('id', saved.id).eq('log', '{}');
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

// Trend board sources (added once, matched by link) and how specific posts go out (only while still drafts).
let sources = 0;
for (const src of S.sources ?? []) {
  const { data: have } = await db.from('studio_sources').select('id').eq('url', src.url).maybeSingle();
  if (have) continue;
  const ep = src.episode ? must(await db.from('studio_episodes').select('id').eq('code', src.episode).single(), 'source episode') : null;
  must(await db.from('studio_sources').insert({ series_id: series.id, episode_id: ep?.id ?? null, url: src.url, platform: src.platform, creator: src.creator || null, title: src.title, route: src.route, notes: src.notes ?? null }), `source ${src.title}`);
  sources++;
}
for (const [code, byPlatform] of Object.entries(S.post_methods ?? {})) {
  const ep = must(await db.from('studio_episodes').select('id').eq('code', code).single(), 'episode');
  for (const [platform, m] of Object.entries(byPlatform)) {
    const { data: src } = await db.from('studio_sources').select('id').eq('url', m.source).maybeSingle();
    await db.from('studio_posts').update({ method: m.method, source_id: src?.id ?? null }).eq('episode_id', ep.id).eq('platform', platform).eq('status', 'draft').eq('method', 'upload');
  }
}
console.log(`Trend board: ${sources} new sources.`);

// Episodes replaced by a new package keep their history but leave the slate: retitled, sorted last, unposted drafts removed.
for (const code of S.retire_episodes ?? []) {
  const { data: old } = await db.from('studio_episodes').select('id, title').eq('code', code).maybeSingle();
  if (!old) continue;
  await db.from('studio_episodes').update({ title: old.title.startsWith('[Retired] ') ? old.title : `[Retired] ${old.title}`, sort: 99 }).eq('id', old.id);
  await db.from('studio_posts').delete().eq('episode_id', old.id).eq('status', 'draft');
}
// Fork episodes point at their source; sources follow their (new) episode.
for (const e of S.episodes) {
  if (!e.source) continue;
  const { data: src } = await db.from('studio_sources').select('id').eq('url', e.source).maybeSingle();
  if (!src) continue;
  const { data: ep } = await db.from('studio_episodes').select('id').eq('code', e.code).single();
  await db.from('studio_episodes').update({ source_id: src.id }).eq('id', ep.id);
  await db.from('studio_sources').update({ episode_id: ep.id }).eq('id', src.id);
}
console.log('Fork sources linked; retired episodes tidied.');
