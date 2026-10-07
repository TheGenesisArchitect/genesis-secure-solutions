'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** A rail link that marks itself current. `exact` for section roots so children don't light them up. */
export function NavLink({ href, exact, count, children }: { href: string; exact?: boolean; count?: number; children: React.ReactNode }) {
  const path = usePathname();
  const on = exact ? path === href : path === href || path.startsWith(href + '/');
  return (
    <Link href={href} aria-current={on ? 'page' : undefined}>
      <span>{children}</span>
      {count ? <span className="count num">{count}</span> : null}
    </Link>
  );
}
