import { findClientAnyByToken } from '@/lib/clients';
import { fail, handleSuggest } from '@/lib/social-api';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const client = await findClientAnyByToken((await ctx.params).token);
  return client ? handleSuggest(req, client) : fail('Not found', 404);
}
