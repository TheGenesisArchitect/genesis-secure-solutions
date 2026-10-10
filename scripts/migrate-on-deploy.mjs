// Database migrations ship with the release: Vercel runs this before `next build` (the vercel-build script). On a
// Vercel production or preview build with a database URL it applies supabase/migrations/*.sql through
// db-migrate.mjs (each file once, each in its own transaction). A failing migration fails the build, so the live
// version keeps serving and nothing half-applies. Anywhere else (local builds, CI) it does nothing.
import { spawnSync } from 'node:child_process';

const env = process.env.VERCEL_ENV;
const url = process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL;
if (!['production', 'preview'].includes(env ?? '') || !url) {
  console.log(`[migrate-on-deploy] skipped (${env ? `${env}, ${url ? 'url set' : 'no database url'}` : 'not a Vercel build'})`);
  process.exit(0);
}
console.log(`[migrate-on-deploy] ${env}: applying pending migrations`);
const r = spawnSync(process.execPath, ['scripts/db-migrate.mjs'], { stdio: 'inherit' });
process.exit(r.status ?? 1);
