// Sends a signed-in person to their own surface: console, agency dashboard or network view.
import { NextResponse, type NextRequest } from 'next/server';
import { getViewer, homeFor } from '@/lib/session';

export async function GET(req: NextRequest) {
  const v = await getViewer();
  return NextResponse.redirect(new URL(v ? homeFor(v) : '/signin', req.url));
}
