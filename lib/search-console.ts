// Google Search Console, read only, server only: how an agency's own site shows up in Google. Genovus signs in as a
// service account (GSC_SERVICE_ACCOUNT, the JSON key; never sent to the browser), which each agency's property adds
// as a restricted user. Once a day per agency: clicks, impressions and average position by day (search_daily), the
// top searches of the last 28 days (kept on the pull record), and whether each page in the site's sitemap is in
// Google (URL inspection, search_pages). What didn't answer is recorded, so the board says so instead of showing 0.
import 'server-only';
import { createSign } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminDb } from '@/lib/supabase/admin';

type Key = { client_email: string; private_key: string };
const DAY = 86_400_000;

function key(): Key | null {
  const raw = (process.env.GSC_SERVICE_ACCOUNT || '').trim();
  if (!raw) return null;
  try {
    const k = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')) as Partial<Key>;
    return k.client_email && k.private_key ? { client_email: k.client_email, private_key: k.private_key } : null;
  } catch {
    return null;
  }
}
export const searchConsoleConfigured = () => key() !== null;
/** The address an agency adds in Search Console (Settings → Users and permissions → Add user, Restricted). Not secret. */
export const searchConsoleUser = () => key()?.client_email ?? null;

let cached: { token: string; until: number } | null = null;
async function token(): Promise<string> {
  if (cached && cached.until > Date.now() + 60_000) return cached.token;
  const k = key();
  if (!k) throw new Error('Search Console is not configured');
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: k.client_email, scope: 'https://www.googleapis.com/auth/webmasters.readonly', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const sig = createSign('RSA-SHA256').update(unsigned).sign(k.private_key, 'base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
    signal: AbortSignal.timeout(10_000),
  });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!r.ok || !j.access_token) throw new Error(`Google sign-in failed: ${j.error_description ?? r.status}`);
  cached = { token: j.access_token, until: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return j.access_token;
}

async function call<T>(url: string, body: object): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  try {
    const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${await token()}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
    const j = (await r.json().catch(() => ({}))) as T & { error?: { message?: string } };
    return r.ok ? { ok: true, data: j } : { ok: false, status: r.status, error: j.error?.message ?? `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : 'request failed' };
  }
}

/** The site's home address for a property: "sc-domain:example.com" → https://example.com/. */
export const siteHome = (property: string) => (property.startsWith('sc-domain:') ? `https://${property.slice(10)}/` : property);
const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);

/** The page addresses in the site's sitemap (at most `max`). */
async function sitemapUrls(home: string, max = 40): Promise<string[]> {
  try {
    const r = await fetch(new URL('/sitemap.xml', home), { signal: AbortSignal.timeout(10_000), redirect: 'follow' });
    if (!r.ok) return [];
    const xml = await r.text();
    return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&')).filter((u) => u.startsWith('https://')).slice(0, max);
  } catch {
    return [];
  }
}

export type TopQuery = { query: string; clicks: number; impressions: number; position: number };

/** Pull one agency: the last `days` days of search numbers, its top searches and its pages' index status. */
export async function pullSearch(tenantId: string, property: string, days = 35) {
  const db = adminDb();
  const site = encodeURIComponent(property);
  const errors: string[] = [];
  // Search Console's numbers settle about two days behind.
  const end = ymd(Date.now() - 2 * DAY), start = ymd(Date.now() - (days + 2) * DAY), start28 = ymd(Date.now() - 30 * DAY);
  let rows = 0;
  const daily = await call<{ rows?: { keys: string[]; clicks: number; impressions: number; position: number }[] }>(
    `https://www.googleapis.com/webmasters/v3/sites/${site}/searchAnalytics/query`, { startDate: start, endDate: end, dimensions: ['date'], rowLimit: 500 });
  if (daily.ok) {
    const up = (daily.data.rows ?? []).map((r) => ({ tenant_id: tenantId, day: r.keys[0], clicks: Math.round(r.clicks), impressions: Math.round(r.impressions), position: Math.round(r.position * 10) / 10, pulled_at: new Date().toISOString() }));
    if (up.length) { const w = await db.from('search_daily').upsert(up, { onConflict: 'tenant_id,day' }); if (w.error) errors.push(`daily: ${w.error.message}`); else rows = up.length; }
  } else errors.push(`searches: ${daily.error}`);
  let top: TopQuery[] = [];
  const q = await call<{ rows?: { keys: string[]; clicks: number; impressions: number; position: number }[] }>(
    `https://www.googleapis.com/webmasters/v3/sites/${site}/searchAnalytics/query`, { startDate: start28, endDate: end, dimensions: ['query'], rowLimit: 10 });
  if (q.ok) top = (q.data.rows ?? []).map((r) => ({ query: r.keys[0], clicks: Math.round(r.clicks), impressions: Math.round(r.impressions), position: Math.round(r.position * 10) / 10 }));
  // Pages: Google's own answer for each page in the sitemap (the inspection quota is 2,000 a day per property).
  const urls = daily.ok ? await sitemapUrls(siteHome(property)) : [];
  let inspected = 0;
  for (const url of urls) {
    const r = await call<{ inspectionResult?: { indexStatusResult?: { verdict?: string; coverageState?: string; lastCrawlTime?: string } } }>(
      'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', { inspectionUrl: url, siteUrl: property });
    if (!r.ok) { errors.push(`inspect ${url}: ${r.error}`); if (r.status === 403 || r.status === 429) break; continue; }
    const s = r.data.inspectionResult?.indexStatusResult ?? {};
    const w = await db.from('search_pages').upsert({ tenant_id: tenantId, url, indexed: s.verdict === 'PASS', verdict: s.verdict ?? null, coverage: s.coverageState ?? null, last_crawl: s.lastCrawlTime ?? null, inspected_at: new Date().toISOString() }, { onConflict: 'tenant_id,url' });
    if (!w.error) inspected++;
  }
  // Pages no longer in the sitemap drop off, so "x of y in Google" counts today's site.
  if (urls.length && inspected) await db.from('search_pages').delete().eq('tenant_id', tenantId).not('url', 'in', `(${urls.map((u) => `"${u}"`).join(',')})`);
  const ok = daily.ok;
  await db.from('visibility_pulls').upsert({ tenant_id: tenantId, source: 'search_console', pulled_at: new Date().toISOString(), ok, detail: { rows, top, pages: urls.length, inspected, errors: errors.slice(0, 6) } }, { onConflict: 'tenant_id,source' });
  return { ok, rows, pages: urls.length, inspected, errors: errors.slice(0, 6) };
}

/** Every agency with a property, at most once a day; one per run (inspection takes a while). */
export async function runDueSearchPulls(max = 1) {
  if (!searchConsoleConfigured()) return { skipped: 'search console not configured' };
  const db = adminDb();
  const { data: ts } = await db.from('tenants').select('id, search_console_site').not('search_console_site', 'is', null).eq('is_sample', false);
  const { data: last } = await db.from('visibility_pulls').select('tenant_id, pulled_at').eq('source', 'search_console');
  const at = new Map((last ?? []).map((p) => [p.tenant_id as string, Date.parse(p.pulled_at as string)]));
  const due = (ts ?? []).filter((t) => (at.get(t.id as string) ?? 0) < Date.now() - 22 * 3_600_000).slice(0, max);
  const out = [];
  for (const t of due) out.push({ tenant: t.id, ...(await pullSearch(t.id as string, t.search_console_site as string)) });
  return { pulled: out.length, out };
}

export type SearchNow = {
  connected: boolean;
  pulledAt: string | null;
  error: string | null;
  /** Last 28 days with data, and the 28 before when there is history that far back. */
  clicks: { now: number | null; before: number | null };
  impressions: { now: number | null; before: number | null };
  pages: { indexed: number; total: number } | null;
  top: TopQuery[];
};


/** What the board, Helix and check-backs read. Works with the viewer's own session (row-level security) or admin. */
export async function searchNow(db: SupabaseClient, tenantId: string, since?: string): Promise<SearchNow> {
  const [t, pull, days, pages] = await Promise.all([
    db.from('tenants').select('search_console_site').eq('id', tenantId).maybeSingle(),
    db.from('visibility_pulls').select('pulled_at, ok, detail').eq('tenant_id', tenantId).eq('source', 'search_console').maybeSingle(),
    db.from('search_daily').select('day, clicks, impressions').eq('tenant_id', tenantId).gte('day', ymd(Date.now() - 70 * DAY)).order('day'),
    db.from('search_pages').select('indexed').eq('tenant_id', tenantId),
  ]);
  const D = (days.data ?? []) as { day: string; clicks: number; impressions: number }[];
  const last = D.at(-1)?.day;
  const cut = last ? ymd(Date.parse(`${last}T12:00:00Z`) - 27 * DAY) : null, cut2 = cut ? ymd(Date.parse(`${cut}T12:00:00Z`) - 28 * DAY) : null;
  const from = since ? since.slice(0, 10) : cut;
  const sum = (k: 'clicks' | 'impressions', a: string | null, b?: string | null) => { if (!a) return null; const v = D.filter((d) => d.day >= a && (!b || d.day < b)); return v.length ? v.reduce((s, d) => s + d[k], 0) : null; };
  const hasBefore = Boolean(cut2 && D[0] && D[0].day <= cut2);
  const p = pull.data as { pulled_at: string; ok: boolean; detail: { top?: TopQuery[]; errors?: string[] } } | null;
  const P = (pages.data ?? []) as { indexed: boolean }[];
  return {
    connected: Boolean((t.data as { search_console_site?: string | null } | null)?.search_console_site),
    pulledAt: p?.pulled_at ?? null,
    error: p && !p.ok ? (p.detail?.errors?.[0] ?? 'Search Console had no numbers yet') : null,
    clicks: { now: sum('clicks', from), before: !since && hasBefore ? sum('clicks', cut2, cut) : null },
    impressions: { now: sum('impressions', from), before: !since && hasBefore ? sum('impressions', cut2, cut) : null },
    pages: P.length ? { indexed: P.filter((x) => x.indexed).length, total: P.length } : null,
    top: p?.detail?.top ?? [],
  };
}
