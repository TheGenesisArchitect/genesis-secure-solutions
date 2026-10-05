import { findClientByToken } from '@/lib/clients';
import { fail, handleGet, handlePost } from '@/lib/social-api';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const client = findClientByToken((await ctx.params).token);
  return client ? handleGet(req, client, 'client') : fail('Not found', 404);
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const client = findClientByToken((await ctx.params).token);
  return client ? handlePost(req, client, 'client') : fail('Not found', 404);
}
