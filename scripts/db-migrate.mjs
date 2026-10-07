// Apply supabase/migrations/*.sql in order, once each, inside a transaction per file.
// Usage: node --env-file=.env.local scripts/db-migrate.mjs   (uses the integration's direct, non-pooled URL)
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

const url = process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL;
if (!url) throw new Error('No database URL: run `vercel env pull .env.local` after connecting Supabase');
const sql = postgres(url, { ssl: 'require', max: 1, onnotice: () => {} });
const dir = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'supabase', 'migrations');

try {
  await sql`create schema if not exists ops`;
  await sql`create table if not exists ops.migrations (name text primary key, applied_at timestamptz not null default now())`;
  const done = new Set((await sql`select name from ops.migrations`).map((r) => r.name));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (done.has(f)) { console.log(`skip  ${f}`); continue; }
    const body = fs.readFileSync(path.join(dir, f), 'utf8');
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into ops.migrations (name) values (${f})`;
    });
    console.log(`apply ${f}`);
  }
} finally {
  await sql.end();
}
