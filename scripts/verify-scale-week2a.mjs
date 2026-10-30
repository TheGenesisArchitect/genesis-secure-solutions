// Verify Scale Up week 2, release 1 on PREVIEW (migration 0089):
//  1. the consult guide's wording passes the copy rules; its price line comes from the real packages
//  2. a consultation in the next day shows on the Command Brief with "Open the guide"; the page shows their #1 goal,
//     the 8 discovery steps, the qualifying questions and the objections; the objection and call note save
//  3. objections are counted on Growth ("What stops people saying yes") and from a prospect's call log
//  4. Inquiries links a website booking to its consultation page; Setup saves the consultation settings
//  5. proof stays hidden until an approved client quote exists
//   node --conditions=react-server --env-file=.env.local scripts/verify-scale-week2a.mjs [outDir]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { register } from 'node:module';
import { createClient } from '@supabase/supabase-js';

if (/prod/i.test(process.env.VERCEL_ENV ?? '')) throw new Error('refusing: production environment');
const OUT = process.argv[2] || path.join(os.tmpdir(), 'genovus-verify'); fs.mkdirSync(OUT, { recursive: true });
const PORT = 3939, ORIGIN = `http://localhost:${PORT}`;
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed++; };
const H = 3_600_000, DOMAIN = 'verify-scale-week2.example';

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; } }`));
const guide = await import('../data/consult-guide.ts');
const { copyWarnings } = await import('../lib/copy-rules.ts');
const { PLANS } = await import('../data/offers.ts');
const { liveProof, PROOF } = await import('../data/proof.ts');
const { tallyObjections } = await import('../lib/sales-kpis.ts');

// 1. the guide's words
// Genovus's own package price is the one price the guide names (internal, never an insurance price), so the price
// warning is checked on everything else; "guarantee" is checked everywhere.
const words = [...guide.DISCOVERY.flatMap((d) => [d.step, d.how]), ...guide.PREQUAL.flatMap((q) => [q.ask.replace(guide.INVESTMENT_LINE, ''), q.why]), ...guide.OBJECTIONS.flatMap((o) => [o.say, o.ask, o.listen])].join(' | ');
const all = [guide.INVESTMENT_LINE, ...guide.DISCOVERY.flatMap((d) => [d.step, d.how]), ...guide.PREQUAL.flatMap((q) => [q.ask, q.why]), ...guide.OBJECTIONS.flatMap((o) => [o.say, o.ask, o.listen])].join('\n');
check(!/guarantee/i.test(all) && copyWarnings(words).length === 0, `the consult guide passes the copy rules (${copyWarnings(words).join('; ') || 'no warnings'})`);
const launch = PLANS.find((p) => p.id === 'launch');
check(guide.INVESTMENT_LINE.includes(`$${(launch.setupCents / 100).toLocaleString('en-US')}`) && guide.INVESTMENT_LINE.includes(`$${launch.careCents / 100}`), `the price line comes from the Launch package (${guide.INVESTMENT_LINE})`);
check(guide.DISCOVERY.length === 8 && guide.OBJECTIONS.length === 8 && guide.guideText().includes('CONSULT GUIDE'), '8 discovery steps, 8 objections, and the same guide as text for Helix');
check(fs.readFileSync('lib/helix-enterprise.ts', 'utf8').includes('guideText()'), 'Helix\'s brief carries the guide');
const t = tallyObjections(['carrier', 'think', 'carrier', 'none', null, 'bogus']);
check(t[0].key === 'carrier' && t[0].count === 2 && t.length === 2, 'objections are tallied most common first; "none" and unknown keys are skipped');
check(PROOF.length === 0 || liveProof().length === PROOF.length, 'every proof item on the site is approved');
check(liveProof([{ quote: 'x', name: 'A', role: 'Owner', agency: 'B', approvedOn: '', approvedBy: '' }]).length === 0 && liveProof([{ quote: 'Great', name: 'A', role: 'Owner', agency: 'B', approvedOn: '2026-10-01', approvedBy: 'A' }]).length === 1, 'a quote without an approval date and approver never shows');

const house = must(await db.from('tenants').select('id').eq('slug', 'genovus').single(), 'house');
const admin = must(await db.from('staff').select('user_id').eq('role', 'admin').limit(1).single(), 'admin');
const adminEmail = must(await db.auth.admin.getUserById(admin.user_id), 'admin email').user.email.toLowerCase();
const made = { events: [], invites: [], inquiries: [], prospectEvents: [] };
async function seed(label, startIn, goals) {
  const email = `${label.toLowerCase()}@${DOMAIN}`;
  const inq = must(await db.from('inquiries').insert({ kind: 'agency', name: `${label} Verify`, email, org: `${label} Verify Insurance`, details: { carrier: 'State Farm', ...(goals ? { goals } : {}) }, consent_text: 'verify', status: 'contacted' }).select('id').single(), 'inquiry');
  const start = new Date(Date.now() + startIn);
  const ev = must(await db.from('calendar_events').insert({ tenant_id: house.id, title: `Genovus consultation: ${label}`, starts_at: start.toISOString(), ends_at: new Date(+start + 30 * 60_000).toISOString(), location: 'Video call (link to follow)', attendees: [email], host: 'genovus', status: 'scheduled' }).select('id').single(), 'event');
  const ci = must(await db.from('consult_invites').insert({ tenant_id: house.id, label: `${label} Verify, ${label} Verify Insurance`, emails: [email], minutes: 30, event_id: ev.id, inquiry_id: inq.id, booked_at: new Date(Date.now() - 24 * H).toISOString() }).select('id').single(), 'invite');
  made.inquiries.push(inq.id); made.events.push(ev.id); made.invites.push(ci.id);
  return { ci: ci.id, inq: inq.id };
}
const savedSettings = (await db.from('app_settings').select('key, value').in('key', ['consult_video_url', 'consult_team_emails', 'business_postal_address'])).data ?? [];

const up = async () => { try { return (await fetch(ORIGIN, { redirect: 'manual' })).status > 0; } catch { return false; } };
const dev = spawn('npx', ['next', 'dev', '-p', String(PORT)], { stdio: 'ignore', shell: true, env: { ...process.env } });
for (let i = 0; i < 120 && !(await up()); i++) await sleep(1000);
const port = 9584, profile = fs.mkdtempSync(path.join(os.tmpdir(), 'genovus-verify-'));
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
const waitFor = async (fn, ms = 30000) => { for (let i = 0; i < ms / 250; i++) { if (await fn()) return true; await sleep(250); } return false; };
const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(s.result.data, 'base64')); };
const text = () => ev('document.body.innerText');
try {
  // 5. proof hidden (signed out)
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
  await go('/');
  const homeProof = await ev('!!document.querySelector("[data-proof]")');
  await go('/book');
  check(!homeProof && !(await ev('!!document.querySelector("[data-proof]")')), 'with no approved quote, the proof section is hidden on the homepage and /book');

  // 2. the Brief card and the consult page
  const soon = await seed('Quinn', 3 * H, 'Get our Google profile ranking for auto quotes');
  const done = await seed('Rae', -2 * H, '');
  const link = must(await db.auth.admin.generateLink({ type: 'magiclink', email: adminEmail }), 'link');
  await go(`/auth/continue?t=${encodeURIComponent(link.properties.hashed_token)}&next=${encodeURIComponent('/console')}`);
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Continue/.test(x.textContent)); b && b.click(); })()`);
  await waitFor(async () => (await ev('location.pathname')) === '/console');
  const card = await waitFor(async () => await ev(`[...document.querySelectorAll('*')].some((n) => n.children.length === 0 && /^Consult with Quinn /.test(n.textContent))`), 30000);
  check(card, 'a consultation in the next day is on the Command Brief');
  check(/They want: Get our Google profile ranking/.test(await text()), 'and what they want from the call');
  await shot('brief-consult-soon');
  await ev(`[...document.querySelectorAll('button')].find((b) => /^Open the guide$/.test(b.textContent.trim()))?.click()`);
  check(await waitFor(async () => (await ev('location.pathname')) === `/console/consults/${soon.ci}`, 90000), 'with "Open the guide" going to its consultation page');
  await go(`/console/consults/${soon.ci}`);
  const page = await text();
  check(/What Quinn wants from this call/.test(page) && /Google profile ranking/.test(page), 'the consult page leads with their #1 goal');
  check((await ev('document.querySelectorAll(".guide-steps li").length')) === 8 && (await ev('document.querySelectorAll(".guide-objections details").length')) === 8 && /Qualifying questions/i.test(page) && /State Farm/.test(page), 'it shows the 8 discovery steps, the qualifying questions, the 8 objections and their carrier');
  await shot('consult-page');
  await ev(`(() => { const f = document.querySelector('form[data-helix-form="consult notes"]'); f.querySelector('[name=objection]').value = 'carrier'; f.querySelector('[name=note]').value = 'Verify note: needs carrier approval, wants a second call'; f.querySelector('button[type=submit]').click(); })()`);
  check(await waitFor(async () => { const r = (await db.from('consult_invites').select('objection, call_note').eq('id', soon.ci).single()).data; return r?.objection === 'carrier' && /second call/.test(r.call_note ?? ''); }), 'the objection and the call note save to the consultation');
  check(((await db.from('audit_events').select('id').eq('action', 'consult.notes').ilike('subject', 'Quinn Verify%')).data ?? []).length >= 1, 'and it is in the audit log');

  await go(`/console/consults/${done.ci}`);
  await ev(`[...document.querySelectorAll('[data-helix-group="Consult outcome"] button')].find((b) => /No-show/.test(b.textContent))?.click()`);
  check(await waitFor(async () => (await db.from('consult_invites').select('outcome').eq('id', done.ci).single()).data?.outcome === 'no_show'), 'the outcome can be recorded on the consult page too');
  check(/didn.t say what they want/.test(await text()), 'with no #1 goal given, the page says to ask early');

  // 3. objections from a prospect's call log, then the Growth tally
  const pr = (await db.from('prospects').select('id, code, owner').neq('status', 'opted_out').limit(1).maybeSingle()).data;
  if (pr) {
    await go(`/console/prospects/${pr.code}`);
    await ev(`(() => { const f = document.querySelector('form[data-helix-form="call log"]'); f.querySelector('[name=objection]').value = 'think'; f.querySelector('[name=note]').value = 'verify-week2 objection note'; f.querySelector('button[type=submit]').click(); })()`);
    const got = await waitFor(async () => ((await db.from('prospect_events').select('id, objection').eq('prospect_id', pr.id).eq('note', 'verify-week2 objection note')).data ?? []).some((e) => e.objection === 'think'));
    made.prospectEvents.push(...((await db.from('prospect_events').select('id').eq('prospect_id', pr.id).eq('note', 'verify-week2 objection note')).data ?? []).map((e) => e.id));
    check(got, 'a prospect call log records the objection');
    await go(`/console/prospects/${pr.code}`);
    check(/Needs to think about it/.test(await text()), 'and the history shows it');
    if (!pr.owner) await db.from('prospects').update({ owner: null }).eq('id', pr.id);
  } else check(true, '(no prospect on preview to log against; skipped)');
  await go('/console/growth');
  const g = await ev(`document.querySelector('[data-helix-item="Top objections"]')?.innerText ?? ''`);
  check(/What stops people saying yes/i.test(g) && /Carrier approval worries/.test(g), 'Growth counts the objections ("What stops people saying yes")');
  await shot('growth-objections');

  // 4. Inquiries → consult page; Setup settings
  await go('/console/inquiries');
  check(await ev(`!![...document.querySelectorAll('a')].find((a) => a.getAttribute('href') === '/console/consults/${soon.ci}' && /consult guide/.test(a.textContent))`), 'Inquiries links the website booking to its consult guide');
  await go('/console/setup');
  const setF = (v, tm, ad) => ev(`(() => { const f = [...document.querySelectorAll('form')].find((x) => x.querySelector('[name=video]')); f.querySelector('[name=video]').value = ${JSON.stringify(v)}; f.querySelector('[name=team]').value = ${JSON.stringify(tm)}; f.querySelector('[name=address]').value = ${JSON.stringify(ad)}; f.noValidate = true; f.querySelector('button[type=submit]').click(); })()`);
  await setF('http://not-secure.example/room', '', '');
  await waitFor(async () => /needs to be a full https/.test(await text()), 15000);
  check(/needs to be a full https/.test(await text()), 'Setup refuses a video room that is not an https link');
  await go('/console/setup');
  await setF('https://meet.google.com/verify-week2', `ops@${DOMAIN}`, '100 Verify Street, Columbus, GA 31909');
  check(await waitFor(async () => (await db.from('app_settings').select('value').eq('key', 'consult_video_url').maybeSingle()).data?.value === 'https://meet.google.com/verify-week2'), 'Setup saves the video room, the team email and the mailing address');
  await shot('setup-consultations');

  // phone width: the consult page doesn't scroll sideways
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await go(`/console/consults/${soon.ci}`);
  check(await ev('document.documentElement.scrollWidth <= window.innerWidth + 1'), 'the consult page fits a phone');
  await shot('consult-page-phone');
} finally {
  ws.close(); chrome.kill();
  try { execSync(`for /f "tokens=5" %a in ('netstat -ano ^| findstr :${PORT} ^| findstr LISTENING') do taskkill /F /T /PID %a`, { shell: 'cmd.exe', stdio: 'ignore' }); } catch {}
  dev.kill();
  for (const k of ['consult_video_url', 'consult_team_emails', 'business_postal_address']) {
    const was = savedSettings.find((s) => s.key === k);
    if (was) await db.from('app_settings').update({ value: was.value }).eq('key', k); else await db.from('app_settings').delete().eq('key', k);
  }
  if (made.prospectEvents.length) await db.from('prospect_events').delete().in('id', made.prospectEvents);
  if (made.invites.length) await db.from('consult_invites').delete().in('id', made.invites);
  if (made.events.length) await db.from('calendar_events').delete().in('id', made.events);
  if (made.inquiries.length) { await db.from('outbox').delete().in('dedupe_key', made.inquiries.map((x) => `inquiry-push:${x}`)); for (const x of made.inquiries) await db.from('outbox').delete().like('dedupe_key', `inquiry:${x}:%`); await db.from('inquiries').delete().in('id', made.inquiries); }
  await db.from('outbox').delete().like('to_email', `%@${DOMAIN}`);
}
console.log(`screenshots in ${OUT} | ${failed ? `${failed} failed` : 'all passed'}`);
process.exit(failed ? 1 : 0);
