// Meta webhooks: the setup handshake (GET) and signed event notifications (POST).
// Events are stored as identifiers only (object, field, ids). Lead answers and message text wait for the
// Supabase pipeline that keeps each lead's consent record (see CLAUDE.md), so nothing personal is kept here.
import { randomBytes } from 'node:crypto';
import { put } from '@vercel/blob';
import { idsOnly, metaConfig, validHubSignature, verifyTokenMatches } from '@/lib/meta';
import { storageConfigured } from '@/lib/progress';

export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const MAX_BODY = 1_000_000;

export async function GET(req: Request) {
  const cfg = metaConfig();
  if (!cfg.webhookVerifyToken) return new Response('Webhooks are not set up yet.', { status: 503, headers: HEADERS });
  const q = new URL(req.url).searchParams;
  const challenge = q.get('hub.challenge') || '';
  if (q.get('hub.mode') === 'subscribe' && verifyTokenMatches(q.get('hub.verify_token'), cfg.webhookVerifyToken) && /^[A-Za-z0-9_-]{1,200}$/.test(challenge)) {
    return new Response(challenge, { status: 200, headers: { ...HEADERS, 'Content-Type': 'text/plain' } });
  }
  return new Response('Forbidden', { status: 403, headers: HEADERS });
}

export async function POST(req: Request) {
  const cfg = metaConfig();
  if (!cfg.appSecret) return new Response('Webhooks are not set up yet.', { status: 503, headers: HEADERS });
  if (Number(req.headers.get('content-length') || 0) > MAX_BODY) return new Response('Too large', { status: 413, headers: HEADERS });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return new Response('Too large', { status: 413, headers: HEADERS });
  if (!validHubSignature(raw, req.headers.get('x-hub-signature-256'), cfg.appSecret)) return new Response('Bad signature', { status: 403, headers: HEADERS });
  let body: { object?: unknown; entry?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response('Bad payload', { status: 400, headers: HEADERS });
  }
  const entries = Array.isArray(body.entry) ? body.entry.slice(0, 1000) : [];
  const record = {
    receivedAt: new Date().toISOString(),
    object: typeof body.object === 'string' ? body.object : 'unknown',
    entries: entries.map((e: Record<string, unknown>) => ({
      id: typeof e?.id === 'string' || typeof e?.id === 'number' ? e.id : null,
      time: typeof e?.time === 'number' ? e.time : null,
      changes: Array.isArray(e?.changes)
        ? (e.changes as Record<string, unknown>[]).slice(0, 100).map((c) => ({ field: typeof c?.field === 'string' ? c.field : null, ids: idsOnly(c?.value) }))
        : [],
      messaging: Array.isArray(e?.messaging) ? (e.messaging as unknown[]).length : 0,
    })),
  };
  if (storageConfigured()) {
    const day = record.receivedAt.slice(0, 10);
    try {
      await put(`meta/events/${day}/${Date.now()}-${randomBytes(4).toString('hex')}.json`, JSON.stringify(record), {
        access: 'private',
        contentType: 'application/json',
        addRandomSuffix: false,
      });
    } catch {
      // Still acknowledge: Meta retries for 36 hours on failure, and a storage hiccup should not cause a retry storm.
    }
  }
  return new Response('OK', { status: 200, headers: HEADERS });
}
