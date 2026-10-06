// Public status page for a Meta data deletion request. Shows only the code, date and status.
import { get } from '@vercel/blob';
import { storageConfigured } from '@/lib/progress';

export const dynamic = 'force-dynamic';
const HEADERS = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const page = (title: string, body: string, status = 200) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
      `<style>body{margin:0;background:#0b0c10;color:#eef0f4;font:16px/1.6 system-ui,sans-serif;padding:48px 16px}main{max-width:620px;margin:0 auto;display:grid;gap:14px}h1{font-size:26px;margin:0}p{margin:0;color:#c7cad1}code{background:#15171d;padding:2px 6px;border-radius:6px}</style></head>` +
      `<body><main>${body}</main></body></html>`,
    { status, headers: HEADERS },
  );

export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  const code = (await ctx.params).code;
  if (!/^[a-f0-9]{16}$/.test(code) || !storageConfigured()) return page('Not found', '<h1>Request not found</h1><p>Check the link from your confirmation.</p>', 404);
  const res = await get(`meta/deletions/${code}.json`, { access: 'private', useCache: false }).catch(() => null);
  if (!res || res.statusCode !== 200) return page('Not found', '<h1>Request not found</h1><p>Check the link from your confirmation.</p>', 404);
  let rec: { receivedAt?: string; status?: string } = {};
  try {
    rec = JSON.parse(await new Response(res.stream).text());
  } catch {
    rec = {};
  }
  const when = rec.receivedAt ? new Date(rec.receivedAt).toUTCString().replace(' GMT', ' UTC') : 'recently';
  const done = rec.status === 'completed';
  return page(
    'Data deletion request',
    `<h1>Data deletion request</h1><p>Confirmation code <code>${code}</code></p><p>Received ${when}.</p>` +
      `<p>Status: <strong>${done ? 'completed' : 'received, in progress'}</strong>.</p>` +
      `<p>Genovus, a Genesis Secure Solutions brand, deletes data linked to your Facebook account that it holds. This page updates when the request is complete.</p>`,
  );
}
