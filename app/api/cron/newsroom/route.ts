// The newsroom's morning, on its own: at 10:00 UTC (5:00 ET) the free wire reads every beat's public feeds; at 11:00 UTC
// (6:00 ET) Helix writes the day's brief (lib/newsroom-morning.ts). ?step=sweep|brief picks the half; the two Vercel
// crons call it with each.
import { after } from 'next/server';
import { cronAuthorized } from '@/lib/cron';
import { allDesks } from '@/lib/desk';
import { queueBriefNotices, writeBrief } from '@/lib/newsroom-morning';
import { sweepFree } from '@/lib/newsroom-feed';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response('Unauthorized', { status: 401 });
  const step = new URL(req.url).searchParams.get('step');
  // Every desk (lib/desk.ts): the Genovus desk and each agency's, each in its own background task.
  const desks = await allDesks();
  // The free wire: public feeds, no paid search (lib/newsroom-feed.ts).
  if (step === 'sweep') {
    for (const d of desks) after(async () => { const r = await sweepFree(d.id).catch((e) => { console.error(`[newsroom] ${d.slug} free wire: ${e instanceof Error ? e.message : e}`); return null; }); if (r) console.info(`[newsroom] ${d.slug} free wire: ${r.added} stories across ${r.beats} beats ${JSON.stringify(r.byBeat)}`); });
    return Response.json({ ok: true, started: desks.map((d) => d.slug) });
  }
  if (step === 'brief') {
    for (const d of desks) after(async () => { const b = await writeBrief(d.id).catch((e) => { console.error(`[newsroom] ${d.slug} brief: ${e instanceof Error ? e.message : e}`); return null; }); console.info(`[newsroom] ${d.slug} brief: ${b ? `${b.hot.length} hot topics` : 'none'}`);
      // An agency's brief also goes to its host at 7 AM (email and alert), once the operator has turned it on.
      if (b && !d.house) { const n = await queueBriefNotices(d.id, b).catch((e) => { console.error(`[newsroom] ${d.slug} brief notices: ${e instanceof Error ? e.message : e}`); return 0; }); if (n) console.info(`[newsroom] ${d.slug} brief notices queued: ${n}`); }
    });
    return Response.json({ ok: true, started: desks.map((d) => d.slug) });
  }
  return Response.json({ ok: false, error: 'step=sweep or step=brief' }, { status: 400 });
}
