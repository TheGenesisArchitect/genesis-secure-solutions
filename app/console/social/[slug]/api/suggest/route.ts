import { findClientBySlug } from '@/lib/clients';
import { consoleAuth } from '@/lib/console-auth';
import { fail, handleSuggest } from '@/lib/social-api';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const denied = consoleAuth(req);
  if (denied) return denied;
  const client = findClientBySlug((await ctx.params).slug);
  return client ? handleSuggest(req, client) : fail('Not found', 404);
}
