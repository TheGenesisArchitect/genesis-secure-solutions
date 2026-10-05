import { findClientByToken } from '@/lib/clients';
import { WELCOME_TEMPLATE } from '@/lib/templates';

export const dynamic = 'force-dynamic';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const c = findClientByToken((await ctx.params).token);
  const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };
  if (!c) return new Response('<!doctype html><meta charset="utf-8"><title>Not found</title><p>This link is not valid.</p>', { status: 404, headers });
  const fill: Record<string, string> = {
    FIRST: esc(c.firstName),
    PLAN: esc(c.plan),
    OFFICE: esc(c.office),
    FILM: esc(c.film),
    POSTER: esc(c.poster),
    CONTACT: esc(c.contactName),
    TOKEN: esc(c.token),
    SLUG: esc(c.slug),
    PREVIEW: c.previewUrl ? `<p class="preview">Want to look around? <a href="${esc(c.previewUrl)}" target="_blank" rel="noreferrer">Open your draft site</a>. It is a private preview and not listed on search engines.</p>` : '',
    HANDLED: c.handled.map(([t, d]) => `<li><b>${esc(t)}</b>${esc(d)}</li>`).join(''),
    PRICING: c.pricing.map(([t, v]) => `<dt>${esc(t)}</dt><dd>${esc(v)}</dd>`).join(''),
  };
  const html = WELCOME_TEMPLATE.replace(/\{\{([A-Z]+)\}\}/g, (m, k: string) => (k in fill ? fill[k] : m));
  return new Response(html, { headers });
}
