import { findClientByToken, type Client } from '@/lib/clients';
import { applicableStepIds, channelRegistry, channelsForClient, countDone, partnerDetailsFromEnv } from '@/lib/channels';
import { MAX_BODY, parseSocial, readSocial, writeSocial, type SocialProgress } from '@/lib/social-progress';
import { storageConfigured } from '@/lib/progress';

export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const fail = (error: string, status: number) => Response.json({ error }, { status, headers: HEADERS });

const setupFor = (c: Client) => channelsForClient(channelRegistry(partnerDetailsFromEnv()), c.social?.plan ?? []);

/** Progress plus a count the welcome page can show without knowing the channel list. */
function withSummary(p: SocialProgress, plan: ReturnType<typeof setupFor>['plan']) {
  const ids = applicableStepIds(plan, p.googleOwner);
  return { progress: p, steps: { done: countDone(ids, p.done, p.googleOwner), total: ids.length } };
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const client = findClientByToken((await ctx.params).token);
  if (!client) return fail('Not found', 404);
  if (!storageConfigured()) return fail('Progress storage is not connected yet.', 503);
  const { plan, optional } = setupFor(client);
  try {
    return Response.json(withSummary(await readSocial(client, plan, optional), plan), { headers: HEADERS });
  } catch {
    return fail('Could not load progress.', 502);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const client = findClientByToken((await ctx.params).token);
  if (!client) return fail('Not found', 404);
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
  const { plan, optional } = setupFor(client);
  const parsed = parseSocial(raw, plan, optional);
  if (!parsed) return fail('Invalid progress.', 400);
  try {
    return Response.json(withSummary(await writeSocial(client, parsed), plan), { headers: HEADERS });
  } catch {
    return fail('Could not save progress.', 502);
  }
}
