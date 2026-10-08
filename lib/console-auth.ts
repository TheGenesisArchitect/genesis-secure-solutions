// Sign-in for the older console routes (social setup console, Meta connector).
// A signed-in Genovus staff member is let straight in (one sign-in for the whole ecosystem). The original
// shared password (HTTP Basic, GSS_CONSOLE_PASSWORD) still works as a fallback for direct links, but the
// browser's password box is only ever requested on a deliberate visit: never for background prefetches,
// API polling, or when someone is already signed in to Genovus.
import { createHash, timingSafeEqual } from 'node:crypto';
import { getViewer } from './session';

const digest = (s: string) => createHash('sha256').update(s).digest();
const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };

function basicOk(req: Request): boolean {
  const secret = process.env.GSS_CONSOLE_PASSWORD || '';
  if (secret.length < 16) return false;
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Basic ')) return false;
  try {
    const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
    const given = decoded.slice(decoded.indexOf(':') + 1);
    return !!given && timingSafeEqual(digest(given), digest(secret));
  } catch {
    return false;
  }
}

/** null = allowed. Otherwise the Response to send back. */
export async function consoleAuth(req: Request): Promise<Response | null> {
  const viewer = await getViewer().catch(() => null);
  if (viewer?.staff) return null;
  if (basicOk(req)) return null;

  const url = new URL(req.url);
  const isPrefetch = req.headers.get('next-router-prefetch') === '1' || req.headers.get('purpose') === 'prefetch' || req.headers.get('sec-purpose')?.includes('prefetch');
  const isApi = url.pathname.includes('/api');
  const accepts = req.headers.get('accept') ?? '';
  // Someone signed in to Genovus without staff access, a background request, or an API call: never prompt.
  if (viewer || isPrefetch || isApi) return new Response('Sign in required.', { status: 401, headers });
  // A person opening the page in the browser: send them to the normal Genovus sign-in and back.
  if (accepts.includes('text/html')) {
    return Response.redirect(new URL(`/signin?next=${encodeURIComponent(url.pathname)}`, url), 303);
  }
  return new Response('Sign in required.', { status: 401, headers });
}
