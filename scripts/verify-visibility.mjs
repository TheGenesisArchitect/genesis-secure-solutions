// Verify Visibility (migration 0076, lib/visibility-social.ts, lib/visibility.ts, /app/<slug>/visibility):
//  1. the daily pull keeps the agency's own Metricool numbers by day, falling back to the next metric name when
//     Metricool refuses one, and records what didn't answer; a second run inside 12 hours does nothing
//  2. the numbers: social sums over 28 days, followers as the latest count, "before" left blank without history;
//     the lead funnel and sources from Leads; the posting rhythm; the moves the numbers point to
//  3. members read their own agency's numbers, nobody else's
//  4. Helix's brief carries the same numbers, and says what isn't connected
//  5. the board renders with real numbers and blanks (never zeros) for what isn't connected; no sideways scroll
// Preview database only. Run: node --conditions=react-server --env-file=.env.local scripts/verify-visibility.mjs [outDir]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, execSync } from 'node:child_process';
import { register } from 'node:module';
import { createClient } from '@supabase/supabase-js';

if (/prod/i.test(process.env.VERCEL_ENV ?? '')) throw new Error('refusing: production environment');
const OUT = process.argv[2] || path.join(os.tmpdir(), 'genovus-verify'); fs.mkdirSync(OUT, { recursive: true });
const MOCK = 39611, PORT = 3933, ORIGIN = `http://localhost:${PORT}`, SLUG = 'test-launch', BLOG = '7654321', OUTSIDER = 'verify-vis-outsider@genovus.example';
Object.assign(process.env, { METRICOOL_API_BASE: `http://localhost:${MOCK}`, METRICOOL_GENOVUS_API_KEY: 'test' });
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL, ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const db = createClient(URL_, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed++; };

// A stand-in Metricool: 20 days of history. Instagram "followers/account" is refused (the fallback name answers);
// Facebook has no reach metric at all.
const DAYS = 20, asked = [];
const dayAgo = (d) => new Date(Date.now() - d * 86_400_000);
const series = (metric, f) => ({ data: [{ metric, values: Array.from({ length: DAYS }, (_, i) => ({ dateTime: dayAgo(DAYS - 1 - i).toISOString(), value: f(i) })) }] });
const mock = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), q = Object.fromEntries(u.searchParams);
  asked.push(q);
  res.setHeader('content-type', 'application/json');
  const key = `${q.network}:${q.metric}:${q.subject ?? ''}`;
  const S = {
    'instagram:followers_count:account': series('followers_count', (i) => 560 + i),
    'instagram:reach:account': series('reach', () => 10),
    'instagram:views:account': series('views', () => 30),
    'instagram:postsInteractions:account': series('postsInteractions', () => 2),
    'facebook:pageFollows:account': series('pageFollows', (i) => 100 + i),
    'facebook:pageMediaView:account': series('pageMediaView', () => 5),
    'facebook:postsInteractions:account': series('postsInteractions', () => 1),
  }[key];
  if (u.pathname !== '/v2/analytics/timelines' || q.blogId !== BLOG) { res.statusCode = 404; return res.end('{}'); }
  if (!S) { res.statusCode = 400; return res.end(JSON.stringify({ detail: `unknown metric ${q.metric}` })); }
  res.end(JSON.stringify(S));
}).listen(MOCK);

const t = must(await db.from('tenants').select('id').eq('slug', SLUG).single(), 'tenant');
const other = must(await db.from('tenants').select('id').neq('slug', SLUG).eq('is_sample', false).limit(1).single(), 'other');
const users = async () => (await db.auth.admin.listUsers({ perPage: 1000 })).data?.users ?? [];
const clean = async () => {
  for (const id of [t.id, other.id]) { must(await db.from('social_daily').delete().eq('tenant_id', id), 'clear social'); must(await db.from('visibility_pulls').delete().eq('tenant_id', id), 'clear pulls'); }
  must(await db.from('leads').delete().eq('tenant_id', t.id).like('name', 'Verify vis%'), 'clear leads');
  must(await db.from('tenants').update({ metricool_blog_id: null }).eq('id', t.id), 'clear brand');
  must(await db.from('module_grants').delete().eq('tenant_id', t.id).eq('module_key', 'visibility').eq('reason', 'verify-visibility'), 'clear grant');
  for (const x of (await users()).filter((x) => x.email === OUTSIDER)) { await db.from('memberships').delete().eq('user_id', x.id); await db.auth.admin.deleteUser(x.id); }
};
await clean();
must(await db.from('tenants').update({ metricool_blog_id: BLOG }).eq('id', t.id), 'brand');
// Visibility is a Growth module, granted to the test agency for this run (the way staff grant it).
must(await db.from('module_grants').insert({ tenant_id: t.id, module_key: 'visibility', until: new Date(Date.now() + 86_400_000).toISOString(), reason: 'verify-visibility' }), 'grant');

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); if (s.startsWith('@/')) return next(new URL('../' + s.slice(2) + (/\\.[a-z]+$/.test(s) ? '' : '.ts'), ${JSON.stringify(new URL('./', import.meta.url).href)}).href, c); throw e; } }`));
const S = await import('../lib/visibility-social.ts');
const V = await import('../lib/visibility.ts');
const H = await import('../lib/helix-agency.ts');

// 1. the pull (other agencies with a brand are left alone by the run: only this one is due here)
const r1 = await S.runDueSocialPulls(10);
const ours = r1.out?.find((o) => o.tenant === t.id);
const pull = must(await db.from('visibility_pulls').select('ok, detail').eq('tenant_id', t.id).single(), 'pull');
const rows = must(await db.from('social_daily').select('network, metric').eq('tenant_id', t.id), 'rows');
check(ours?.ok && rows.length === DAYS * 7, `the agency’s own numbers are kept by day: ${rows.length} values (7 numbers × ${DAYS} days)`);
check(pull.detail.kept['instagram.followers'] === 'followers_count/account' && asked.some((q) => q.network === 'instagram' && q.metric === 'followers'), 'a metric name Metricool refuses falls back to the next one (Instagram followers)');
check(!rows.some((r) => r.network === 'facebook' && r.metric === 'reach') && !asked.some((q) => q.network === 'facebook' && /reach/i.test(q.metric)), 'Facebook reach isn’t asked for (Meta no longer gives it per page), so nothing is stored as zero');
check(asked.every((q) => q.blogId === BLOG && q.timezone === 'America/New_York'), 'every call is on the agency’s own brand, in office time');
const n1 = asked.length;
await S.runDueSocialPulls(10);
check(asked.length === n1, 'a second run inside 12 hours asks Metricool nothing');

// 2. the numbers
const now = Date.now();
const lead = (name, source, status, hoursAgo, extra = {}) => ({ tenant_id: t.id, name: `Verify vis ${name}`, source, status, created_at: new Date(now - hoursAgo * 3_600_000).toISOString(), consent_text: 'verify', ...extra });
must(await db.from('leads').insert([
  lead('A', 'google', 'won', 100, { first_contact_at: new Date(now - 99.9 * 3_600_000).toISOString(), booked_for: new Date(now - 50 * 3_600_000).toISOString() }),
  lead('B', 'google', 'booked', 80, { first_contact_at: new Date(now - 79.8 * 3_600_000).toISOString(), booked_for: new Date(now + 20 * 3_600_000).toISOString() }),
  lead('C', 'facebook', 'contacted', 60, { first_contact_at: new Date(now - 59.5 * 3_600_000).toISOString() }),
  lead('D', 'direct', 'new', 5),
  lead('E', 'google', 'won', 24 * 40),
]), 'leads');
const asAdmin = db;
const v = await V.visibility(asAdmin, t.id, SLUG);
const mine = (await asAdmin.from('leads').select('id', { count: 'exact', head: true }).eq('tenant_id', t.id).gte('created_at', new Date(now - 28 * 86_400_000).toISOString())).count;
const ourLeads = v.funnel.bySource.reduce((a, g) => a + g.leads, 0);
check(v.social.followers.instagram === 560 + DAYS - 1 && v.social.followers.facebook === 100 + DAYS - 1, `followers are the latest count (Instagram ${v.social.followers.instagram}, Facebook ${v.social.followers.facebook})`);
check(v.social.views.now === DAYS * 35 && v.social.reach.now === DAYS * 10 && v.social.interactions.now === DAYS * 3, `28-day sums: views ${v.social.views.now}, reach ${v.social.reach.now}, interactions ${v.social.interactions.now}`);
check(v.social.views.before === null && v.social.daily.length === DAYS, 'with only 20 days of history the 28 days before are left blank, not zero');
check(ourLeads === mine && v.funnel.leads === mine && v.funnel.won >= 1 && v.funnel.booked >= 2 && v.funnel.reached >= 3, `the funnel counts the last 28 days of leads only (${v.funnel.leads} leads, ${v.funnel.reached} reached, ${v.funnel.booked} booked, ${v.funnel.won} won; the 40-day-old win is left out)`);
check(v.funnel.bySource.find((g) => g.source === 'google')?.won >= 1 && V.sourceLabel('partner') === 'Partner referral', 'leads by where they came from, in plain words');
check(v.moves.some((m) => /Call back \d+ new lead/.test(m.title) && m.href === `/app/${SLUG}/leads`), `the moves follow the numbers: a lead waiting over an hour comes first (${v.moves.map((m) => m.title).join(' | ')})`);

// 3. who can read
const signedIn = async (email) => { const link = must(await db.auth.admin.generateLink({ type: 'magiclink', email }), 'link'); const c = createClient(URL_, ANON, { auth: { persistSession: false } }); must(await c.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' }), 'sign in'); return c; };
const owner = await signedIn(`owner@${SLUG}.example`);
const outsiderUser = must(await db.auth.admin.createUser({ email: OUTSIDER, email_confirm: true }), 'outsider').user;
must(await db.from('memberships').insert({ tenant_id: other.id, user_id: outsiderUser.id, role: 'staff' }), 'outsider membership');
const outsider = await signedIn(OUTSIDER);
const a = (await owner.from('social_daily').select('day').eq('tenant_id', t.id)).data ?? [];
const b = (await outsider.from('social_daily').select('day').eq('tenant_id', t.id)).data ?? [];
const c = (await outsider.from('visibility_pulls').select('ok').eq('tenant_id', t.id)).data ?? [];
const w = await owner.from('social_daily').insert({ tenant_id: t.id, network: 'facebook', metric: 'views', day: '2020-01-01', value: 9 });
check(a.length === DAYS * 7 && b.length === 0 && c.length === 0 && w.error, 'the agency reads its own numbers; another agency’s member reads none; nobody signed in can write them');

// 4. Helix's brief
const brief = await H.agencyBrief(owner, t.id, 'Test Launch Agency', 'Growth');
const line = brief.split('\n').find((l) => l.startsWith('VISIBILITY'));
check(line && line.includes(`Instagram ${(560 + DAYS - 1).toLocaleString('en-US')}`) && line.includes(`views ${(DAYS * 35).toLocaleString('en-US')}`) && /Not connected yet: Google search positions/.test(line), `Helix’s brief carries the board’s numbers and what isn’t connected (${line?.slice(0, 140)}…)`);

// 5. the board
const up = async () => { try { return (await fetch(ORIGIN, { redirect: 'manual' })).status > 0; } catch { return false; } };
const dev = spawn('npx', ['next', 'dev', '-p', String(PORT)], { stdio: 'ignore', shell: true, env: { ...process.env, GOOGLE_PLACES_API_KEY: '' } });
for (let i = 0; i < 120 && !(await up()); i++) await sleep(1000);
const link = must(await db.auth.admin.generateLink({ type: 'magiclink', email: `owner@${SLUG}.example` }), 'browser link');
const port = 9541, profile = fs.mkdtempSync(path.join(os.tmpdir(), 'genovus-verify-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
let list; for (let i = 0; i < 60; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (list.find((x) => x.type === 'page')) break; } catch {} await sleep(250); }
const ws = new WebSocket(list.find((x) => x.type === 'page').webSocketDebuggerUrl);
let id = 0; const pend = new Map(), on = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method) on.get(m.method)?.(m.params); };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send('Page.enable');
const go = async (u) => { const l = new Promise((r) => on.set('Page.loadEventFired', r)); await send('Page.navigate', { url: ORIGIN + u }); await l; await sleep(1500); };
const shot = async (name) => { const m = (await send('Page.getLayoutMetrics')).result.cssContentSize; const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: m.width, height: Math.min(m.height, 4000), scale: 1 } }); fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(s.result.data, 'base64')); };
try {
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
  await go(`/auth/continue?t=${encodeURIComponent(link.properties.hashed_token)}&next=${encodeURIComponent(`/app/${SLUG}`)}`);
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Continue/.test(x.textContent)); b && b.click(); })()`);
  for (let i = 0; i < 80 && (await ev('location.pathname')) !== `/app/${SLUG}`; i++) await sleep(250);
  await go(`/app/${SLUG}/visibility`);
  for (let i = 0; i < 40 && !(await ev(`!!document.querySelector('.vis-loop')`)); i++) await sleep(500);
  const text = await ev('document.body.innerText');
  check(/Visibility/.test(await ev(`[...document.querySelectorAll('nav a')].map((a) => a.textContent).join(' ')`)), 'Visibility is on the agency menu');
  check(text.includes((DAYS * 35).toLocaleString('en-US')) && text.includes(`${(560 + DAYS - 1) + (100 + DAYS - 1)}`) && /Call back \d+ new lead/.test(text), 'the board shows the real views, followers and the first move');
  check(/Found\s*not measured yet/i.test(text) && /needs a priced yes/i.test(text) && /needs access to Search Console/i.test(text) && !/Found[\s\S]{0,40}\b0\b/.test(text.slice(0, 400)), 'what isn’t connected says what it needs, and shows a blank, not a zero');
  check(await ev(`!!document.querySelector('.vis-chart svg path')`), 'the daily views and reach chart draws');
  await shot('visibility-desktop');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await go(`/app/${SLUG}/visibility`);
  check(!(await ev('document.documentElement.scrollWidth > innerWidth')), 'no sideways scroll at phone width');
  await shot('visibility-phone');
} finally {
  ws.close(); chrome.kill();
  try { execSync(`for /f "tokens=5" %a in ('netstat -ano ^| findstr :${PORT} ^| findstr LISTENING') do taskkill /F /T /PID %a`, { shell: 'cmd.exe', stdio: 'ignore' }); } catch {}
  dev.kill();
  await clean();
  mock.close();
}
console.log(`screenshots in ${OUT} | ${failed ? `${failed} failed` : 'all passed'}`);
process.exit(failed ? 1 : 0);
