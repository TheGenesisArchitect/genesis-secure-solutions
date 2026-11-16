// One beat's morning sweep (lib/newsroom-morning.ts), kicked by the morning cron with the cron secret, one per beat.
import { after } from 'next/server';
import { cronAuthorized } from '@/lib/cron';
import { sweepBeat } from '@/lib/newsroom-morning';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!cronAuthorized(req)) return new Response('Unauthorized', { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { tenant?: string; beat?: string };
  if (!b.tenant || !/^[0-9a-f-]{36}$/.test(b.tenant) || !b.beat || !/^[a-z0-9_-]{1,40}$/.test(b.beat)) return Response.json({ ok: false, error: 'bad request' }, { status: 400 });
  after(async () => { console.info(`[newsroom] morning ${await sweepBeat(b.tenant!, b.beat!).catch((e) => `${b.beat} failed: ${e instanceof Error ? e.message : e}`)}`); });
  return Response.json({ ok: true, started: true }, { status: 202 });
}
