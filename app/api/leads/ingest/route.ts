// An agency's website hands Genovus each callback, server to server, with the agency's lead key (Authorization:
// Bearer). The key decides the agency; the visit's tracking tags decide the source shown in the dashboard. The
// site emails the lead first, so a failure here never costs the agency a lead. Retries are safe (ext id).
import { createHash } from 'node:crypto';
import { adminDb } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

/** Where the visit came from, in words an agent recognizes: the campaign's source, else the click ID, else the referring site. */
function sourceOf(a: Record<string, string>): string {
  if (a.utm_source) return a.utm_source.toLowerCase();
  if (a.fbclid) return 'facebook';
  if (a.gclid) return 'google';
  const ref = host(a.referrer ?? '');
  if (/facebook\.com|fb\.com|instagram\.com/.test(ref)) return ref.includes('instagram') ? 'instagram' : 'facebook';
  if (/google\./.test(ref)) return 'google';
  return ref || 'direct';
}

export async function POST(req: Request) {
  const key = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (key.length < 32) return Response.json({ error: 'Missing lead key.' }, { status: 401 });
  if (Number(req.headers.get('content-length') || 0) > 12_000) return Response.json({ error: 'Too large.' }, { status: 413 });
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return Response.json({ error: 'Send JSON.' }, { status: 400 });
  const name = str(b.name, 120), email = str(b.email, 150), phone = str(b.phone, 40), consent = str(b.consent, 500);
  if (name.length < 1 || (!email && !phone)) return Response.json({ error: 'A lead needs a name and an email or phone.' }, { status: 400 });
  if (consent.length < 10) return Response.json({ error: 'Send the consent wording the visitor agreed to.' }, { status: 400 });
  const raw = (b.attribution && typeof b.attribution === 'object' ? b.attribution : {}) as Record<string, unknown>;
  const attribution: Record<string, string> = {};
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'referrer', 'landing']) { const v = str(raw[k], 300); if (v) attribution[k] = v; }
  const keyHash = createHash('sha256').update(key).digest('hex');
  const { data, error } = await adminDb().rpc('ingest_lead', {
    p_key_hash: keyHash, p_ext_id: str(b.id, 120), p_name: name, p_email: email, p_phone: phone, p_topic: str(b.topic, 120), p_message: str(b.message, 2000),
    p_source: sourceOf(attribution), p_medium: attribution.utm_medium ?? '', p_campaign: attribution.utm_campaign ?? '', p_attribution: attribution, p_consent: consent,
  });
  if (error) {
    const unknownKey = /unknown lead key/.test(error.message);
    if (!unknownKey) console.error(`[leads] ingest failed: ${error.message}`);
    return Response.json({ error: unknownKey ? 'Unknown lead key.' : 'Could not record the lead.' }, { status: unknownKey ? 401 : 500 });
  }
  return Response.json({ ok: true, ...(data as object) });
}
