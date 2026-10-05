// Read-only: prints a client's welcome checklist, social wizard session, who is where, and operator notes.
// Usage: node --env-file=.env.local scripts/client-status.mjs mendez-hollis
// Never prints the client's token; storage keys use a hash of it.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { get } from '@vercel/blob';

const slug = process.argv[2];
if (!slug || !/^[a-z0-9-]+$/.test(slug)) throw new Error('Pass a client slug, e.g. mendez-hollis');
if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('BLOB_READ_WRITE_TOKEN is not set; run with --env-file=.env.local');
const client = JSON.parse(fs.readFileSync(`data/clients/${slug}.json`, 'utf8'));
const h = createHash('sha256').update(client.token).digest('hex').slice(0, 16);

async function read(key) {
  const res = await get(key, { access: 'private', useCache: false });
  if (!res || res.statusCode !== 200) return 'nothing saved yet';
  return JSON.parse(await new Response(res.stream).text());
}

console.log(
  JSON.stringify(
    {
      client: client.fullName,
      welcome: await read(`progress/${client.slug}-${h}.json`),
      social: await read(`progress/social-${client.slug}-${h}.json`),
      presence: {
        client: await read(`progress/social-presence-client-${client.slug}-${h}.json`),
        operator: await read(`progress/social-presence-operator-${client.slug}-${h}.json`),
      },
      operatorNotes: await read(`progress/social-operator-${client.slug}-${h}.json`),
    },
    null,
    2,
  ),
);
