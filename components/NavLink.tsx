'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from './icons';

/** A rail link that marks itself current. `exact` for section roots so children don't light them up;
 *  `plain` for pages served outside the app router (never prefetched). When the rail is collapsed only the
 *  icon shows, so the label doubles as the tooltip and accessible name. */
export function NavLink({ href, exact, count, children, plain, icon }: { href: string; exact?: boolean; count?: number; children: React.ReactNode; plain?: boolean; icon: string }) {
  const path = usePathname();
  const on = exact ? path === href : path === href || path.startsWith(href + '/');
  const label = typeof children === 'string' ? children : undefined;
  return (
    <Link href={href} prefetch={plain ? false : undefined} aria-current={on ? 'page' : undefined} title={label} data-label={label}>
      <span className="nav-icon"><Icon name={icon} />{count ? <i className="nav-dot" aria-hidden="true" /> : null}</span>
      <span className="nav-label">{children}</span>
      {count ? <span className="count num">{count}</span> : null}
    </Link>
  );
}
