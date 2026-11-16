// Links for outside services (Metricool, YouTube) to fetch a recording's thumbnail. A storage link is signed for GET
// only and answers a HEAD with 403; services check a thumbnail with HEAD before fetching it, so every long-form's custom
// thumbnail was refused ("Could not upload video thumbnail"). This link is on genovus.io, answers HEAD and GET, is
// signed (HMAC with the cron secret) and expires, and only ever serves a recording's thumbnail.
import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { siteOrigin } from '@/lib/cron';

const SECRET = () => (process.env.CRON_SECRET || '').trim();
export const THUMB_PATH = /^studio\/vlogs\/[0-9a-f-]{36}\/thumbs\/[A-Za-z0-9._-]+\.(jpg|jpeg|png)$/;
const sign = (body: string) => createHmac('sha256', SECRET()).update(body).digest('base64url');

/** A public, expiring link to a recording's thumbnail (null when signing isn't configured or the path isn't one). */
export function thumbLink(path: string, mins: number): string | null {
  if (!SECRET() || !THUMB_PATH.test(path)) return null;
  const body = Buffer.from(JSON.stringify({ p: path, e: Date.now() + mins * 60_000 })).toString('base64url');
  return `${siteOrigin()}/api/studio/unedit/thumb/${body}.${sign(body)}.${path.endsWith('.png') ? 'png' : 'jpg'}`;
}

/** The thumbnail path a link names, when its signature holds and it hasn't expired. */
export function readThumbLink(token: string): string | null {
  const m = token.match(/^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.(jpg|png)$/);
  if (!m || !SECRET()) return null;
  const want = Buffer.from(sign(m[1])), got = Buffer.from(m[2]);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const { p, e } = JSON.parse(Buffer.from(m[1], 'base64url').toString()) as { p?: string; e?: number };
    return typeof p === 'string' && THUMB_PATH.test(p) && typeof e === 'number' && e > Date.now() ? p : null;
  } catch { return null; }
}
