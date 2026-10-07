// Landing for the emailed sign-in link: trade the code (or token hash) for a session, then go home.
import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { db } from '@/lib/supabase/server';
import { safeNext } from '@/lib/safe-next';

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  const supabase = await db();
  let ok = false;
  if (code) ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  else if (tokenHash && type) ok = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type })).error;
  const next = safeNext(url.searchParams.get('next'));
  return NextResponse.redirect(new URL(ok ? next ?? '/go' : '/signin?e=link', req.url));
}
