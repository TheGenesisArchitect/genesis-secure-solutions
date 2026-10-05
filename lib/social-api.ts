// Request handling shared by the client API (token in the URL) and the console API (operator sign-in).
import type { Client } from './clients';
import { storageConfigured } from './progress';
import { MAX_BODY, applyOp, parseOp, readOperator, readPresence, readSession, summary, type Role } from './social-session';
import { setupFor } from './social-setup';

const HEADERS = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
export const fail = (error: string, status: number) => Response.json({ error }, { status, headers: HEADERS });

/** The client gets the shared session and where the operator is. Only the operator gets notes and our-side ticks. */
async function state(c: Client, role: Role) {
  const setup = setupFor(c);
  const peerRole: Role = role === 'client' ? 'operator' : 'client';
  const [session, peer, operator] = await Promise.all([
    readSession(c, setup),
    readPresence(c, peerRole, setup),
    role === 'operator' ? readOperator(c, setup) : Promise.resolve(undefined),
  ]);
  return { progress: session, steps: summary(session, setup.plan), peer, ...(operator ? { operator } : {}) };
}

export async function handleGet(c: Client, role: Role): Promise<Response> {
  if (!storageConfigured()) return fail('Progress storage is not connected yet.', 503);
  try {
    return Response.json(await state(c, role), { headers: HEADERS });
  } catch {
    return fail('Could not load progress.', 502);
  }
}

export async function handlePost(req: Request, c: Client, role: Role): Promise<Response> {
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) return fail('Request not permitted.', 403);
  if (Number(req.headers.get('content-length') || 0) > MAX_BODY) return fail('Too large.', 413);
  if (!storageConfigured()) return fail('Progress storage is not connected yet.', 503);
  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY) return fail('Too large.', 413);
    raw = JSON.parse(text);
  } catch {
    return fail('Invalid request.', 400);
  }
  const setup = setupFor(c);
  const op = parseOp(raw, role, setup);
  if (!op) return fail('Invalid change.', 400);
  try {
    await applyOp(c, role, op, setup);
    return Response.json(await state(c, role), { headers: HEADERS });
  } catch {
    return fail('Could not save just now.', 503);
  }
}
