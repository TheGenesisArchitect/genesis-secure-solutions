import { findClientAnyByToken, hasWelcome } from '@/lib/clients';
import { WELCOME_TEMPLATE } from '@/lib/templates';
import { adminDb } from '@/lib/supabase/admin';
import { tenantForToken } from '@/lib/client-checklist';
import { checklistStatus } from '@/lib/checklist';

/** True once someone at the agency has been invited, so the dashboard door is worth showing. */
async function hasDashboard(slug: string): Promise<boolean> {
  if (!process.env.SUPABASE_SECRET_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) return false;
  try {
    const db = adminDb();
    const { data: t } = await db.from('tenants').select('id').eq('slug', slug).maybeSingle();
    if (!t) return false;
    const { count } = await db.from('memberships').select('user_id', { count: 'exact', head: true }).eq('tenant_id', t.id);
    return (count ?? 0) > 0;
  } catch {
    return false;
  }
}

export const dynamic = 'force-dynamic';

/** The setup checklist, while anything on it is still missing: what's left and a button to it. */
async function checklistCallout(token: string): Promise<string> {
  try {
    const who = await tenantForToken(token);
    if (!who) return '';
    const s = checklistStatus(who.record);
    return s.done ? '' : `<p class="preview"><b>Your setup checklist:</b> ${s.missing.length} thing${s.missing.length === 1 ? '' : 's'} left (about ten minutes). <a href="/welcome/${token}/checklist">Open your checklist</a></p>`;
  } catch { return ''; }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const c = await findClientAnyByToken((await ctx.params).token);
  const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };
  // A client without a personal welcome film yet (most new clients) goes straight to their setup checklist.
  if (c && !hasWelcome(c) && !c.internal) return Response.redirect(new URL(`/welcome/${(await ctx.params).token}/checklist`, _req.url), 302);
  if (!hasWelcome(c)) return new Response('<!doctype html><meta charset="utf-8"><title>Not found</title><p>This link is not valid.</p>', { status: 404, headers });
  const fill: Record<string, string> = {
    FIRST: esc(c.firstName),
    PLAN: esc(c.plan),
    OFFICE: esc(c.office),
    FILM: esc(c.film),
    POSTER: esc(c.poster),
    CONTACT: esc(c.contactName),
    TOKEN: esc(c.token),
    SLUG: esc(c.slug),
    DASHBOARD: (await checklistCallout((await ctx.params).token)) + ((await hasDashboard(c.slug)) ? `<p class="preview"><b>Your dashboard is ready.</b> <a href="/app/${esc(c.slug)}">Open your dashboard</a> for approvals, setup and results. You sign in with your email, no password.</p>` : ''),
    PREVIEW: c.previewUrl ? `<p class="preview">Want to look around? <a href="${esc(c.previewUrl)}" target="_blank" rel="noreferrer">Open your draft site</a>. It is a private preview and not listed on search engines.</p>` : '',
    HANDLED: c.handled.map(([t, d]) => `<li><b>${esc(t)}</b>${esc(d)}</li>`).join(''),
    PRICING: c.pricing.map(([t, v]) => `<dt>${esc(t)}</dt><dd>${esc(v)}</dd>`).join(''),
  };
  const html = WELCOME_TEMPLATE.replace(/\{\{([A-Z]+)\}\}/g, (m, k: string) => (k in fill ? fill[k] : m));
  return new Response(html, { headers });
}
