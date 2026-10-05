// Request handling shared by the client API (token in the URL) and the console API (operator sign-in).
// Every Blob read and write is a billed operation, so a GET is one read of the session file, the operator's
// notes are read only when the console asks for them (?full=1), and a POST answers with what it wrote.
import type { Client } from './clients';
import { storageConfigured } from './progress';
import { MAX_BODY, applyOp, parseOp, readOperator, readSession, summary, type OperatorData, type Role, type Session } from './social-session';
import { setupFor } from './social-setup';

const HEADERS = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
export const fail = (error: string, status: number) => Response.json({ error }, { status, headers: HEADERS });

/** The client never receives operator data; presence is split out so each side sees only the other person. */
function body(c: Client, role: Role, session: Session | undefined, operator?: OperatorData) {
  const setup = setupFor(c);
  const out: Record<string, unknown> = {};
  if (session) {
    const { presence, ...progress } = session;
    out.progress = progress;
    out.steps = summary(session, setup.plan);
    out.peer = presence[role === 'client' ? 'operator' : 'client'];
  }
  if (operator && role === 'operator') out.operator = operator;
  return out;
}

export async function handleGet(req: Request, c: Client, role: Role): Promise<Response> {
  if (!storageConfigured()) return fail('Progress storage is not connected yet.', 503);
  const setup = setupFor(c);
  const full = role === 'operator' && new URL(req.url).searchParams.get('full') === '1';
  try {
    const [session, operator] = await Promise.all([readSession(c, setup), full ? readOperator(c, setup) : Promise.resolve(undefined)]);
    return Response.json(body(c, role, session, operator), { headers: HEADERS });
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
    const written = await applyOp(c, role, op, setup);
    return Response.json(body(c, role, written.session, written.operator), { headers: HEADERS });
  } catch {
    return fail('Could not save just now.', 503);
  }
}
