// Who may see an agency site: anyone once it's live; before that, only with its signed preview key.
import 'server-only';
import { siteData, validPreview, type SiteData } from './site';

export async function siteFor(slug: string, k: string | undefined | null): Promise<{ d: SiteData; k?: string } | null> {
  const d = await siteData(slug);
  if (!d) return null;
  if (d.live) return { d };
  return validPreview(slug, k) ? { d, k: k ?? undefined } : null;
}
