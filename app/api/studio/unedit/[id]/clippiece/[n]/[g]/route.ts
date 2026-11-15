// A clip group worker: renders one ~8 s group of a long 8K clip (lib/unedit.ts renderClipGroup) in the background and
// stores it; the recording's step joins the groups once all are stored. Kicked with the cron secret by that step.
import { after } from 'next/server';
import { cronAuthorized } from '@/lib/cron';
import { renderClipGroup } from '@/lib/unedit';

export const dynamic = 'force-dynamic';
export const maxDuration = 800;

export async function POST(req: Request, ctx: { params: Promise<{ id: string; n: string; g: string }> }) {
  if (!cronAuthorized(req)) return new Response('Unauthorized', { status: 401 });
  const { id, n, g } = await ctx.params;
  const [cn, cg] = [Number(n), Number(g)];
  if (!/^[0-9a-f-]{36}$/.test(id) || !Number.isInteger(cn) || !Number.isInteger(cg) || cn < 1 || cn > 99 || cg < 0 || cg > 99) return Response.json({ ok: false, error: 'bad group' }, { status: 400 });
  after(async () => {
    const said = await renderClipGroup(id, cn, cg).catch((e) => `clip ${cn} group ${cg + 1} failed: ${e instanceof Error ? e.message : e}`);
    console.info(`[unedit] ${id} ${said}`);
  });
  return Response.json({ ok: true, started: true }, { status: 202 });
}
