// Episode Pro's part worker: renders one part of the polished episode (lib/unedit.ts renderEpisodePart) in the
// background. Kicked with the cron secret by the recording's step, several at once; the part's own lease makes a
// double kick harmless, and the last part to finish kicks the step that joins the episode.
import { after } from 'next/server';
import { cronAuthorized } from '@/lib/cron';
import { renderEpisodePart } from '@/lib/unedit';

export const dynamic = 'force-dynamic';
export const maxDuration = 800;

export async function POST(req: Request, ctx: { params: Promise<{ id: string; k: string }> }) {
  if (!cronAuthorized(req)) return new Response('Unauthorized', { status: 401 });
  const { id, k } = await ctx.params;
  const n = Number(k);
  if (!/^[0-9a-f-]{36}$/.test(id) || !Number.isInteger(n) || n < 0 || n > 999) return Response.json({ ok: false, error: 'bad part' }, { status: 400 });
  const origin = new URL(req.url).origin;
  after(async () => { console.info(`[unedit] ${id} ${await renderEpisodePart(id, n, origin)}`); });
  return Response.json({ ok: true, started: true }, { status: 202 });
}
