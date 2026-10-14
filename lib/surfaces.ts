// The doors into the ecosystem. In production they use the friendly addresses (app.genovus.io,
// partners.genovus.io); on previews and localhost they are plain paths so everything works without DNS.
// Decided by the deployment, not the request: reading the host header made every public page render per visit
// instead of being served from the cache.
import 'server-only';

export type Doors = { agency: string; carrier: string; team: string };

export async function doors(): Promise<Doors> {
  if (process.env.VERCEL_ENV === 'production') {
    return { agency: 'https://app.genovus.io', carrier: 'https://partners.genovus.io', team: 'https://genovus.io/console' };
  }
  return { agency: '/app', carrier: '/network', team: '/console' };
}
