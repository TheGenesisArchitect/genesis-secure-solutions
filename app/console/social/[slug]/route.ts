import { findClientAnyBySlug } from '@/lib/clients';
import { consoleAuth } from '@/lib/console-auth';
import { PAGE_HEADERS, renderSocialPage } from '@/lib/social-page';

export const dynamic = 'force-dynamic';

/** Operator view of a client's social setup: same wizard, plus talk track, presence controls and notes. */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const denied = consoleAuth(req);
  if (denied) return denied;
  const client = await findClientAnyBySlug((await ctx.params).slug);
  if (!client) return new Response('Not found', { status: 404, headers: PAGE_HEADERS });
  return new Response(renderSocialPage(client, 'operator'), { headers: PAGE_HEADERS });
}
