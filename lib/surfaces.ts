// The doors into the ecosystem. On the real domain they use the friendly addresses (app.genovus.io,
// partners.genovus.io); on previews and localhost they are plain paths so everything works without DNS.
import 'server-only';
import { headers } from 'next/headers';

export type Doors = { agency: string; carrier: string; team: string };

export async function doors(): Promise<Doors> {
  const host = ((await headers()).get('host') ?? '').toLowerCase();
  if (host === 'genovus.io' || host.endsWith('.genovus.io')) {
    return { agency: 'https://app.genovus.io', carrier: 'https://partners.genovus.io', team: 'https://genovus.io/console' };
  }
  return { agency: '/app', carrier: '/network', team: '/console' };
}
