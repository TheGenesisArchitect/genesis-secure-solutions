// The team's ops endpoint for client email: emails prepared in a working session (with Claude in the terminal) are
// previewed, scheduled, checked and canceled here, through the same code and checks as the client page's Client
// email panel (lib/client-email-core.ts). Bearer GENOVUS_OPS_KEY (server env; off when unset). Each email is
// approved by a person in that session before it's scheduled; the audit log names the ops key and who it acts for
// (GENOVUS_OPS_ACTOR, also where tests go unless test_to is given).
//   GET    ?slug=<client>[&delivery=1]  recent client emails: status, send time, sent time, error, Resend id
//                                        (delivery=1 also asks Resend for each sent one's last event)
//   POST   { slug, kind: "site_review" | "note", dry?, ...fields }   dry renders only; otherwise schedules
//          fields as the panel's form: to, cc, when (Eastern "YYYY-MM-DDTHH:MM"), intent: "test", subject,
//          note, site, card, agency, sender, copy, copy_help, item: [...], help_<key>, reply, next | body (note)
//   DELETE ?id=<outbox id>               cancel one that hasn't gone out
import { timingSafeEqual } from 'node:crypto';
import { adminDb } from '@/lib/supabase/admin';
import { scheduleNote, scheduleSiteReview, cancelClientEmail, listClientEmails, type Actor } from '@/lib/client-email-core';

export const dynamic = 'force-dynamic';

function authorized(req: Request) {
  const key = process.env.GENOVUS_OPS_KEY ?? '';
  const got = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (key.length < 32 || got.length !== key.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(key));
}
const forWhom = () => process.env.GENOVUS_OPS_ACTOR || 'anthony@genovus.io';
const actor = (testTo?: string): Actor => ({ id: null, email: testTo || forWhom(), label: `ops key (for ${forWhom()})` });
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function tenantId(slug: string | null) {
  if (!slug) return null;
  const { data } = await adminDb().from('tenants').select('id').eq('slug', slug).maybeSingle();
  return (data?.id as string) ?? null;
}

/** Resend's last event for a sent email (delivered, bounced, opened…), when the key may read it. */
async function delivery(id: string): Promise<string> {
  const key = process.env.RESEND_API_KEY || process.env.RESEND_GENOVOUS_API_KEY;
  if (!key) return 'unknown (email not configured)';
  const res = await fetch(`https://api.resend.com/emails/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!res) return 'unknown (Resend unreachable)';
  if (res.status === 401 || res.status === 403) return 'unknown (the Resend key is send-only)';
  const body = (await res.json().catch(() => ({}))) as { last_event?: string };
  return res.ok ? body.last_event ?? 'unknown' : `unknown (Resend ${res.status})`;
}

export async function GET(req: Request) {
  if (!authorized(req)) return json({ error: 'unauthorized' }, 401);
  const url = new URL(req.url);
  const id = await tenantId(url.searchParams.get('slug'));
  if (!id) return json({ error: 'client not found' }, 404);
  const rows = await listClientEmails(id);
  if (url.searchParams.get('delivery') === '1') {
    await Promise.all(rows.map(async (r) => { if (r.providerId) (r as typeof r & { delivery?: string }).delivery = await delivery(r.providerId); }));
  }
  return json({ now: new Date().toISOString(), emails: rows });
}

export async function POST(req: Request) {
  if (!authorized(req)) return json({ error: 'unauthorized' }, 401);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ error: 'send JSON' }, 400);
  const id = await tenantId(typeof body.slug === 'string' ? body.slug : null);
  if (!id) return json({ error: 'client not found' }, 404);
  const f = new FormData();
  f.set('tenant', id);
  for (const [k, v] of Object.entries(body)) {
    if (['slug', 'kind', 'dry', 'tenant', 'test_to'].includes(k) || v == null || v === false) continue;
    for (const x of Array.isArray(v) ? v : [v]) f.append(k, x === true ? '1' : String(x));
  }
  const who = actor(typeof body.test_to === 'string' ? body.test_to : undefined);
  const dry = body.dry === true;
  const r = body.kind === 'note' ? await scheduleNote(f, who, dry) : body.kind === 'site_review' ? await scheduleSiteReview(f, who, dry) : null;
  if (!r) return json({ error: 'kind is site_review or note' }, 400);
  return r.ok ? json(r) : json({ error: r.error }, 422);
}

export async function DELETE(req: Request) {
  if (!authorized(req)) return json({ error: 'unauthorized' }, 401);
  const r = await cancelClientEmail(Number(new URL(req.url).searchParams.get('id')), null, actor());
  return r.ok ? json(r) : json({ error: r.error }, 409);
}
