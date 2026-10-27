// The site's review link: straight to the office's own Google listing's review form (printed cards can point here,
// so they keep working if the listing link changes). Every customer gets the same ask.
import { siteFor } from '@/lib/site-access';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const site = await siteFor((await ctx.params).slug, new URL(req.url).searchParams.get('k'));
  if (!site?.d.placeId) return new Response('Not found', { status: 404 });
  return Response.redirect(`https://search.google.com/local/writereview?placeid=${encodeURIComponent(site.d.placeId)}`, 302);
}
