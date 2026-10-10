// Loads Genovus Studio content (data/studio-season1.json) into a database now. Production and preview do this by
// themselves: the per-minute Studio cron syncs whenever the file changes (lib/studio-sync.ts, the same code).
// Use this for a local database or to sync immediately.
//   node --env-file=<env file> scripts/seed-studio.mjs
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { syncStudio, seasonHash } from '../lib/studio-sync.ts';

const S = JSON.parse(fs.readFileSync(new URL('../data/studio-season1.json', import.meta.url), 'utf8'));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
console.log(`Studio synced: ${await syncStudio(db, S)}.`);
await db.from('app_settings').upsert({ key: 'studio_sync_hash', value: seasonHash(S), updated_at: new Date().toISOString() });
process.exit(0);
