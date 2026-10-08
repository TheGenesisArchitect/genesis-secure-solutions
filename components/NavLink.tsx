'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** A rail link that marks itself current. `exact` for section roots so children don't light them up;
 *  `plain` for pages served outside the app router (never prefetched). */
export function NavLink({ href, exact, count, children, plain }: { href: string; exact?: boolean; count?: number; children: React.ReactNode; plain?: boolean }) {
  const path = usePathname();
  const on = exact ? path === href : path === href || path.startsWith(href + '/');
  return (
    <Link href={href} prefetch={plain ? false : undefined} aria-current={on ? 'page' : undefined}>
      <span>{children}</span>
      {count ? <span className="count num">{count}</span> : null}
    </Link>
  );
}
