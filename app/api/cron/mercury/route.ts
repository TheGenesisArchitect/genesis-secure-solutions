// Every 10 minutes: record what Mercury reports for open invoices (it sends no invoice event), and send the
// month's care invoices for clients whose owner approved automatic care billing. Polling also keeps the
// Mercury key in use (Mercury deletes keys idle for 45 days).
import { adminDb } from '@/lib/supabase/admin';
import { cronAuthorized } from '@/lib/cron';
import { mercuryConfigured, pushInvoice, syncOpenInvoices } from '@/lib/mercury';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response('Unauthorized', { status: 401 });
  if (!mercuryConfigured()) return Response.json({ skipped: 'mercury not configured' });
  const sync = await syncOpenInvoices();
  const db = adminDb();
  const { data: drafts } = await db.from('invoices').select('id, tenants!inner(care_autosend, is_sample)')
    .eq('kind', 'care').eq('status', 'draft').is('mercury_invoice_id', null).eq('tenants.care_autosend', true).eq('tenants.is_sample', false).limit(50);
  let sent = 0;
  const failed: string[] = [];
  for (const d of drafts ?? []) {
    try { await pushInvoice(d.id); sent++; } catch (e) { failed.push(e instanceof Error ? e.message : String(e)); }
  }
  if (failed.length) console.error(`[mercury] care autosend: ${failed.length} failed: ${[...new Set(failed)].join(' | ')}`);
  return Response.json({ ...sync, careSent: sent, careFailed: failed.length });
}
