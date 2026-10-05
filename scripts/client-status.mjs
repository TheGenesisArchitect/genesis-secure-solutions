// Read-only: prints a client's welcome checklist and social walkthrough progress from private Blob storage.
// Usage: node --env-file=.env.local scripts/client-status.mjs mendez-hollis
// Never prints the client's token; storage keys use a hash of it.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { get } from '@vercel/blob';

const slug = process.argv[2];
if (!slug || !/^[a-z0-9-]+$/.test(slug)) throw new Error('Pass a client slug, e.g. mendez-hollis');
if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('BLOB_READ_WRITE_TOKEN is not set; run with --env-file=.env.local');
const client = JSON.parse(fs.readFileSync(`data/clients/${slug}.json`, 'utf8'));
const hash = createHash('sha256').update(client.token).digest('hex').slice(0, 16);

async function read(key) {
  const res = await get(key, { access: 'private', useCache: false });
  if (!res || res.statusCode !== 200) return null;
  return JSON.parse(await new Response(res.stream).text());
}

const welcome = await read(`progress/${client.slug}-${hash}.json`);
const social = await read(`progress/social-${client.slug}-${hash}.json`);
console.log(JSON.stringify({ client: client.fullName, welcome: welcome ?? 'nothing saved yet', social: social ?? 'nothing saved yet' }, null, 2));
