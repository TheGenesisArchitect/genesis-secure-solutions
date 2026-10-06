// Request handling shared by the client API (token in the URL) and the console API (operator sign-in).
// Every Blob read and write is a billed operation, so a GET is one read of the session file, the operator's
// notes are read only when the console asks for them (?full=1), and a POST answers with what it wrote.
import { createHash } from 'node:crypto';
import { get, put } from '@vercel/blob';
import type { Client } from './clients';
import { aiProvider, suggestCopy } from './copy-ai';
import { COPY_KEYS, isCopyKey, type CopyKey } from './copy-rules';
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

// ---------- copy suggestions ----------

const DAILY_SUGGESTIONS = 40;

/** A rough per-client daily cap so a stuck button can't run up the AI bill. */
async function takeSuggestion(c: Client): Promise<boolean> {
  const key = `progress/social-ai-${c.slug}-${createHash('sha256').update(c.token).digest('hex').slice(0, 16)}.json`;
  const day = new Date().toISOString().slice(0, 10);
  let rec = { day, count: 0 };
  try {
    const r = await get(key, { access: 'private', useCache: false });
    if (r && r.statusCode === 200) {
      const j = JSON.parse(await new Response(r.stream).text());
      if (j && j.day === day && typeof j.count === 'number') rec = j;
    }
  } catch {}
  if (rec.count >= DAILY_SUGGESTIONS) return false;
  rec.count++;
  await put(key, JSON.stringify(rec), { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true });
  return true;
}

export async function handleSuggest(req: Request, c: Client): Promise<Response> {
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) return fail('Request not permitted.', 403);
  if (!aiProvider()) return fail('Suggestions are not set up yet.', 503);
  if (!storageConfigured()) return fail('Progress storage is not connected yet.', 503);
  let body: { key?: unknown; instruction?: unknown };
  try {
    const text = await req.text();
    if (text.length > 1000) return fail('Too large.', 413);
    body = JSON.parse(text);
  } catch {
    return fail('Invalid request.', 400);
  }
  if (!isCopyKey(body.key)) return fail('Invalid field.', 400);
  const instruction = typeof body.instruction === 'string' ? body.instruction.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200) : '';
  const setup = setupFor(c);
  const kit = setup.kit;
  if (!kit) return fail('No profile kit for this client.', 404);
  if (!(await takeSuggestion(c).catch(() => false))) return fail('Daily suggestion limit reached. Edit by hand or try tomorrow.', 429);
  const session = await readSession(c, setup);
  const effective = (k: CopyKey) => session.copy[k] || kit[k] || '';
  const otherCopy = Object.fromEntries(COPY_KEYS.filter((k) => k !== body.key && effective(k)).map((k) => [k, effective(k)]));
  try {
    const options = await suggestCopy({
      key: body.key,
      current: effective(body.key),
      instruction,
      agent: c.fullName,
      office: c.office,
      category: kit.category,
      services: kit.services,
      facts: kit.facts,
      otherCopy,
    });
    if (!options.length) return fail('No usable versions came back. Try again or reword the request.', 502);
    return Response.json({ options }, { headers: HEADERS });
  } catch {
    return fail('The suggestion service did not answer. Try again in a moment.', 502);
  }
}
