// Unedit's runner: takes one recording's next step (lib/unedit.ts) in the background. Called with the cron secret by
// the Studio cron, by the upload, and after each tap or finished clip. It claims a lease first, so a double kick is
// harmless. Rendering and transcription run here (ffmpeg reads the recording from a presigned link).
import { after } from 'next/server';
import { cronAuthorized } from '@/lib/cron';
import { claim, kick, step } from '@/lib/unedit';

export const dynamic = 'force-dynamic';
export const maxDuration = 800;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!cronAuthorized(req)) return new Response('Unauthorized', { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return Response.json({ ok: false, error: 'bad id' }, { status: 400 });
  const v = await claim(id);
  if (!v) return Response.json({ ok: true, started: false });
  const origin = new URL(req.url).origin;
  // Each finished step kicks the next at once (the claim refuses when there is nothing to do or it stopped on an error).
  after(async () => { const said = await step(v, origin); console.info(`[unedit] ${id} ${v.stage}: ${said}`); await kick(origin, id); });
  return Response.json({ ok: true, started: true, stage: v.stage }, { status: 202 });
}
