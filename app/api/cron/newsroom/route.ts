// The newsroom's morning, on its own: at 10:00 UTC (5:00 ET) the free wire reads every beat's public feeds; at 11:00 UTC
// (6:00 ET) Helix writes the day's brief (lib/newsroom-morning.ts). ?step=sweep|brief picks the half; the two Vercel
// crons call it with each.
import { after } from 'next/server';
import { cronAuthorized } from '@/lib/cron';
import { genovusTenant } from '@/lib/unedit';
import { writeBrief } from '@/lib/newsroom-morning';
import { sweepFree } from '@/lib/newsroom-feed';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response('Unauthorized', { status: 401 });
  const step = new URL(req.url).searchParams.get('step');
  const tenant = await genovusTenant();
  // The free wire: public feeds, no paid search (lib/newsroom-feed.ts).
  if (step === 'sweep') { const r = await sweepFree(tenant); console.info(`[newsroom] free wire: ${r.added} stories across ${r.beats} beats ${JSON.stringify(r.byBeat)}`); return Response.json({ ok: true, ...r }); }
  if (step === 'brief') {
    after(async () => { const b = await writeBrief(tenant).catch((e) => { console.error(`[newsroom] brief: ${e instanceof Error ? e.message : e}`); return null; }); console.info(`[newsroom] brief: ${b ? `${b.hot.length} hot topics` : 'none'}`); });
    return Response.json({ ok: true, started: true });
  }
  return Response.json({ ok: false, error: 'step=sweep or step=brief' }, { status: 400 });
}
