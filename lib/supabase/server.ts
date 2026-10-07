// Supabase for server components, server actions and route handlers, acting as the signed-in user so
// row-level security applies. Never use the service role here.
import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './env';

export async function db() {
  const jar = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) jar.set(name, value, options);
        } catch {
          // Server components can't set cookies; proxy.ts refreshes the session instead.
        }
      },
    },
  });
}
