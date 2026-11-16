// The newsroom's morning, on its own: at 10:00 UTC (5:00 ET) every beat is researched in its own worker; at 11:00 UTC
// (6:00 ET) Helix writes the day's brief (lib/newsroom-morning.ts). ?step=sweep|brief picks the half; the two Vercel
// crons call it with each.
import { after } from 'next/server';
import { cronAuthorized } from '@/lib/cron';
import { genovusTenant } from '@/lib/unedit';
import { startMorning, writeBrief } from '@/lib/newsroom-morning';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response('Unauthorized', { status: 401 });
  const step = new URL(req.url).searchParams.get('step');
  const tenant = await genovusTenant();
  if (step === 'sweep') { const n = await startMorning(tenant); return Response.json({ ok: true, beats: n }); }
  if (step === 'brief') {
    after(async () => { const b = await writeBrief(tenant).catch((e) => { console.error(`[newsroom] brief: ${e instanceof Error ? e.message : e}`); return null; }); console.info(`[newsroom] brief: ${b ? `${b.hot.length} hot topics` : 'none'}`); });
    return Response.json({ ok: true, started: true });
  }
  return Response.json({ ok: false, error: 'step=sweep or step=brief' }, { status: 400 });
}
