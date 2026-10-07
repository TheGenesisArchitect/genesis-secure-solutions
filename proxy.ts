// Keeps Supabase sessions fresh on the signed-in surfaces and passes the requested path on (x-pathname) so a
// signed-out visitor returns to the same page after sign-in. It never authorizes: pages do that
// (lib/session.ts) and row-level security backs them up. The older Basic-auth console routes pass through.
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { SUPABASE_URL, SUPABASE_ANON_KEY, supabaseConfigured } from './lib/supabase/env';

export async function proxy(request: NextRequest) {
  const reqHeaders = new Headers(request.headers);
  reqHeaders.set('x-pathname', request.nextUrl.pathname + request.nextUrl.search);
  const pass = () => NextResponse.next({ request: { headers: reqHeaders } });
  let response = pass();
  if (!supabaseConfigured()) return response;
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        reqHeaders.set('cookie', request.cookies.toString());
        response = pass();
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ['/console', '/console/((?!social|meta).*)', '/app', '/app/:path*', '/network/:path*', '/network', '/signin', '/auth/:path*', '/go'],
};
