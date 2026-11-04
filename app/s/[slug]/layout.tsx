// Agency sites: their own look (site.css, scoped under .agsite), no Genovus chrome. The visit's first-touch tags
// are kept for the contact form, so a lead from an ad or a partner's link keeps its source.
import '../site.css';
import { SiteAttribution } from '@/components/site/SiteAttribution';

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return <><SiteAttribution />{children}</>;
}
