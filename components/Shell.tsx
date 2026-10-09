// The dashboard frame shared by the console, agency and network surfaces: brand, rail, top bar, content.
// On phones the rail slides in from a checkbox toggle, so it works without client JavaScript. On wider screens
// it collapses to an icon strip (button or "["), remembered in a cookie the server reads; Ctrl/⌘K jumps anywhere.
import Link from 'next/link';
import { cookies } from 'next/headers';
import { NavLink } from './NavLink';
import { Wordmark } from './Wordmark';
import { Icon, iconFor } from './icons';
import { RailToggle, CommandBar, type JumpItem } from './RailControls';

export type NavItem = { href: string; label: string; exact?: boolean; count?: number; plain?: boolean; icon?: string };
export type NavSection = { title?: string; items: NavItem[] };

export async function Shell(props: {
  surface: string;
  home: string;
  nav: NavSection[];
  title: string;
  crumbs?: { href?: string; label: string }[];
  actions?: React.ReactNode;
  who: { name: string; detail: string; signedOut?: boolean };
  switcher?: React.ReactNode;
  /** Ctrl/⌘K also searches clients and agencies (row-level security decides what comes back). */
  searchClients?: boolean;
  /** A one-tap way home for the team when they are inside an agency or carrier workspace. */
  back?: { href: string; label: string };
  children: React.ReactNode;
}) {
  const crumbs = props.crumbs ?? [];
  const collapsed = (await cookies()).get('rail')?.value === 'collapsed';
  const jump: JumpItem[] = props.nav.flatMap((s) => s.items.map((it) => ({ label: it.label, href: it.href, group: s.title ?? props.surface, icon: it.icon ?? iconFor(it.label, it.href) })));
  if (props.back) jump.unshift({ label: props.back.label, href: props.back.href, group: 'Go back', icon: 'building' });
  return (
    <div className="dash" data-rail={collapsed ? 'collapsed' : 'open'}>
      <input type="checkbox" id="nav-open" className="sr" aria-hidden="true" tabIndex={-1} />
      <aside className="rail" aria-label="Main navigation">
        <div className="rail-head">
        <Link href={props.home} className="brand">
          <img className="brand-egg" src="/brand/genovus/genovus-egg.svg" alt="" />
          <span>
            <Wordmark size={17} />
            <small>{props.surface}</small>
          </span>
        </Link>
        <RailToggle collapsed={collapsed} />
        </div>
        <div className="rail-switcher">{props.switcher}</div>
        <nav className="nav">
          {props.nav.map((s, i) => (
            <div key={i} style={{ display: 'grid', gap: 2 }}>
              {s.title ? <h4>{s.title}</h4> : null}
              {s.items.map((it) => (
                <NavLink key={it.href} href={it.href} exact={it.exact} count={it.count} plain={it.plain} icon={it.icon ?? iconFor(it.label, it.href)}>
                  {it.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="who">
          <div className="who-text">
            <div style={{ color: 'var(--ink)', fontWeight: 600 }}>{props.who.name}</div>
            <div>{props.who.detail}</div>
          </div>
          {props.who.signedOut ? null : (
            <form action="/auth/signout" method="post">
              <button className="btn small ghost signout" type="submit" title="Sign out"><Icon name="signout" size={16} /><span>Sign out</span></button>
            </form>
          )}
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <Link href={props.home} className="mobile-brand" aria-label="Genovus home"><Wordmark size={18} /></Link>
          <div className="row topbar-title" style={{ gap: 12, minWidth: 0, flexWrap: 'nowrap' }}>
            {props.back ? <Link href={props.back.href} className="back-home" title={`Back to ${props.back.label}`}><span aria-hidden="true">←</span> {props.back.label}</Link> : null}
            <div style={{ minWidth: 0 }}>
              {crumbs.length ? (
                <div className="crumbs">
                  {crumbs.map((c, i) => (
                    <span key={i}>
                      {c.href ? <Link href={c.href}>{c.label}</Link> : c.label}
                      {i < crumbs.length - 1 ? ' / ' : ''}
                    </span>
                  ))}
                </div>
              ) : null}
              <h1>{props.title}</h1>
            </div>
          </div>
          {props.actions ? <div className="row topbar-extra">{props.actions}</div> : null}
          <div className="row topbar-actions">
            <CommandBar items={jump} searchClients={Boolean(props.searchClients)} />
            <label htmlFor="nav-open" className="btn small ghost menu-toggle" aria-label="Open menu"><Icon name="menu" size={18} /><span>Menu</span></label>
          </div>
        </header>
        <main className="content">{props.children}</main>
      </div>
    </div>
  );
}
