// An agency's website hands Genovus each callback, server to server, with the agency's lead key (Authorization:
// Bearer). The key decides the agency; the visit's tracking tags decide the source shown in the dashboard (a partner
// gets credit only from a signed link, lib/attribution.ts). Each agency takes at most 30 leads a minute and 500 a
// day through its keys, so a leaked key can't flood the office. Retries are safe (ext id).
import { createHash } from 'node:crypto';
import { adminDb } from '@/lib/supabase/admin';
import { cleanAttribution, tagLead } from '@/lib/attribution';

export const dynamic = 'force-dynamic';

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const PER_MINUTE = 30, PER_DAY = 500;
const CHANNELS = ['call', 'email', 'autodial_ai', 'sms'];
const channelsOf = (v: unknown) => (Array.isArray(v) && v.length ? v.filter((c): c is string => CHANNELS.includes(c)) : ['call', 'email']);

export async function POST(req: Request) {
  const key = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (key.length < 32) return Response.json({ error: 'Missing lead key.' }, { status: 401 });
  if (Number(req.headers.get('content-length') || 0) > 12_000) return Response.json({ error: 'Too large.' }, { status: 413 });
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return Response.json({ error: 'Send JSON.' }, { status: 400 });
  const name = str(b.name, 120), email = str(b.email, 150), phone = str(b.phone, 40), consent = str(b.consent, 500);
  if (name.length < 1 || (!email && !phone)) return Response.json({ error: 'A lead needs a name and an email or phone.' }, { status: 400 });
  if (consent.length < 10) return Response.json({ error: 'Send the consent wording the visitor agreed to.' }, { status: 400 });
  const keyHash = createHash('sha256').update(key).digest('hex');
  const db = adminDb();
  const { data: k } = await db.from('lead_keys').select('tenant_id').eq('key_hash', keyHash).is('revoked_at', null).maybeSingle();
  if (!k) return Response.json({ error: 'Unknown lead key.' }, { status: 401 });
  const recent = (ms: number) => db.from('leads').select('id', { count: 'exact', head: true }).eq('tenant_id', k.tenant_id).gte('created_at', new Date(Date.now() - ms).toISOString());
  const [{ count: minute }, { count: day }] = await Promise.all([recent(60_000), recent(86_400_000)]);
  if ((minute ?? 0) >= PER_MINUTE || (day ?? 0) >= PER_DAY) {
    console.error(`[leads] rate limit for tenant ${k.tenant_id}: ${minute} this minute, ${day} today`);
    return Response.json({ error: 'Too many leads right now. Try again shortly.' }, { status: 429, headers: { 'retry-after': '60' } });
  }
  const attribution = cleanAttribution(b.attribution);
  const { source, campaign } = tagLead(k.tenant_id, attribution);
  const { data, error } = await db.rpc('ingest_lead', {
    p_key_hash: keyHash, p_ext_id: str(b.id, 120), p_name: name, p_email: email, p_phone: phone, p_topic: str(b.topic, 120), p_message: str(b.message, 2000),
    p_source: source, p_medium: attribution.utm_medium ?? '', p_campaign: campaign, p_attribution: attribution, p_consent: consent,
    // The consent ledger (migration 0094): the channels the visitor's wording covered (a callback about their request:
    // call and email unless the site says otherwise) and the page it was given on.
    p_channels: channelsOf(b.channels), p_meta: { page_url: attribution.landing ?? attribution.referrer ?? null },
  });
  if (error) {
    const unknownKey = /unknown lead key/.test(error.message);
    if (!unknownKey) console.error(`[leads] ingest failed: ${error.message}`);
    return Response.json({ error: unknownKey ? 'Unknown lead key.' : 'Could not record the lead.' }, { status: unknownKey ? 401 : 500 });
  }
  return Response.json({ ok: true, ...(data as object) });
}
