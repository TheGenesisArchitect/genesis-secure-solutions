// Start a Helix Live tour: checks the per-visitor and daily limits, then mints a single-use, short-lived
// Gemini Live token with Helix's instructions and tools locked in. The Gemini key never reaches the browser.
// PATCH ends a session (records its length).
import { createHash } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { adminDb } from '@/lib/supabase/admin';
import { getViewer } from '@/lib/session';
import { studioSystem, BIBLE_TOOLS, type StudioFocus } from '@/lib/helix-bible';
import { worldStats, statsLine } from '@/lib/world-stats';
import { LIVE_WS, liveSetup, liveSetupWith, pickVoice, LIVE_MODEL, SESSION_SECONDS, DAILY_SESSIONS } from '@/lib/helix-tour';

export const dynamic = 'force-dynamic';

const KEY = () => (process.env.GEMINI_API_KEY || '').trim();

// With bidiGenerateContentSetup present (and no fieldMask), the token's setup replaces whatever the browser sends.
async function mint(setup?: unknown) {
  const now = Date.now();
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/auth_tokens', {
    method: 'POST',
    headers: { 'x-goog-api-key': KEY(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      uses: 1,
      expireTime: new Date(now + (SESSION_SECONDS + 60) * 1000).toISOString(),
      newSessionExpireTime: new Date(now + 2 * 60 * 1000).toISOString(),
      ...(setup ? { bidiGenerateContentSetup: setup } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as { name?: string; error?: { message?: string } };
  return res.ok && body.name ? { token: body.name } : { error: body.error?.message ?? `HTTP ${res.status}` };
}

// The campaign and platform that brought this visitor (first-touch cookie set by RefCapture), codes only.
function campaignRef(raw?: string): { c: string | null; src: string | null } {
  try {
    const r = JSON.parse(decodeURIComponent(raw ?? '')) as { c?: unknown; src?: unknown };
    const ok = (v: unknown, re: RegExp) => (typeof v === 'string' && re.test(v) ? v : null);
    return { c: ok(r.c, /^[a-z0-9-]{2,41}$/), src: ok(r.src, /^[a-z0-9-]{1,20}$/) };
  } catch { return { c: null, src: null }; }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { voice?: string; context?: string; focus?: { kind?: string; code?: string } };
  const voice = pickVoice(body.voice);
  const context = body.context === 'bible' || body.context === 'studio' ? 'studio' : 'tour';
  // What the person is looking at in the Studio (validated: a known kind and a simple code).
  const kinds = ['home', 'bible', 'cast', 'episode', 'character'];
  const focus: StudioFocus = { kind: (kinds.includes(String(body.focus?.kind)) ? body.focus!.kind : body.context === 'bible' ? 'bible' : 'home') as StudioFocus['kind'], code: /^[A-Za-z0-9-]{1,30}$/.test(String(body.focus?.code ?? '')) ? body.focus!.code : undefined };
  // Local testing only: no key, a stand-in token; the test page supplies its own voice socket.
  if (!KEY() && process.env.NODE_ENV !== 'production' && process.env.HELIX_STANDIN === '1') {
    const { data: s } = await adminDb().from('helix_tour_sessions').insert({ ip_hash: 'standin', is_staff: true, model: 'standin' }).select('id').single();
    return Response.json({ sessionId: s!.id, token: 'standin', wsUrl: 'wss://standin.invalid/live', setup: liveSetup(voice), locked: true, staff: Boolean((await getViewer().catch(() => null))?.staff), maxSeconds: SESSION_SECONDS });
  }
  if (!KEY()) return Response.json({ error: 'Helix voice is not connected yet.' }, { status: 503 });
  const h = await headers();
  const ref = campaignRef((await cookies()).get('gv_ref')?.value);
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const ipHash = createHash('sha256').update(`genovus-helix|${ip}`).digest('hex').slice(0, 32);
  const viewer = await getViewer().catch(() => null);
  const staff = Boolean(viewer?.staff);
  const db = adminDb();
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  // No per-visitor limit: the link is meant to be shared and replayed. One high daily ceiling stays as a
  // runaway-spend guard (HELIX_DAILY_SESSIONS); the team's own tours never count against it.
  const { count: today } = await db.from('helix_tour_sessions').select('id', { count: 'exact', head: true }).eq('is_staff', false).gte('started_at', dayStart.toISOString());
  // Ask Helix in the Studio is for the Genovus team only.
  if (context === 'studio' && !staff) return Response.json({ error: 'Ask Helix in the Studio is for the Genovus team.' }, { status: 403 });
  const setup = context === 'studio' ? liveSetupWith(await studioSystem(focus), BIBLE_TOOLS, voice) : liveSetup(voice, statsLine(await worldStats()));
  if (!staff && (today ?? 0) >= DAILY_SESSIONS()) return Response.json({ error: 'Helix has given all of today’s tours. Please come back tomorrow.' }, { status: 429 });

  // Lock Helix's instructions and tools into the token; if the service won't accept the lock, fall back to an
  // unlocked token (the browser sends the same setup), which only the Genovus team may use.
  let minted = await mint(setup);
  let locked = true;
  if ('error' in minted) {
    console.error(`[helix] locked setup refused: ${minted.error}`);
    minted = await mint();
    locked = false;
  }
  // Unlocked tokens let the browser choose the instructions, so only the Genovus team may use them.
  if (!('error' in minted) && !locked && !staff) return Response.json({ error: 'Helix’s voice is being tuned. The scripted session below shows what it does.' }, { status: 503 });
  if ('error' in minted) {
    console.error(`[helix] token refused: ${minted.error}`);
    return Response.json({ error: 'Helix couldn’t start a voice session right now.' }, { status: 502 });
  }
  const { data: s } = await db.from('helix_tour_sessions').insert({ ip_hash: ipHash, viewer_id: viewer?.userId ?? null, is_staff: staff, model: `${LIVE_MODEL()} · ${voice}${context === 'studio' ? ` · studio:${focus.kind}${focus.code ? `:${focus.code}` : ''}` : ''}`, campaign: ref.c, src: ref.src }).select('id').single();
  return Response.json({ sessionId: s!.id, token: minted.token, wsUrl: LIVE_WS, setup, voice, context, locked, staff, maxSeconds: SESSION_SECONDS });
}

export async function PATCH(req: Request) {
  const { sessionId, seconds, tokens } = (await req.json().catch(() => ({}))) as { sessionId?: string; seconds?: number; tokens?: number };
  if (!sessionId || !/^[0-9a-f-]{36}$/.test(sessionId)) return Response.json({ ok: false }, { status: 400 });
  await adminDb().from('helix_tour_sessions').update({ ended_at: new Date().toISOString(), seconds: Math.max(0, Math.min(SESSION_SECONDS + 120, Math.round(Number(seconds) || 0))), tokens: Math.max(0, Math.round(Number(tokens) || 0)) || null }).eq('id', sessionId).is('ended_at', null);
  return Response.json({ ok: true });
}
