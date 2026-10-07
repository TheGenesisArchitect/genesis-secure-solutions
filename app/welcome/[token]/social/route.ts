import { findClientAnyByToken } from '@/lib/clients';
import { PAGE_HEADERS, renderSocialPage } from '@/lib/social-page';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const client = await findClientAnyByToken((await ctx.params).token);
  if (!client) return new Response('<!doctype html><meta charset="utf-8"><title>Not found</title><p>This link is not valid.</p>', { status: 404, headers: PAGE_HEADERS });
  return new Response(renderSocialPage(client, 'client'), { headers: PAGE_HEADERS });
}
