import { findClientBySlug } from '@/lib/clients';
import { consoleAuth } from '@/lib/console-auth';
import { fail, handleGet, handlePost } from '@/lib/social-api';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const denied = consoleAuth(req);
  if (denied) return denied;
  const client = findClientBySlug((await ctx.params).slug);
  return client ? handleGet(client, 'operator') : fail('Not found', 404);
}

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const denied = consoleAuth(req);
  if (denied) return denied;
  const client = findClientBySlug((await ctx.params).slug);
  return client ? handlePost(req, client, 'operator') : fail('Not found', 404);
}
