// The agency's own social numbers for Visibility, server only: once a day per agency, its Metricool brand's
// followers, reach, views and interactions on Facebook and Instagram, kept by day (social_daily). Metricool names
// metrics differently per network and has renamed some, so each number tries a short list of names and keeps the
// first that answers; what answered is recorded (visibility_pulls) so the board shows "not available", never zero.
import 'server-only';
import { adminDb } from '@/lib/supabase/admin';
import { mc, metricoolConfigured } from '@/lib/metricool';

type Net = 'facebook' | 'instagram';
type Metric = 'followers' | 'reach' | 'views' | 'interactions';
type Try = { metric: string; subject?: string };

// Candidates in order (Metricool's analytics API, /v2/analytics/timelines). The first with values wins.
export const CANDIDATES: Record<Net, Partial<Record<Metric, Try[]>>> = {
  instagram: {
    followers: [{ metric: 'followers', subject: 'account' }, { metric: 'followers_count', subject: 'account' }],
    reach: [{ metric: 'reach', subject: 'account' }, { metric: 'reach', subject: 'posts' }],
    views: [{ metric: 'views', subject: 'account' }, { metric: 'impressions', subject: 'posts' }],
    interactions: [{ metric: 'postsInteractions', subject: 'account' }, { metric: 'interactions', subject: 'posts' }],
  },
  facebook: {
    followers: [{ metric: 'pageFollows', subject: 'account' }, { metric: 'fbFollowers' }, { metric: 'pageFollows' }],
    views: [{ metric: 'pageMediaView', subject: 'account' }, { metric: 'pageMediaView' }, { metric: 'page_posts_impressions', subject: 'account' }],
    interactions: [{ metric: 'postsInteractions', subject: 'account' }, { metric: 'postsInteractions' }, { metric: 'interactions', subject: 'posts' }],
  },
};

type Series = { metric?: string; values?: { dateTime?: string; value?: number | null }[] }[];
const DAY = 86_400_000;
const nyDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const stamp = (d: Date) => d.toLocaleString('sv-SE', { timeZone: 'America/New_York' }).replace(' ', 'T');

/** Pull one agency's last `days` days. Returns what was kept and what didn't answer. */
export async function pullSocial(tenantId: string, blogId: string, days = 35) {
  const db = adminDb();
  const to = new Date(), from = new Date(Date.now() - days * DAY);
  const kept: Record<string, string> = {}, missing: string[] = [], errors: string[] = [];
  let rows = 0;
  for (const net of Object.keys(CANDIDATES) as Net[]) {
    for (const [metric, tries] of Object.entries(CANDIDATES[net]) as [Metric, Try[]][]) {
      let done = false;
      for (const t of tries) {
        const r = await mc<{ data?: Series }>('/v2/analytics/timelines', { blogId, query: { network: net, metric: t.metric, from: stamp(from), to: stamp(to), timezone: 'America/New_York', ...(t.subject ? { subject: t.subject } : {}) } });
        if (!r.ok) { if (r.status !== 400 && r.status !== 404) errors.push(`${net} ${t.metric}: ${r.error}`); continue; }
        const values = (r.data?.data ?? []).flatMap((s) => s.values ?? []).filter((v) => v.dateTime && v.value != null && Number.isFinite(Number(v.value)));
        if (!values.length) continue;
        const byDay = new Map<string, number>();
        for (const v of values) byDay.set(nyDay(v.dateTime!), Number(v.value));
        const up = await db.from('social_daily').upsert([...byDay].map(([day, value]) => ({ tenant_id: tenantId, network: net, metric, day, value, pulled_at: new Date().toISOString() })), { onConflict: 'tenant_id,network,metric,day' });
        if (up.error) { errors.push(`${net} ${metric}: ${up.error.message}`); break; }
        kept[`${net}.${metric}`] = `${t.metric}${t.subject ? `/${t.subject}` : ''}`;
        rows += byDay.size; done = true;
        break;
      }
      if (!done) missing.push(`${net}.${metric}`);
    }
  }
  const ok = rows > 0;
  await db.from('visibility_pulls').upsert({ tenant_id: tenantId, source: 'metricool', pulled_at: new Date().toISOString(), ok, detail: { kept, missing, errors: errors.slice(0, 6), rows } }, { onConflict: 'tenant_id,source' });
  return { ok, rows, kept, missing, errors };
}

/** Every agency with a Metricool brand, pulled at most once every 12 hours; a few per run. */
export async function runDueSocialPulls(max = 3) {
  if (!metricoolConfigured()) return { skipped: 'metricool not configured' };
  const db = adminDb();
  const { data: ts } = await db.from('tenants').select('id, metricool_blog_id').not('metricool_blog_id', 'is', null).eq('is_sample', false);
  const { data: last } = await db.from('visibility_pulls').select('tenant_id, pulled_at').eq('source', 'metricool');
  const at = new Map((last ?? []).map((p) => [p.tenant_id as string, Date.parse(p.pulled_at as string)]));
  const due = (ts ?? []).filter((t) => (at.get(t.id as string) ?? 0) < Date.now() - 12 * 3_600_000).slice(0, max);
  const out = [];
  for (const t of due) out.push({ tenant: t.id, ...(await pullSocial(t.id as string, t.metricool_blog_id as string)) });
  return { pulled: out.length, out: out.map((o) => ({ tenant: o.tenant, ok: o.ok, rows: o.rows, missing: o.missing })) };
}
