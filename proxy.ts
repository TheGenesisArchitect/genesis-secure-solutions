// Keeps Supabase sessions fresh on the signed-in surfaces. It never authorizes: pages do that
// (lib/session.ts) and row-level security backs them up. The older Basic-auth console routes pass through.
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { SUPABASE_URL, SUPABASE_ANON_KEY, supabaseConfigured } from './lib/supabase/env';

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  if (!supabaseConfigured()) return response;
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ['/console', '/console/((?!social|meta).*)', '/app/:path*', '/network/:path*', '/network', '/signin', '/auth/:path*', '/go'],
};
