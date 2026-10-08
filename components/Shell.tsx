// The dashboard frame shared by the console, agency and network surfaces: brand, rail, top bar, content.
// On phones the rail slides in from a checkbox toggle, so it works without client JavaScript.
import Link from 'next/link';
import { NavLink } from './NavLink';

export type NavItem = { href: string; label: string; exact?: boolean; count?: number; plain?: boolean };
export type NavSection = { title?: string; items: NavItem[] };

export function Shell(props: {
  surface: string;
  home: string;
  nav: NavSection[];
  title: string;
  crumbs?: { href?: string; label: string }[];
  actions?: React.ReactNode;
  who: { name: string; detail: string };
  switcher?: React.ReactNode;
  /** A one-tap way home for the team when they are inside an agency or carrier workspace. */
  back?: { href: string; label: string };
  children: React.ReactNode;
}) {
  const crumbs = props.crumbs ?? [];
  return (
    <div className="dash">
      <input type="checkbox" id="nav-open" className="sr" aria-hidden="true" tabIndex={-1} />
      <aside className="rail" aria-label="Main navigation">
        <Link href={props.home} className="brand">
          <img src="/brand/genovus/genovus-mark.svg" alt="" />
          <span>
            <b>GENOVUS</b>
            <small>{props.surface}</small>
          </span>
        </Link>
        {props.switcher}
        <nav className="nav">
          {props.nav.map((s, i) => (
            <div key={i} style={{ display: 'grid', gap: 2 }}>
              {s.title ? <h4>{s.title}</h4> : null}
              {s.items.map((it) => (
                <NavLink key={it.href} href={it.href} exact={it.exact} count={it.count} plain={it.plain}>
                  {it.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="who">
          <div>
            <div style={{ color: 'var(--ink)', fontWeight: 600 }}>{props.who.name}</div>
            <div>{props.who.detail}</div>
          </div>
          <form action="/auth/signout" method="post">
            <button className="btn small ghost" type="submit">Sign out</button>
          </form>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="row" style={{ gap: 12, minWidth: 0, flexWrap: 'nowrap' }}>
            <label htmlFor="nav-open" className="btn small ghost menu-toggle" aria-label="Open menu">Menu</label>
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
          {props.actions ? <div className="row">{props.actions}</div> : null}
        </header>
        <main className="content">{props.children}</main>
      </div>
    </div>
  );
}
