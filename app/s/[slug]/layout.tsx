// Agency sites: their own look (site.css, scoped under .agsite), no Genovus chrome.
import '../site.css';

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
