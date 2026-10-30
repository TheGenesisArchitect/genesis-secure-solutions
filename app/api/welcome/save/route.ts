// One section of the welcome page's form (lib/checklist.ts), from a signed-in member of that agency (or the Genovus
// team on their behalf): same site only, fields from the checklist's allowlist, photos as images up to 8 MB.
import { getViewer } from '@/lib/session';
import { adminDb } from '@/lib/supabase/admin';
import { saveIntake } from '@/lib/client-checklist';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) return Response.json({ ok: false, error: 'Not allowed.' }, { status: 403 });
  const viewer = await getViewer().catch(() => null);
  if (!viewer) return Response.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  if (Number(req.headers.get('content-length') ?? 0) > 18 * 1024 * 1024) return Response.json({ ok: false, error: 'That’s too large. Photos up to 8 MB each.' }, { status: 413 });
  const form = await req.formData().catch(() => null);
  if (!form) return Response.json({ ok: false, error: 'Nothing was sent.' }, { status: 400 });
  const slug = String(form.get('slug') ?? '');
  const db = adminDb();
  const { data: t } = await db.from('tenants').select('id').eq('slug', slug).maybeSingle();
  const member = viewer.memberships.some((m) => m.slug === slug);
  if (!t || (!member && !viewer.staff)) return Response.json({ ok: false, error: 'Not allowed.' }, { status: 403 });
  const { data: rec } = await db.from('agent_records').select('data').eq('tenant_id', t.id).eq('is_current', true).maybeSingle();
  const r = await saveIntake(t.id as string, (rec?.data ?? {}) as Record<string, unknown>, form);
  return Response.json(r, { status: r.ok ? 200 : 400, headers: { 'Cache-Control': 'no-store' } });
}
