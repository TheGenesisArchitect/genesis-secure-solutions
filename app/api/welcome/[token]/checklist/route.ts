// The client's checklist saves here from their welcome link (lib/client-checklist.ts): same site only, the link's
// own client only, text fields from the checklist's allowlist, photos as images up to 8 MB.
import { saveChecklist } from '@/lib/client-checklist';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) return Response.json({ ok: false, error: 'Not allowed.' }, { status: 403 });
  if (Number(req.headers.get('content-length') ?? 0) > 18 * 1024 * 1024) return Response.json({ ok: false, error: 'That’s too large. Photos up to 8 MB each.' }, { status: 413 });
  const form = await req.formData().catch(() => null);
  if (!form) return Response.json({ ok: false, error: 'Nothing was sent.' }, { status: 400 });
  const r = await saveChecklist((await ctx.params).token, form);
  return Response.json(r, { status: r.ok ? 200 : 400, headers: { 'Cache-Control': 'no-store' } });
}
