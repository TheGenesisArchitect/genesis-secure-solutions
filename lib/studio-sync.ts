// Studio content as code: data/studio-season1.json (the series, episodes, shots, posts, trend sources) is synced
// into the database by the per-minute Studio cron whenever the file changes, so a release carries its episodes to
// production with no manual step. The local script (scripts/seed-studio.mjs) runs the same sync.
// Safe to re-run: content is refreshed, but shot progress, render links, approvals, shot logs edited in the Studio
// and posts already edited or published are never overwritten.
// No path aliases or server-only imports here: plain Node imports this file too (type stripping).
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { compileVideo, type CastMember } from './studio-direct.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Season = any;

const KEY = 'studio_sync_hash';
/** Bump when the sync logic itself changes, so production re-syncs even if the data file didn't. */
const SYNC_VERSION = 2;

export const seasonHash = (season: Season, cast: CastMember[] = []) => createHash('sha256').update(`${SYNC_VERSION}:${JSON.stringify(season)}:${JSON.stringify(cast.map((c) => (c as { performance_dna?: unknown }).performance_dna ?? null))}`).digest('hex').slice(0, 16);

/** Sync only when the data (or the sync logic) changed since the last run. Cheap when nothing did: one row read. */
export async function syncStudioIfChanged(db: SupabaseClient, season: Season, cast: CastMember[] = []): Promise<{ synced: boolean; hash: string; summary?: string }> {
  const hash = seasonHash(season, cast);
  const { data } = await db.from('app_settings').select('value').eq('key', KEY).maybeSingle();
  if (data?.value === hash) return { synced: false, hash };
  const summary = await syncStudio(db, season, cast);
  await db.from('app_settings').upsert({ key: KEY, value: hash, updated_at: new Date().toISOString() });
  return { synced: true, hash, summary };
}

/** `cast`: the characters with their Performance DNA (data/studio-cast.json), for compiling Shot Contracts. */
export async function syncStudio(db: SupabaseClient, S: Season, cast: CastMember[] = []): Promise<string> {
  const must = <T>(r: { data: T; error: { message: string } | null }, what: string): T => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data; };

  const c = S.campaign;
  must(await db.from('campaigns').upsert({ slug: c.slug, name: c.name, channel: 'social', segment: 'mixed', starts_on: c.starts_on, ends_on: c.ends_on, notes: 'Studio Season 1 soft launch: Facebook, Instagram, TikTok, YouTube Shorts. Organic only. Links carry src per platform.' }, { onConflict: 'slug', ignoreDuplicates: true }), 'campaign');

  const s = S.series;
  // Keep the Cast Character Bible (loaded by seed-cast.mjs) when refreshing the series bible.
  const { data: existing } = await db.from('studio_series').select('bible').eq('slug', s.slug).maybeSingle();
  const castBible = (existing?.bible as { cast_bible?: unknown } | null)?.cast_bible;
  const series = must(await db.from('studio_series').upsert({ slug: s.slug, name: s.name, division: s.division, logline: s.logline, bible: { ...s.bible, ...(castBible ? { cast_bible: castBible } : {}) } }, { onConflict: 'slug' }).select('id').single(), 'series') as { id: string };

  let shots = 0, posts = 0;
  for (const e of S.episodes) {
    const ep = must(await db.from('studio_episodes').upsert({ series_id: series.id, code: e.code, kind: e.kind, title: e.title, runtime_s: e.runtime_s, logline: e.logline, script: e.script, music: e.music, sort: e.sort, thumb_prompt: e.thumb ?? null, format: e.format ?? 'original', fork_mode: e.fork_mode ?? null, target_s: e.target_s ?? null, cut_family: e.cut_family ?? null, seat_map: e.seat_map ?? null }, { onConflict: 'code' }).select('id').single(), `episode ${e.code}`) as { id: string };
    for (const sh of e.shots) {
      // A shot with a Shot Contract gets its prompt compiled (Director OS); the frame shape comes from its own prompt.
      const aspect = /\bwidescreen 16:9\b/i.test(sh.prompt ?? '') ? '16:9' : '9:16';
      const prompt = sh.contract && S.series.genome ? compileVideo(sh.contract, S.series.genome, cast, aspect) : sh.prompt ?? null;
      const dialogue = sh.dialogue ?? (sh.lines?.length ? sh.lines.map((l: { who: string; text: string }) => `${l.who.replace(/\d+$/, '')}: ${l.text}`).join(' / ') : null);
      const saved = must(await db.from('studio_shots').upsert({ episode_id: ep.id, n: sh.n, timing: sh.timing ?? null, description: sh.description, camera: sh.camera ?? sh.log?.camera ?? null, dialogue, prompt, tool: sh.tool, contract: sh.contract ?? {}, tier: sh.tier ?? 'production',
        shot_code: sh.shot_code ?? null, beat: sh.beat ?? null, shot_kind: sh.shot_kind ?? null, cast_codes: sh.cast_codes ?? [], lines: sh.lines ?? [] }, { onConflict: 'episode_id,n' }).select('id').single(), `shot ${e.code}/${sh.n}`) as { id: string };
      // The shot log is a working record: only filled when still empty, so edits made in the Studio survive a reload.
      if (sh.log) await db.from('studio_shots').update({ log: sh.log }).eq('id', saved.id).eq('log', '{}');
      shots++;
    }
    const p = S.posts?.[e.code];
    for (const platform of ['facebook', 'instagram', 'tiktok', 'youtube']) {
      if (!p?.[platform]) continue;
      const link = S.link.replace('{src}', S.src[platform]);
      must(await db.from('studio_posts').upsert({ episode_id: ep.id, platform, caption: p[platform].caption.replaceAll('{link}', link), title: p[platform].title ?? null, link, scheduled_for: p.when }, { onConflict: 'episode_id,platform', ignoreDuplicates: true }), `post ${e.code}/${platform}`);
      posts++;
    }
  }

  // Trend board sources (added once, matched by link) and how specific posts go out (only while still drafts).
  let sources = 0;
  for (const src of S.sources ?? []) {
    const { data: have } = await db.from('studio_sources').select('id').eq('url', src.url).maybeSingle();
    if (have) continue;
    const ep = src.episode ? must(await db.from('studio_episodes').select('id').eq('code', src.episode).single(), 'source episode') as { id: string } : null;
    must(await db.from('studio_sources').insert({ series_id: series.id, episode_id: ep?.id ?? null, url: src.url, platform: src.platform, creator: src.creator || null, title: src.title, route: src.route, notes: src.notes ?? null }), `source ${src.title}`);
    sources++;
  }
  for (const [code, byPlatform] of Object.entries(S.post_methods ?? {}) as [string, Record<string, { method: string; source: string }>][]) {
    const ep = must(await db.from('studio_episodes').select('id').eq('code', code).single(), 'episode') as { id: string };
    for (const [platform, m] of Object.entries(byPlatform)) {
      const { data: src } = await db.from('studio_sources').select('id').eq('url', m.source).maybeSingle();
      await db.from('studio_posts').update({ method: m.method, source_id: src?.id ?? null }).eq('episode_id', ep.id).eq('platform', platform).eq('status', 'draft').eq('method', 'upload');
    }
  }

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
    if (!ep) continue;
    await db.from('studio_episodes').update({ source_id: src.id }).eq('id', ep.id);
    if (e.kind === 'episode') await db.from('studio_sources').update({ episode_id: ep.id }).eq('id', src.id);
  }
  return `${S.episodes.length} episodes, ${shots} shots, ${posts} posts, ${sources} new trend sources`;
}
