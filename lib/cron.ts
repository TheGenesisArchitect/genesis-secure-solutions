// Shared bits for the scheduled jobs: Vercel Cron authentication and the site origin for links in emails.
import 'server-only';

export function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && req.headers.get('authorization') === `Bearer ${secret}`;
}

/** Links in emails point at the canonical site in production, or this deployment elsewhere. */
export function siteOrigin(): string {
  if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN;
  if (process.env.VERCEL_ENV === 'production') return 'https://genovus.io';
  return process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3913';
}
