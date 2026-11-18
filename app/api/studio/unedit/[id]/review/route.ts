// Review copies worker (lib/unedit-review.ts): makes the light 1080p copies the card plays, in the background.
// Kicked with the cron secret by the Studio cron for recordings whose card still plays a heavy master.
import { after } from 'next/server';
import { cronAuthorized } from '@/lib/cron';
import { ensureReview } from '@/lib/unedit-review';

export const dynamic = 'force-dynamic';
export const maxDuration = 800;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!cronAuthorized(req)) return new Response('Unauthorized', { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return Response.json({ ok: false, error: 'bad id' }, { status: 400 });
  const deadline = Date.now() + 780_000;
  after(async () => { console.info(`[unedit] ${id} ${await ensureReview(id, deadline).catch((e) => `review copies failed: ${e instanceof Error ? e.message : e}`)}`); });
  return Response.json({ ok: true, started: true }, { status: 202 });
}
