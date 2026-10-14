// Metricool connection check (staff only): is the account token set and accepted, and which brands and networks
// can Genovus post to. Never returns the token. Open genovus.io/api/studio/metricool while signed in.
import { db } from '@/lib/supabase/server';
import { metricoolBrands, metricoolConfigured, METRICOOL_USER_ID, GENOVUS_BLOG_ID } from '@/lib/metricool';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { data: staff } = await (await db()).rpc('is_staff');
  if (!staff) return Response.json({ ok: false, error: 'Sign in as the Genovus team first.' }, { status: 403 });
  if (!metricoolConfigured()) return Response.json({ ok: false, configured: false, error: 'METRICOOL_GENOVUS_API_KEY is empty on this deployment.' });
  const r = await metricoolBrands();
  return Response.json(r.ok
    ? { ok: true, configured: true, userId: METRICOOL_USER_ID(), genovusBrand: GENOVUS_BLOG_ID(), brands: r.data }
    : { ok: false, configured: true, userId: METRICOOL_USER_ID(), status: r.status, error: r.error,
        hint: r.status === 401 ? 'Metricool refused the token: copy the "REST API Access token" from Account Settings > API again (API access needs the Advanced plan).' : undefined });
}
