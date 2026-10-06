// Meta data deletion callback. Meta posts a signed_request when someone removes the app and asks for their data
// to be deleted; we answer with a status URL and a confirmation code, as Meta requires.
import { randomBytes } from 'node:crypto';
import { put } from '@vercel/blob';
import { metaConfig, parseSignedRequest } from '@/lib/meta';
import { storageConfigured } from '@/lib/progress';

export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };

export async function POST(req: Request) {
  const cfg = metaConfig();
  if (!cfg.appSecret) return Response.json({ error: 'Not set up yet.' }, { status: 503, headers: HEADERS });
  if (Number(req.headers.get('content-length') || 0) > 8000) return Response.json({ error: 'Too large.' }, { status: 413, headers: HEADERS });
  let signed = '';
  try {
    const text = await req.text();
    if (text.length > 8000) return Response.json({ error: 'Too large.' }, { status: 413, headers: HEADERS });
    signed = new URLSearchParams(text).get('signed_request') || '';
  } catch {
    return Response.json({ error: 'Invalid request.' }, { status: 400, headers: HEADERS });
  }
  const payload = parseSignedRequest(signed, cfg.appSecret);
  if (!payload) return Response.json({ error: 'Invalid signed request.' }, { status: 403, headers: HEADERS });
  const code = randomBytes(8).toString('hex');
  if (!storageConfigured()) return Response.json({ error: 'Storage is not connected.' }, { status: 503, headers: HEADERS });
  try {
    await put(
      `meta/deletions/${code}.json`,
      JSON.stringify({ code, userId: payload.user_id, receivedAt: new Date().toISOString(), status: 'received' }),
      { access: 'private', contentType: 'application/json', addRandomSuffix: false },
    );
  } catch {
    return Response.json({ error: 'Could not record the request.' }, { status: 503, headers: HEADERS });
  }
  const url = `${new URL(req.url).origin}/meta/deletion/${code}`;
  return Response.json({ url, confirmation_code: code }, { headers: HEADERS });
}
