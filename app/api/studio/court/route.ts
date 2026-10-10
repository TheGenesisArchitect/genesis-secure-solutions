// Send one take to the SWIS™ Creative Court now (staff only), e.g. after its shot's contract changed.
import { getViewer } from '@/lib/session';
import { generationConfigured } from '@/lib/studio-gen';
import { scoreTake } from '@/lib/studio-court';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: Request) {
  const viewer = await getViewer().catch(() => null);
  if (!viewer?.staff) return Response.json({ error: 'Staff only.' }, { status: 403 });
  if (!generationConfigured()) return Response.json({ error: 'The Court isn’t connected here (no Gemini key).' }, { status: 503 });
  const b = (await req.json().catch(() => ({}))) as { take?: string };
  if (typeof b.take !== 'string' || !/^[0-9a-f-]{36}$/.test(b.take)) return Response.json({ error: 'Unknown take.' }, { status: 400 });
  const r = await scoreTake(b.take);
  return Response.json(r, { status: r.ok ? 200 : 502 });
}
