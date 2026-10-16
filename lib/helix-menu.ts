'use client';
// Teach the menu as Helix moves around: before Helix opens a page, the menu slides out and the page's place in it
// lights up ("Pipeline · in your menu"), then Helix goes there. People learn where everything lives instead of being
// teleported. Once someone has seen a page's place a few times, Helix goes straight there.
const KEY = 'helix-menu-taught';
const TIMES = 3;
const counts = (): Record<string, number> => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Show where `href` lives in the menu (if it's there and still worth teaching), then navigate with `go`. */
export async function goViaMenu(href: string, go: () => void, label?: string): Promise<void> {
  const link = [...document.querySelectorAll<HTMLAnchorElement>('.rail a')].find((a) => a.getAttribute('href') === href);
  const seen = counts();
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!link || (seen[href] ?? 0) >= TIMES || location.pathname === href) { go(); return; }
  try { localStorage.setItem(KEY, JSON.stringify({ ...seen, [href]: (seen[href] ?? 0) + 1 })); } catch {}

  // Out of the way: Helix's drawer covers the menu on a phone. It keeps listening while minimized.
  const helixWasOpen = !!document.querySelector('.helix-drawer:not([hidden])');
  if (helixWasOpen) window.dispatchEvent(new CustomEvent('genovus:helix-dock', { detail: { state: 'min' } }));
  // Slide the menu out: the phone drawer opens; a collapsed rail expands for the moment.
  const phone = document.getElementById('nav-open') as HTMLInputElement | null;
  const dash = document.querySelector<HTMLElement>('.dash');
  const narrow = window.matchMedia('(max-width: 760px)').matches;
  const wasCollapsed = dash?.getAttribute('data-rail') === 'collapsed';
  if (narrow && phone) phone.checked = true;
  if (!narrow && wasCollapsed) dash?.setAttribute('data-rail', 'open');
  link.scrollIntoView({ block: 'nearest' });
  link.setAttribute('data-teach', `${label ?? link.textContent?.trim() ?? ''} · in your menu`);
  link.classList.add('menu-teach');
  await sleep(reduce ? 500 : 1300);
  go();
  await sleep(reduce ? 200 : 450);
  link.classList.remove('menu-teach');
  link.removeAttribute('data-teach');
  if (narrow && phone) phone.checked = false;
  if (!narrow && wasCollapsed) dash?.setAttribute('data-rail', 'collapsed');
  // Desktop: Helix comes back beside the page. Phone: it stays minimized so the page shows (tap to reopen).
  if (helixWasOpen && !narrow) window.dispatchEvent(new CustomEvent('genovus:helix-dock', { detail: { state: 'open' } }));
}
