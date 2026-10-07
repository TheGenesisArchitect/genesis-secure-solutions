import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/supabase/env';

export async function POST(req: NextRequest) {
  if (supabaseConfigured()) await (await db()).auth.signOut();
  return NextResponse.redirect(new URL('/signin', req.url), { status: 303 });
}
