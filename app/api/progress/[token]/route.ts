import { findClientAnyByToken, hasWelcome } from '@/lib/clients';
import { parseProgress, readProgress, storageConfigured, writeProgress } from '@/lib/progress';

export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const notFound = () => Response.json({ error: 'Not found' }, { status: 404, headers: HEADERS });

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const client = await findClientAnyByToken((await ctx.params).token);
  if (!hasWelcome(client)) return notFound();
  if (!storageConfigured()) return Response.json({ error: 'Progress storage is not connected yet.' }, { status: 503, headers: HEADERS });
  try {
    return Response.json(await readProgress(client), { headers: HEADERS });
  } catch {
    return Response.json({ error: 'Could not load progress.' }, { status: 502, headers: HEADERS });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const client = await findClientAnyByToken((await ctx.params).token);
  if (!hasWelcome(client)) return notFound();
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) return Response.json({ error: 'Request not permitted.' }, { status: 403, headers: HEADERS });
  if (Number(req.headers.get('content-length') || 0) > 2000) return Response.json({ error: 'Too large.' }, { status: 413, headers: HEADERS });
  if (!storageConfigured()) return Response.json({ error: 'Progress storage is not connected yet.' }, { status: 503, headers: HEADERS });
  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > 2000) return Response.json({ error: 'Too large.' }, { status: 413, headers: HEADERS });
    raw = JSON.parse(text);
  } catch {
    return Response.json({ error: 'Invalid request.' }, { status: 400, headers: HEADERS });
  }
  const parsed = parseProgress(raw);
  if (!parsed) return Response.json({ error: 'Invalid progress.' }, { status: 400, headers: HEADERS });
  try {
    return Response.json(await writeProgress(client, parsed), { headers: HEADERS });
  } catch {
    return Response.json({ error: 'Could not save progress.' }, { status: 502, headers: HEADERS });
  }
}
