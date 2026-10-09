// Loads the GENOVUS Cast Character Bible (data/studio-cast.json) into the Studio: the bible text on the series,
// the character records (Maya, Trent, Bri), their Episode 001 looks, and retires the earlier cast's reference
// sheets so they never feed a shot again. Safe to re-run; never touches generated or approved identity images.
//   node --env-file=<env file> scripts/seed-cast.mjs
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const C = JSON.parse(fs.readFileSync(new URL('../data/studio-cast.json', import.meta.url), 'utf8'));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data; };

const series = must(await db.from('studio_series').select('id, bible').eq('slug', 'genovus-just-knows').single(), 'series');
must(await db.from('studio_series').update({ bible: { ...(series.bible ?? {}), cast_bible: C.bible } }).eq('id', series.id), 'bible');

const byCode = {};
for (const c of C.characters) {
  const row = must(await db.from('studio_characters').upsert({
    series_id: series.id, code: c.code, name: c.name, archetype: c.archetype, age: c.age, role: c.role, sort: c.sort,
    profile: { ...c.profile, signature_slot: c.signature_slot }, identity_prompt: c.identity_prompt, visual_anchors: c.visual_anchors,
    wardrobe: c.wardrobe, voice: c.voice, status: 'active',
  }, { onConflict: 'code' }).select('id').single(), c.code);
  byCode[c.code] = row.id;
}
for (const l of C.looks) {
  const ep = l.episode ? must(await db.from('studio_episodes').select('id').eq('code', l.episode).maybeSingle(), 'episode') : null;
  must(await db.from('studio_looks').upsert({ code: l.code, character_id: byCode[l.character], episode_id: ep?.id ?? null, description: l.description, prop_hand: l.prop_hand ?? null, phone_case: l.phone_case ?? null }, { onConflict: 'code' }), l.code);
}
// The earlier cast (Dee, Marcus, Tasha, Velvet) is retired: their sheets stay as history but never feed a shot.
const { data: retired } = await db.from('studio_refs').update({ canonical: false }).in('character', C.retire).is('character_id', null).select('id');
console.log(`Cast bible v${C.bible.version} loaded: ${C.characters.length} characters, ${C.looks.length} looks; ${retired?.length ?? 0} earlier sheets retired.`);
