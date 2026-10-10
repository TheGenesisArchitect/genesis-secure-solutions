'use client';
// Genovus Mobile's tab bar for an agency on a phone: Today · Leads · Follow-ups · More (opens the full menu).
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from './icons';

export function AgencyTabBar({ base, film }: { base: string; film?: boolean }) {
  const path = usePathname();
  const q = film ? '?film=1' : '';
  const tab = (href: string, label: string, icon: string) => (
    <Link href={`${href}${q}`} aria-current={path === href ? 'page' : undefined}><Icon name={icon} size={22} />{label}</Link>
  );
  return (
    <>
      <div className="tabbar-spacer" aria-hidden="true" />
      <nav className="tabbar" aria-label="Genovus Mobile">
        {tab(`${base}/today`, 'Today', 'home')}
        {tab(`${base}/leads`, 'Leads', 'inbox')}
        {tab(`${base}/follow-ups`, 'Follow-ups', 'check')}
        <label htmlFor="nav-open"><Icon name="menu" size={22} />More</label>
      </nav>
    </>
  );
}
