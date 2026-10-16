// Genovus service worker: new-lead alerts only (no caching, so every page is always the live one). A push shows one
// notification per lead; tapping it opens (or focuses) Genovus on Today with that lead, ready to call.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { title: 'Genovus', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(m.title || 'Genovus', {
    body: m.body || '',
    tag: m.tag || undefined,
    renotify: Boolean(m.tag),
    icon: '/brand/genovus/genovus-app-icon.png',
    badge: '/brand/genovus/genovus-egg-icon.svg',
    data: { url: typeof m.url === 'string' && m.url.startsWith('/') ? m.url : '/go' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/go', self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const here = wins.find((w) => new URL(w.url).origin === self.location.origin);
    if (here) { await here.focus(); return here.navigate(url); }
    return self.clients.openWindow(url);
  })());
});
