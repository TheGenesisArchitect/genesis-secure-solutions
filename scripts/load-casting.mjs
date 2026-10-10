// Loads casting reference sheets into the Studio (private storage + a CASTING reference per character), ready for
// the team to approve on the character's page. Never approves anything itself.
//   node --env-file=<env file> scripts/load-casting.mjs MAYA01=<path.png> TRENT01=<path.png> BRI01=<path.png>
import fs from 'node:fs';
import path from 'node:path';
import { put } from '@vercel/blob';
import { createClient } from '@supabase/supabase-js';

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
for (const arg of process.argv.slice(2)) {
  const i = arg.indexOf('=');
  const code = arg.slice(0, i), file = arg.slice(i + 1);
  const { data: c, error } = await db.from('studio_characters').select('id, code, name, series_id').eq('code', code).single();
  if (error || !c) throw new Error(`${code}: not found`);
  const ext = path.extname(file).toLowerCase() === '.jpg' || path.extname(file).toLowerCase() === '.jpeg' ? 'jpg' : 'png';
  const blob = await put(`studio/casting/${c.id}/${code.toLowerCase()}-casting.${ext}`, fs.readFileSync(file), { access: 'private', contentType: ext === 'jpg' ? 'image/jpeg' : 'image/png', addRandomSuffix: true });
  const { data: last } = await db.from('studio_refs').select('version').eq('character_id', c.id).eq('slot', 'CASTING').order('version', { ascending: false }).limit(1);
  const v = (last?.[0]?.version ?? 0) + 1;
  const { error: insErr } = await db.from('studio_refs').insert({
    series_id: c.series_id, character: c.name, prompt: `Casting reference sheet (${path.basename(file)})`, model: 'upload', status: 'ready', blob_path: blob.pathname,
    cost_cents: 0, character_id: c.id, ref_set: 'portrait', slot: 'CASTING', version: v, asset_code: `${c.code}_CASTING_v${String(v).padStart(2, '0')}_SHEET`,
  });
  if (insErr) throw new Error(`${code}: ${insErr.message}`);
  console.log(`${c.name}: ${c.code}_CASTING_v${String(v).padStart(2, '0')}_SHEET loaded (awaiting approval)`);
}
