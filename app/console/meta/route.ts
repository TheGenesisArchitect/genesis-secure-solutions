// Operator page: Genovus's Meta setup status, the values to paste into the App Dashboard, and the checklist.
import { get, list } from '@vercel/blob';
import { consoleAuth } from '@/lib/console-auth';
import { GRAPH_VERSION, connectedPages, inspectToken, metaConfig } from '@/lib/meta';
import { storageConfigured } from '@/lib/progress';
import { META_TEMPLATE } from '@/lib/templates';

export const dynamic = 'force-dynamic';
const HEADERS = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const link = (url: string, label: string) => `<a href="${esc(url)}" target="_blank" rel="noreferrer">${esc(label)} ↗</a>`;

/** Meta pages these steps were checked against on 2026-10-05. */
const DOCS = {
  portfolio: 'https://www.facebook.com/business/help/1710077379203657',
  verification: 'https://developers.facebook.com/docs/development/release/business-verification',
  createApp: 'https://developers.facebook.com/docs/development/create-an-app',
  deletion: 'https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback',
  systemUsers: 'https://developers.facebook.com/docs/marketing-api/system-users/overview',
  webhooks: 'https://developers.facebook.com/docs/graph-api/webhooks/getting-started',
  techProvider: 'https://developers.facebook.com/docs/development/release/tech-providers',
  accessLevels: 'https://developers.facebook.com/docs/graph-api/overview/access-levels',
  login: 'https://developers.facebook.com/docs/facebook-login/facebook-login-for-business',
  pages: 'https://developers.facebook.com/docs/pages-api/overview',
  instagram: 'https://developers.facebook.com/docs/instagram-platform/overview',
  leads: 'https://developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving',
};

async function recentEvents(): Promise<{ count: number; rows: string[] } | null> {
  if (!storageConfigured()) return null;
  try {
    const { blobs } = await list({ prefix: 'meta/events/', limit: 1000 });
    const latest = blobs.sort((a, b) => (a.pathname < b.pathname ? 1 : -1)).slice(0, 5);
    const rows = await Promise.all(
      latest.map(async (b) => {
        const r = await get(b.pathname, { access: 'private', useCache: false }).catch(() => null);
        if (!r || r.statusCode !== 200) return '';
        const rec = JSON.parse(await new Response(r.stream).text()) as { receivedAt: string; object: string; entries: { changes: { field: string | null }[]; messaging: number }[] };
        const fields = [...new Set(rec.entries.flatMap((e) => e.changes.map((c) => c.field || '?')))].join(', ') || (rec.entries.some((e) => e.messaging) ? 'messaging' : '—');
        return `<tr><td>${esc(new Date(rec.receivedAt).toUTCString().replace(' GMT', ' UTC'))}</td><td>${esc(rec.object)}</td><td>${esc(fields)}</td></tr>`;
      }),
    );
    return { count: blobs.length, rows: rows.filter(Boolean) };
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const denied = await consoleAuth(req);
  if (denied) return denied;
  const cfg = metaConfig();
  const origin = new URL(req.url).origin;
  const [token, pages, events] = await Promise.all([
    cfg.systemToken && cfg.appId && cfg.appSecret ? inspectToken(cfg) : Promise.resolve(null),
    cfg.systemToken ? connectedPages(cfg) : Promise.resolve(null),
    recentEvents(),
  ]);

  const st = (ok: boolean, title: string, detail: string) => `<div class="st ${ok ? 'ok' : 'no'}"><b>${esc(title)}</b><span>${detail}</span></div>`;
  const status = [
    st(!!cfg.businessId, 'Business portfolio ID', cfg.businessId ? `Set: ${esc(cfg.businessId)}. Clients see it at their partner step.` : 'Not set. Add GSS_META_BUSINESS_ID in Vercel.'),
    st(!!cfg.appId, 'Meta app', cfg.appId ? `App ID ${esc(cfg.appId)}` : 'Not set. Add META_APP_ID in Vercel.'),
    st(!!cfg.appSecret, 'App secret', cfg.appSecret ? 'Set (never shown)' : 'Not set. Add META_APP_SECRET in Vercel.'),
    st(!!token?.valid, 'System user token', !cfg.systemToken ? 'Not set. Add META_SYSTEM_USER_TOKEN in Vercel.' : token?.valid ? `Valid · ${esc(token.type || 'token')} · expires ${esc(token.expiresAt || '?')} · ${token.scopes.length} permissions` : `Not valid: ${esc(token?.error || 'check app ID and secret')}`),
    st(!!cfg.webhookVerifyToken, 'Webhook verify token', cfg.webhookVerifyToken ? 'Set (never shown)' : 'Not set. Add META_WEBHOOK_VERIFY_TOKEN in Vercel.'),
    st(!!events && events.count > 0, 'Webhook events', events ? `${events.count} received` : 'Storage not connected'),
  ].join('');

  const paste = [
    ['Webhooks · Callback URL', `<code>${esc(origin)}/api/meta/webhooks</code>`],
    ['Webhooks · Verify token', 'The value in <code>.meta-webhook.local</code> in the project folder (also set in Vercel as META_WEBHOOK_VERIFY_TOKEN).'],
    ['App settings · Data deletion callback URL', `<code>${esc(origin)}/api/meta/data-deletion</code>`],
    ['App settings · App icon (1024 × 1024)', `<a href="/brand/genovus/genovus-app-icon.png" download="Genovus-app-icon.png">Download the Genovus app icon</a>`],
    ['App settings · Privacy policy and terms URLs', 'Not published yet. Drafts are in <code>docs/legal/</code> for counsel to approve.'],
  ]
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`)
    .join('');

  let pagesHtml = '<p class="muted">Appears once the system user token is set and our Page is assigned to the system user.</p>';
  if (pages && pages.ok) {
    pagesHtml = pages.data.length
      ? `<div class="scroll"><table class="tbl"><thead><tr><th>Page</th><th>Followers</th><th>Instagram</th></tr></thead><tbody>${pages.data
          .map((p) => `<tr><td>${esc(p.name)}</td><td>${p.followers ?? '—'}</td><td>${p.instagram ? `@${esc(p.instagram.username || p.instagram.id)} · ${p.instagram.followers ?? '—'} followers` : 'Not linked'}</td></tr>`)
          .join('')}</tbody></table></div>`
      : '<p class="muted">The token works but sees no Pages. Assign the Genovus Page to the system user in Business settings.</p>';
  } else if (pages && !pages.ok) pagesHtml = `<p class="muted">Could not read Pages: ${esc(pages.error)}</p>`;

  const eventsHtml = !events
    ? '<p class="muted">Storage is not connected.</p>'
    : events.rows.length
      ? `<div class="scroll"><table class="tbl"><thead><tr><th>Received</th><th>Object</th><th>Fields</th></tr></thead><tbody>${events.rows.join('')}</tbody></table></div><p class="muted">Identifiers only. Lead answers and message text are not stored until the consent-tracked lead pipeline ships.</p>`
      : '<p class="muted">None yet. They appear here once webhooks are subscribed.</p>';

  const steps: [boolean, string, string, string][] = [
    [!!cfg.businessId, 'Create the business portfolio as Genesis Secure Solutions LLC', 'Use the legal name; verification checks it. Its ID is the partner ID clients enter. Run it through the Genovus social setup wizard alongside our Page.', link(DOCS.portfolio, 'Meta: create a business portfolio')],
    [false, 'Verify the business', 'Required for Advanced Access and for letting other businesses connect. Start it from the app: Settings, then Basic, then Verification. Have the legal name, address, phone and a matching website ready.', link(DOCS.verification, 'Meta: business verification')],
    [!!cfg.appId, 'Create the Meta app', 'Pick the use cases for managing Pages, the Instagram API, and Marketing API with lead ads. Use cases cannot be removed later, so choose deliberately. Connect it to our portfolio.', link(DOCS.createApp, 'Meta: create an app')],
    [false, 'Fill in the app settings', 'App icon, contact email, data deletion callback and privacy policy URL (see the table above).', link(DOCS.deletion, 'Meta: data deletion callback')],
    [!!token?.valid, 'Create a system user for our own Page', 'In Business settings, add a system user, assign the Genovus Page and Instagram, and generate a token for our app. Set it in Vercel as META_SYSTEM_USER_TOKEN. Standard Access covers our own assets.', link(DOCS.systemUsers, 'Meta: system users')],
    [!!events && events.count > 0, 'Subscribe to webhooks', 'Add the callback URL and verify token, then subscribe the Page to the fields we need (feed changes, lead ads).', link(DOCS.webhooks, 'Meta: webhooks')],
    [false, 'Become a Tech Provider', 'After business verification, a business admin completes access verification so our app can serve other businesses.', link(DOCS.techProvider, 'Meta: tech providers')],
    [false, 'Pass App Review for Advanced Access', 'Request the permissions below, each with a screencast of how Genovus uses it. Business verification must be done first.', link(DOCS.accessLevels, 'Meta: access levels')],
    [false, 'Set up client onboarding with Facebook Login for Business', 'A configuration with a system-user access token lets each client connect their Page, Instagram and ad account in one consent screen. The token does not expire by default and covers only the assets they pick. Until then, clients keep using partner access.', link(DOCS.login, 'Meta: Facebook Login for Business')],
  ];
  const checklist = steps
    .map(([done, t, d, l]) => `<li class="${done ? 'done' : ''}"><b>${esc(t)}</b><p>${esc(d)}</p>${l}</li>`)
    .join('');

  const perms: [string, string[], string][] = [
    ['Publish, moderate and read insights on client Pages', ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'pages_manage_metadata', 'read_insights'], DOCS.pages],
    ['Instagram through the linked Page', ['instagram_basic', 'instagram_content_publish', 'instagram_manage_comments', 'instagram_manage_insights'], DOCS.instagram],
    ['Lead ads into the platform', ['leads_retrieval', 'pages_manage_ads', 'ads_management', 'pages_show_list', 'pages_read_engagement'], DOCS.leads],
    ['Client business assets', ['business_management'], DOCS.createApp],
  ];
  const permsHtml = perms
    .map(([cap, list, src]) => `<tr><td>${esc(cap)}</td><td><div class="perm">${list.map((p) => `<code>${esc(p)}</code>`).join('')}</div></td><td>${link(src, 'Meta docs')}</td></tr>`)
    .join('');

  const fill: Record<string, string> = { VERSION: esc(GRAPH_VERSION), STATUS: status, PASTE: paste, PAGES: pagesHtml, EVENTS: eventsHtml, CHECKLIST: checklist, PERMS: permsHtml };
  return new Response(META_TEMPLATE.replace(/\{\{([A-Z_]+)\}\}/g, (m, k: string) => (k in fill ? fill[k] : m)), { headers: HEADERS });
}
