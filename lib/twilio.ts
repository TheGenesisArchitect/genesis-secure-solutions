// Twilio, for agency call tracking: buy a local number that forwards to the office, check that each webhook really
// came from Twilio (X-Twilio-Signature), and stream a call recording to a signed-in member. REST over fetch, no SDK.
// Server only; TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN. TWILIO_API_BASE points tests at a stand-in.
import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

const SID = () => (process.env.TWILIO_ACCOUNT_SID || '').trim();
const TOKEN = () => (process.env.TWILIO_AUTH_TOKEN || '').trim();
const BASE = () => (process.env.TWILIO_API_BASE || 'https://api.twilio.com').replace(/\/$/, '');
export const twilioConfigured = () => Boolean(SID() && TOKEN());

const auth = () => 'Basic ' + Buffer.from(`${SID()}:${TOKEN()}`).toString('base64');

async function api<T>(path: string, init: { method?: string; form?: Record<string, string> } = {}): Promise<T> {
  if (!twilioConfigured()) throw new Error('Twilio is not connected (TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN).');
  const res = await fetch(`${BASE()}/2010-04-01/Accounts/${SID()}${path}`, {
    method: init.method ?? 'GET',
    headers: { authorization: auth(), ...(init.form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
    body: init.form ? new URLSearchParams(init.form).toString() : undefined,
    signal: AbortSignal.timeout(20_000),
    cache: 'no-store',
  });
  const j = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(`Twilio: ${j.message ?? `HTTP ${res.status}`}`);
  return j;
}

/** Buy one local number in an area code, wired to Genovus's voice webhook. Costs about $1.15 a month. */
export async function buyLocalNumber(areaCode: string, origin: string, friendlyName: string) {
  const avail = await api<{ available_phone_numbers?: { phone_number: string }[] }>(`/AvailablePhoneNumbers/US/Local.json?AreaCode=${encodeURIComponent(areaCode)}&VoiceEnabled=true&PageSize=1`);
  const pick = avail.available_phone_numbers?.[0]?.phone_number;
  if (!pick) throw new Error(`No ${areaCode} numbers are available right now. Try a nearby area code.`);
  const n = await api<{ sid: string; phone_number: string }>('/IncomingPhoneNumbers.json', {
    method: 'POST',
    form: { PhoneNumber: pick, FriendlyName: friendlyName.slice(0, 60), VoiceUrl: `${origin}/api/voice/incoming`, VoiceMethod: 'POST' },
  });
  return { sid: n.sid, e164: n.phone_number };
}

export async function releaseNumber(sid: string) {
  await api(`/IncomingPhoneNumbers/${encodeURIComponent(sid)}.json`, { method: 'DELETE' }).catch((e) => { if (!/HTTP 204|not found/i.test(String(e))) throw e; });
}

export async function deleteRecording(sid: string) {
  await api(`/Recordings/${encodeURIComponent(sid)}.json`, { method: 'DELETE' }).catch(() => {});
}

/** A recording's audio (MP3), for the signed-in proxy. */
export async function recordingAudio(sid: string): Promise<Response> {
  return fetch(`${BASE()}/2010-04-01/Accounts/${SID()}/Recordings/${encodeURIComponent(sid)}.mp3`, { headers: { authorization: auth() }, signal: AbortSignal.timeout(30_000), cache: 'no-store' });
}

/** Twilio's request signature: HMAC-SHA1 over the full URL plus every POST field (sorted, name then value). */
export function twilioSignature(url: string, params: Record<string, string>, token = TOKEN()) {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  return createHmac('sha1', token).update(data, 'utf8').digest('base64');
}

export function validTwilioRequest(url: string, params: Record<string, string>, signature: string | null): boolean {
  if (!TOKEN() || !signature) return false;
  const want = Buffer.from(twilioSignature(url, params));
  const got = Buffer.from(signature);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** The URL Twilio called, as Twilio saw it (behind Vercel's proxy). */
export function publicUrl(req: Request): string {
  const u = new URL(req.url);
  const proto = req.headers.get('x-forwarded-proto') ?? u.protocol.replace(':', '');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? u.host;
  return `${proto}://${host}${u.pathname}${u.search}`;
}

/** Read and verify a Twilio webhook. Returns its fields, or null when the signature is wrong. */
export async function twilioForm(req: Request): Promise<Record<string, string> | null> {
  const fd = await req.formData();
  const params: Record<string, string> = {};
  fd.forEach((v, k) => { if (typeof v === 'string') params[k] = v; });
  return validTwilioRequest(publicUrl(req), params, req.headers.get('x-twilio-signature')) ? params : null;
}

export const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const twiml = (body: string) => new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, { headers: { 'content-type': 'text/xml' } });

/** "+17065550142" → "(706) 555-0142". */
export const prettyPhone = (e164: string | null | undefined) => {
  const d = String(e164 ?? '').replace(/\D/g, '').slice(-10);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(e164 ?? '');
};
