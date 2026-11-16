// A recording's thumbnail for outside services (Metricool hands it to YouTube): HEAD and GET, by a signed, expiring
// link (lib/unedit-share.ts). Nothing else is served.
import { presigned } from '@/lib/unedit-media';
import { readThumbLink } from '@/lib/unedit-share';

export const dynamic = 'force-dynamic';

async function serve(token: string, head: boolean): Promise<Response> {
  const path = readThumbLink(token);
  if (!path) return new Response('Not found', { status: 404 });
  const r = await fetch(await presigned(path, 5), { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) return new Response('Not found', { status: 404 });
  const bytes = Buffer.from(await r.arrayBuffer());
  const headers = { 'content-type': path.endsWith('.png') ? 'image/png' : 'image/jpeg', 'content-length': String(bytes.length), 'cache-control': 'public, max-age=3600' };
  return new Response(head ? null : new Uint8Array(bytes), { status: 200, headers });
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) { return serve((await ctx.params).token, false); }
export async function HEAD(_req: Request, ctx: { params: Promise<{ token: string }> }) { return serve((await ctx.params).token, true); }
