import { pitchTokenOk, renderPitchPage } from '@/lib/pitch-page';

export const dynamic = 'force-dynamic';
const HEADERS = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };

/** The Genovus pitch storyboard. Only the shared link's token opens it. */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  if (!pitchTokenOk((await ctx.params).token)) return new Response('<!doctype html><meta charset="utf-8"><title>Not found</title><p>This link is not valid.</p>', { status: 404, headers: HEADERS });
  return new Response(renderPitchPage(), { headers: HEADERS });
}
