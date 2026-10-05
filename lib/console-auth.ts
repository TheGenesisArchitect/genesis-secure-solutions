// Interim sign-in for the Genesis operator console: HTTP Basic auth against GSS_CONSOLE_PASSWORD.
// Replaced by Supabase sign-in when the back office ships. Any username works; only the password is checked.
import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (s: string) => createHash('sha256').update(s).digest();

/** null = allowed. Otherwise the Response to send back (401 asks the browser for the password, 503 = not set up). */
export function consoleAuth(req: Request): Response | null {
  const secret = process.env.GSS_CONSOLE_PASSWORD || '';
  const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
  if (secret.length < 16) return new Response('The console is not set up yet.', { status: 503, headers });
  const auth = req.headers.get('authorization') || '';
  let given = '';
  if (auth.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
      given = decoded.slice(decoded.indexOf(':') + 1);
    } catch {
      given = '';
    }
  }
  if (given && timingSafeEqual(digest(given), digest(secret))) return null;
  return new Response('Sign in required.', { status: 401, headers: { ...headers, 'WWW-Authenticate': 'Basic realm="Genesis console", charset="UTF-8"' } });
}
