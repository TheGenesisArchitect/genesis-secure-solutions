// Every minute: the SWIS™ autopilot advances each episode a staff member started (frames → picks → takes → the
// Court's pick), within its spending ceiling and the monthly Studio cap.
import { cronAuthorized } from '@/lib/cron';
import { generationConfigured } from '@/lib/studio-gen';
import { runAutopilot } from '@/lib/studio-autopilot';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response('Unauthorized', { status: 401 });
  if (!generationConfigured()) return Response.json({ skipped: 'no Gemini key' });
  const out = await runAutopilot();
  for (const [code, lines] of Object.entries(out)) if (lines.length) console.log(`[autopilot] ${code}: ${lines.join(' · ')}`);
  return Response.json(out);
}
