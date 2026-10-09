// Every minute: finish any running Studio takes, so nothing is lost if the page that started them was closed.
import { adminDb } from '@/lib/supabase/admin';
import { cronAuthorized } from '@/lib/cron';
import { pollTake, generationConfigured } from '@/lib/studio-gen';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response('Unauthorized', { status: 401 });
  if (!generationConfigured()) return Response.json({ skipped: 'no Gemini key' });
  const { data: running } = await adminDb().from('studio_takes').select('id').in('status', ['queued', 'running']).order('created_at').limit(10);
  const results: Record<string, number> = {};
  for (const t of running ?? []) {
    const r = await pollTake(t.id);
    results[r.status] = (results[r.status] ?? 0) + 1;
  }
  return Response.json({ checked: running?.length ?? 0, results });
}
