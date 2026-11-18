// Verify the Social setup wizard as a real (non-sample) agency owner on the PREVIEW database: Facebook "have it"
// (link, access sent), Google "my carrier runs it", Instagram "build it with us" (wording approved), then the
// Setup page panel. Screenshots to outDir. Preview only; never run against production.
//   node --env-file=.env.local scripts/verify-social-wizard.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const OUT = process.argv[2] || path.join(os.tmpdir(), 'genovus-social');
const ORIGIN = 'http://localhost:3912';
const SLUG = 'test-social';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
if (/prod/i.test(process.env.VERCEL_ENV ?? '')) throw new Error('refusing: production environment');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };
let fails = 0; const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) fails++; };

let t = must(await db.from('tenants').select('id').eq('slug', SLUG).maybeSingle(), 'tenant');
if (!t) t = must(await db.from('tenants').insert({ slug: SLUG, name: 'Test Social Agency', kind: 'agency', stage: 'build', plan: 'growth' }).select('id').single(), 'insert tenant');
else must(await db.from('tenants').update({ stage: 'build', plan: 'growth', is_sample: false, metricool_connect_url: null }).eq('id', t.id), 'update tenant');
must(await db.from('social_setup').delete().eq('tenant_id', t.id), 'clear social');
must(await db.from('care_requests').delete().eq('tenant_id', t.id), 'clear care');
const { data: last } = await db.from('agent_records').select('version').eq('tenant_id', t.id).order('version', { ascending: false }).limit(1).maybeSingle();
await db.from('agent_records').update({ is_current: false }).eq('tenant_id', t.id);
must(await db.from('agent_records').insert({ tenant_id: t.id, version: (last?.version ?? 0) + 1, is_current: true, data: { agencyName: 'Test Social Agency', carrier: 'GEICO', city: 'Valdosta', state: 'GA', phone: '(229) 555-0100', address: '1 Main St', intake: { hours: 'Mon–Fri 9–5' } }, note: 'verify' }), 'record');
const email = `owner@${SLUG}.example`;
let user = (await db.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === email);
if (!user) user = must(await db.auth.admin.createUser({ email, email_confirm: true }), 'user').user;
must(await db.from('memberships').upsert({ tenant_id: t.id, user_id: user.id, role: 'owner' }, { onConflict: 'tenant_id,user_id' }), 'membership');

const up = async () => { try { return (await fetch(ORIGIN, { redirect: 'manual' })).status > 0; } catch { return false; } };
let dev = null;
if (!(await up())) { dev = spawn('npx', ['next', 'dev', '-p', '3912'], { stdio: 'ignore', shell: true }); for (let i = 0; i < 180 && !(await up()); i++) await sleep(1000); }

const link = must(await db.auth.admin.generateLink({ type: 'magiclink', email }), 'link');
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9492, profile = fs.mkdtempSync(path.join(os.tmpdir(), 'genovus-social-'));
const chrome = spawn(CH, ['--headless=new', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
let list; for (let i = 0; i < 60; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (list.find((x) => x.type === 'page')) break; } catch {} await sleep(250); }
const ws = new WebSocket(list.find((x) => x.type === 'page').webSocketDebuggerUrl);
let id = 0; const pend = new Map(); const on = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method) on.get(m.method)?.(m.params); };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send('Page.enable');
const go = async (u) => { const l = new Promise((r) => on.set('Page.loadEventFired', r)); await send('Page.navigate', { url: ORIGIN + u }); await l; await sleep(1500); };
const shot = async (name, w = 1280) => {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 600 });
  await sleep(400);
  const full = await ev('Math.min(document.documentElement.scrollHeight, 4000)');
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: full, deviceScaleFactor: 1, mobile: w < 600 });
  await sleep(300);
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
};
const click = async (re) => { for (let i = 0; i < 40; i++) { if (await ev(`(() => { const b = [...document.querySelectorAll('button,a')].find((x) => ${re}.test(x.textContent.trim()) && !x.disabled); b && b.click(); return !!b; })()`)) return true; await sleep(250); } return false; };
const text = () => ev('document.body.innerText');
const waitFor = async (re, ms = 15000) => { for (let i = 0; i < ms / 250; i++) { if (re.test(String(await text()))) return true; await sleep(250); } return false; };
const type = (sel, v) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set; set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
const row = async (ch) => must(await db.from('social_setup').select('*').eq('tenant_id', t.id).eq('channel', ch).maybeSingle(), 'row');

await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await go(`/auth/continue?t=${encodeURIComponent(link.properties.hashed_token)}&next=${encodeURIComponent(`/app/${SLUG}/social`)}`);
await click('/Continue/');
for (let i = 0; i < 40 && !String(await ev('location.pathname')).startsWith(`/app/${SLUG}`); i++) await sleep(250);
await go(`/app/${SLUG}/social`);
check(await waitFor(/Your social profiles/), 'social page loads');
await ev(`localStorage.setItem('genovus-whatsnew-seen', JSON.stringify([])); true`);
check(await waitFor(/with you every step of the way/), 'walkthrough shows before setup starts');
await shot('0-intro');
await click('/^Show me around first$/');
check(await waitFor(/Quick Helix Tour/i), 'Show me around runs the Quick Helix Tour');
await sleep(800); await shot('0b-tour-1');
await click('/^Next$/'); await sleep(900); await shot('0c-tour-2');
await click('/^Next$/'); await sleep(1500); await shot('0d-tour-3');
await click('/^(Done|Close|Got it|Finish)$/');
await ev(`document.querySelector('.qt-card button.ghost, .qt-card button')?.click(); true`);
await go(`/app/${SLUG}/social`);
await shot('1-cards');

// Facebook: I have one -> link -> access sent -> Metricool waits for the link.
await click('/^Facebook Page/'); await waitFor(/Do you already have/);
await shot('2-facebook-question');
await click('/^Yes, I have one/'); check(await waitFor(/Paste your Facebook link/), 'facebook: have path shows the link step');
await type('.social-link input', 'twitter.com/nope'); await click('/^Save link$/');
check(await waitFor(/look like a Facebook link/), 'facebook: a wrong link is refused');
await type('.social-link input', 'facebook.com/testsocialagency'); await click('/^Save link$/');
check(await waitFor(/Link saved/), 'facebook: link saved');
check((await row('facebook'))?.link === 'https://facebook.com/testsocialagency', 'facebook: link stored as https');
const rec = must(await db.from('agent_records').select('data').eq('tenant_id', t.id).eq('is_current', true).single(), 'rec');
check(rec.data.intake?.facebook === 'https://facebook.com/testsocialagency', 'facebook: link also fills the Welcome answer');
await click('/^Next$/'); await waitFor(/Give Genovus partner access/);
await shot('3-facebook-access');
await click('/done this$/'); check(await waitFor(/confirms it on our side/), 'facebook: access marked sent');
check((await row('facebook'))?.access === 'sent', 'facebook: access = sent');
await click('/^Next$/'); check(await waitFor(/connection link is on its way/), 'facebook: Metricool step waits for the link');
await shot('4-facebook-metricool');
await click('/^Do this with us on a call$/'); check(await waitFor(/reach out to book a short call/), 'call request sent');
const care = must(await db.from('care_requests').select('title, kind').eq('tenant_id', t.id).eq('title', 'Social setup help: Facebook'), 'care');
check(care.length > 0 && care[0].kind === 'support', 'call request is a support request for the team');
await click('/^Ask Helix about this step$/');
check(await waitFor(/Walk me through it one step at a time/), 'Ask Helix opens with the step question');
await sleep(1500); await shot('4b-helix');
await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`);
await go(`/app/${SLUG}/social?c=facebook`); await sleep(800);

// Google: the carrier runs it.
await click('/All channels/'); await sleep(500); await click('/^Google Business Profile/');
check(await waitFor(/Who looks after your Google listing/), 'google: asks who runs the listing');
await click('/^My carrier does/'); check(await waitFor(/Your carrier runs your listing/), 'google: carrier listing is left alone');
check((await row('google'))?.google_owner === 'carrier', 'google: owner = carrier');

// Instagram: build it with us, approve the wording.
await click('/All channels/'); await sleep(500); await click('/^Instagram/');
await waitFor(/Do you already have/); await click('/set it up with Genovus/');
check(await waitFor(/Approve your profile wording/), 'instagram: create path starts with the wording');
await shot('5-instagram-copy');
await click('/^Approve this wording$/'); check(await waitFor(/Approved\. You can create/), 'instagram: wording approved');
check(!!(await row('instagram'))?.copy_ok_at, 'instagram: approval stored');
await click('/^Next$/'); await sleep(800); await shot('6-instagram-step');

// Phone width and the Setup panel.
await click('/All channels/'); await sleep(800); await shot('7-cards-phone', 390);
await go(`/app/${SLUG}/setup`); check(await waitFor(/Social setup/), 'setup page shows the Social setup panel'); await shot('8-setup');

chrome.kill(); ws.close(); if (dev) dev.kill();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED', '·', OUT);
process.exit(fails ? 1 : 0);
