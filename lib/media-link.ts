// Signed media links: a time-limited, tamper-proof link to one final cut or render (video), or one Library image
// (an agency's approved ad), so a publishing service (Metricool) can fetch it without our storage going public. The signature covers the kind, the id and the
// expiry; nothing else is reachable with it. Server only.
import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

const SECRET = () => process.env.MEDIA_LINK_SECRET || process.env.CRON_SECRET || '';
export type SignedKind = 'final' | 'render' | 'asset';
const EXT: Record<SignedKind, string> = { final: 'mp4', render: 'mp4', asset: 'jpg' };
const sign = (kind: string, id: string, exp: number) => createHmac('sha256', SECRET()).update(`${kind}:${id}:${exp}`).digest('base64url');

/** A link valid until `until` (default 7 days): long enough for a post scheduled ahead to be fetched. */
export function signedMediaUrl(origin: string, kind: SignedKind, id: string, until = Date.now() + 7 * 86_400_000): string | null {
  if (!SECRET()) return null;
  const exp = Math.floor(until / 1000);
  return `${origin}/api/media/signed/${kind}/${id}.${EXT[kind]}?exp=${exp}&sig=${sign(kind, id, exp)}`;
}

export function verifyMediaSig(kind: string, id: string, exp: string | null, sig: string | null): boolean {
  if (!SECRET() || !exp || !sig || !/^\d{9,11}$/.test(exp) || Number(exp) * 1000 < Date.now()) return false;
  const want = Buffer.from(sign(kind, id, Number(exp)));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}
