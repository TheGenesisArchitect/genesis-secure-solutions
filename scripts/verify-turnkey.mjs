// Verify the turnkey flow (Weeks 1–2) on the PREVIEW database.
//  1. the checks move the stage: proposal sent → Deposit; deposit paid → Intake and the plan becomes the package;
//     checklist done + photo rights and kickoff cleared → Build. Forward only, logged as automatic. Nothing moves
//     early (an unpaid deposit, a missing checklist, an open check)
//  2. what each client is waiting on is named (pipeline and Helix's brief use the same words)
// Each run makes its own test client (clients can't be deleted: the audit trail keeps them); it's marked a sample after.
//   node --conditions=react-server --env-file=.env.local scripts/verify-turnkey.mjs [outDir]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register } from 'node:module';
import { createClient } from '@supabase/supabase-js';

if (/prod/i.test(process.env.VERCEL_ENV ?? '')) throw new Error('refusing: production environment');
const OUT = process.argv[2] || path.join(os.tmpdir(), 'genovus-verify'); fs.mkdirSync(OUT, { recursive: true });
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const db = createClient(URL_, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed++; };
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); if (s.startsWith('@/')) return next(new URL('../' + s.slice(2) + (/\\.[a-z]+$/.test(s) ? '' : (s.startsWith('@/components') ? '.tsx' : '.ts')), ${JSON.stringify(new URL('./', import.meta.url).href)}).href, c); throw e; } }`));

const SLUG = `verify-turnkey-${Date.now().toString(36)}`;
const t = must(await db.from('tenants').insert({ slug: SLUG, name: 'Verify Turnkey Agency', stage: 'consult' }).select('id').single(), 'tenant');
must(await db.from('gates').insert(['photo_rights', 'carrier_approval', 'carrier_rules', 'meta_access', 'domain', 'privacy_notice', 'kickoff'].map((kind) => ({ tenant_id: t.id, kind }))), 'gates');
must(await db.from('agent_records').insert({ tenant_id: t.id, version: 1, data: { agencyName: 'Verify Turnkey Agency', package: 'growth', email: 'owner@verify-turnkey.example' }, is_current: true, note: 'verify' }), 'record');
const stage = async () => must(await db.from('tenants').select('stage, plan').eq('id', t.id).single(), 'stage');
const events = async () => must(await db.from('lifecycle_events').select('from_stage, to_stage, note, actor').eq('tenant_id', t.id).order('at'), 'events');

try {
  const B = await import('../lib/blockers.ts');
  const why = async () => (await B.blockersFor(db, [t.id])).get(t.id)?.items ?? [];

  // 1. stage moves
  check((await why()).some((x) => /Draft the proposal and deposit/.test(x)), `a new client is waiting on its proposal (${(await why()).join('; ')})`);
  const dep = must(await db.from('invoices').insert({ tenant_id: t.id, kind: 'deposit', amount_cents: 175000, status: 'draft', note: 'Verify deposit' }).select('id').single(), 'deposit');
  must(await db.from('tenants').update({ proposal_sent_at: new Date().toISOString() }).eq('id', t.id), 'sent');
  const s1 = await stage();
  check(s1.stage === 'deposit' && !s1.plan, `proposal sent → Deposit, plan not set yet (${s1.stage}, ${s1.plan})`);
  must(await db.from('invoices').update({ status: 'open' }).eq('id', dep.id), 'open');
  check((await stage()).stage === 'deposit' && (await why()).some((x) => /Deposit not paid/.test(x)), `an unpaid deposit keeps it in Deposit, named (${(await why()).join('; ')})`);
  must(await db.from('invoices').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', dep.id), 'paid');
  const s2 = await stage();
  check(s2.stage === 'intake' && s2.plan === 'growth', `deposit paid → Intake, and the plan becomes the package (${s2.stage}, ${s2.plan})`);
  check((await why()).some((x) => /Client checklist: .*legal name/i.test(x)) && (await why()).some((x) => /Photo rights not cleared/.test(x)), `Intake names what's missing (${(await why()).join('; ')})`);
  must(await db.from('tenants').update({ checklist_done_at: new Date().toISOString() }).eq('id', t.id), 'checklist');
  check((await stage()).stage === 'intake', 'checklist done but photo rights and kickoff open: stays in Intake');
  must(await db.from('gates').update({ status: 'cleared' }).eq('tenant_id', t.id).eq('kind', 'photo_rights'), 'photo');
  check((await stage()).stage === 'intake', 'kickoff still open: stays in Intake');
  must(await db.from('gates').update({ status: 'waived' }).eq('tenant_id', t.id).eq('kind', 'kickoff'), 'kickoff');
  check((await stage()).stage === 'build', 'photo rights and kickoff cleared → Build');
  const evs = await events();
  check(evs.length === 3 && evs.every((e) => e.actor === null && /^Automatic: /.test(e.note)) && evs.map((e) => e.to_stage).join(',') === 'deposit,intake,build', `each move is logged as automatic (${evs.map((e) => `${e.from_stage}→${e.to_stage}`).join(', ')})`);
  must(await db.from('tenants').update({ proposal_sent_at: new Date().toISOString() }).eq('id', t.id), 'resend');
  check((await stage()).stage === 'build' && (await events()).length === 3, 'forward only: a later signal never moves it back');
  const audit = must(await db.from('audit_events').select('action, actor_label').eq('tenant_id', t.id).in('action', ['stage.auto', 'plan.set']), 'audit');
  check(audit.filter((a) => a.action === 'stage.auto').length === 3 && audit.some((a) => a.action === 'plan.set') && audit.every((a) => a.actor_label === 'Genovus (automatic)'), 'and in the audit trail, with the plan change');
  check((await why()).some((x) => /mark it ready for review/.test(x)), `Build names the next human step (${(await why()).join('; ')})`);

  // 2. proposal and deposit: drafted from the package, sent with one tap in Approvals (never in bulk)
  const t2 = must(await db.from('tenants').insert({ slug: `${SLUG}-p`, name: 'Verify Proposal Agency', stage: 'consult' }).select('id').single(), 't2');
  must(await db.from('gates').insert(['photo_rights', 'kickoff'].map((kind) => ({ tenant_id: t2.id, kind }))), 'gates2');
  must(await db.from('agent_records').insert({ tenant_id: t2.id, version: 1, data: { agencyName: 'Verify Proposal Agency', package: 'premium', email: 'Owner@Verify-Proposal.example', contactName: 'Pat Verify' }, is_current: true, note: 'verify' }), 'record2');
  const P = await import('../lib/proposal.ts');
  const d1 = await P.ensureDepositDraft(t2.id, 'premium'), d2 = await P.ensureDepositDraft(t2.id, 'premium');
  const inv = must(await db.from('invoices').select('amount_cents, status, kind').eq('tenant_id', t2.id), 'inv');
  check(d1 === d2 && inv.length === 1 && inv[0].amount_cents === 350000 && inv[0].status === 'draft', `the deposit is drafted once from the package: Premium setup $5,000 → $3,500 (70%) (${inv.map((i) => `${i.kind} ${i.amount_cents} ${i.status}`).join(', ')})`);
  const ap = must(await db.from('approvals').insert({ tenant_id: t2.id, subject_kind: 'invoice', approver: 'team', lane: 'queued', title: 'Send the proposal and Premium deposit', body: { action: 'send_proposal', text: 'Premium package. Deposit 70% of setup.', channel: 'Email' } }).select('id').single(), 'approval');
  const other = must(await db.from('approvals').insert({ tenant_id: t2.id, subject_kind: 'copy', approver: 'team', lane: 'queued', title: 'Verify clean copy', body: { text: 'Your local agent is here to help.' } }).select('id').single(), 'other approval');

  const { spawn, execSync } = await import('node:child_process');
  const PORT = 3935, ORIGIN = `http://localhost:${PORT}`;
  process.env.PROPOSAL_LINK_SECRET = 'verify-proposal-secret';
  const up = async () => { try { return (await fetch(ORIGIN, { redirect: 'manual' })).status > 0; } catch { return false; } };
  const dev = spawn('npx', ['next', 'dev', '-p', String(PORT)], { stdio: 'ignore', shell: true, env: { ...process.env, MERCURY_API_TOKEN: '', PROPOSAL_LINK_SECRET: 'verify-proposal-secret' } });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 120 && !(await up()); i++) await sleep(1000);
  const admin = must(await db.from('staff').select('user_id').eq('role', 'admin').limit(1).single(), 'admin');
  const adminEmail = must(await db.auth.admin.getUserById(admin.user_id), 'admin email').user.email;
  const link = must(await db.auth.admin.generateLink({ type: 'magiclink', email: adminEmail }), 'link');
  const port = 9571, profile = fs.mkdtempSync(path.join(os.tmpdir(), 'genovus-verify-'));
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
  const shot = async (name) => { const m = (await send('Page.getLayoutMetrics')).result.cssContentSize; const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: m.width, height: Math.min(m.height, 3000), scale: 1 } }); fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(s.result.data, 'base64')); };
  const waitFor = async (fn, ms = 20000) => { for (let i = 0; i < ms / 250; i++) { if (await fn()) return true; await sleep(250); } return false; };
  try {
    await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
    await go(`/auth/continue?t=${encodeURIComponent(link.properties.hashed_token)}&next=${encodeURIComponent('/console')}`);
    await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Continue/.test(x.textContent)); b && b.click(); })()`);
    await waitFor(async () => (await ev('location.pathname')) === '/console');
    await go('/console/approvals');
    const bulkIds = await ev(`[...document.querySelectorAll('form input[name=id]')].filter((i) => i.closest('form')?.querySelector('button')?.textContent?.includes('Approve all')).map((i) => i.value)`);
    check(!(bulkIds ?? []).includes(ap.id), 'bulk approve never includes the proposal send');
    await ev(`(() => { const li = [...document.querySelectorAll('li[data-helix-item]')].find((l) => l.dataset.helixItem === 'Send the proposal and Premium deposit' && l.innerText.includes('Verify Proposal Agency')); li?.querySelector('button[name=decision][value=approved]')?.click(); })()`);
    check(await waitFor(async () => !!(await db.from('tenants').select('proposal_sent_at').eq('id', t2.id).single()).data?.proposal_sent_at, 25000), 'one tap on Approve sends it');
    const mail = must(await db.from('outbox').select('to_email, template, data').eq('tenant_id', t2.id).eq('template', 'proposal_ready'), 'mail');
    const s2 = must(await db.from('tenants').select('stage').eq('id', t2.id).single(), 's2');
    const apAfter = must(await db.from('approvals').select('status').eq('id', ap.id).single(), 'ap after');
    check(mail.length === 1 && mail[0].to_email === 'owner@verify-proposal.example' && /\/proposal\//.test(mail[0].data.link) && mail[0].data.package === 'Premium' && mail[0].data.first === 'Pat', `the proposal email goes to the client's email on record, with their link (${mail[0]?.to_email})`);
    check(s2.stage === 'deposit' && apAfter.status === 'approved', `the approval is done and the client moved to Deposit (${s2.stage})`);
    const token = new URL(mail[0].data.link).pathname.split('/').pop();
    await go(`/proposal/${token}`);
    const page = await ev('document.body.innerText');
    check(/Pat, here’s your Premium package/.test(page) && page.includes('$3,500') && page.includes('$1,500') && page.includes('$799/mo') && /Optimization Care/.test(page) && /about 14 days/.test(page), 'the proposal shows the package, the 70/30 split ($3,500 now, $1,500 at launch), care and the steps');
    check(/arrives by email/.test(page), 'with Mercury not connected, it says the deposit invoice follows (no pay button)');
    const robots = await ev(`document.querySelector('meta[name=robots]')?.content ?? ''`);
    check(/noindex/.test(robots), 'the proposal is never indexed');
    await shot('proposal');
    const bad = await fetch(`${ORIGIN}/proposal/${token.slice(0, -2)}xx`);
    check(bad.status === 404, `a tampered link shows nothing (${bad.status})`);
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await go(`/proposal/${token}`);
    check(!(await ev('document.documentElement.scrollWidth > innerWidth')), 'the proposal fits a phone');
    await shot('proposal-phone');

    // 3. the client's checklist: the link arrives once the deposit is paid; the client fills it; it moves them on
    const t3 = must(await db.from('tenants').insert({ slug: `${SLUG}-c`, name: 'Verify Checklist Agency', stage: 'intake' }).select('id').single(), 't3');
    must(await db.from('gates').insert(['photo_rights', 'kickoff'].map((kind) => ({ tenant_id: t3.id, kind }))), 'gates3');
    must(await db.from('agent_records').insert({ tenant_id: t3.id, version: 1, data: { agencyName: 'Verify Checklist Agency', package: 'growth', email: 'owner@verify-checklist.example', contactName: 'Casey Verify' }, is_current: true, note: 'verify' }), 'record3');
    const CL = await import('../lib/client-checklist.ts');
    await CL.sendChecklistLinks(ORIGIN); await CL.sendChecklistLinks(ORIGIN);
    const cm = must(await db.from('outbox').select('data').eq('tenant_id', t3.id).eq('template', 'checklist_ready'), 'checklist mail');
    check(cm.length === 1 && /\/welcome\/[A-Za-z0-9_-]+\/checklist$/.test(cm[0].data.link) && cm[0].data.first === 'Casey', `a paid client gets their checklist link by email, once (${cm.length} email)`);
    const ctoken = cm[0].data.link.split('/welcome/')[1].split('/')[0];
    const wres = await fetch(`${ORIGIN}/welcome/${ctoken}`, { redirect: 'manual' });
    const whtml = wres.status === 200 ? await wres.text() : '';
    const wok = (wres.status === 302 && /\/checklist$/.test(wres.headers.get('location') ?? '')) || (wres.status === 200 && whtml.includes(`/welcome/${ctoken}/checklist`) && /6 things left/.test(whtml));
    check(wok, `their welcome link leads to the checklist, with what's left (${wres.status})`);
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await go(`/welcome/${ctoken}/checklist`);
    check(/Casey, a few things for your site/.test(await ev('document.body.innerText')) && /0 of 6 done/.test(await ev('document.body.innerText')), 'the checklist greets them and shows what’s left');
    const setField = (name, value) => ev(`(() => { const el = document.querySelector('form.ck-form [name="${name}"]'); const set = Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await setField('legalName', 'Verify Checklist Agency, LLC');
    await setField('hours', 'Mon–Fri 9–6');
    await setField('licensedStates', 'ga, al');
    await setField('officialUrl', 'https://www.example.com/agent/casey-verify');
    await ev(`document.querySelector('form.ck-form input[name=domainChoice][value=register]').click()`);
    await sleep(300);
    await setField('domain', 'caseyverify.com');
    const AD = path.join(os.tmpdir(), 'verify-headshot.png');
    fs.writeFileSync(AD, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
    const doc = await send('DOM.getDocument', {});
    const node = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: 'form.ck-form input[name=headshot]' });
    await send('DOM.setFileInputFiles', { nodeId: node.result.nodeId, files: [AD] });
    await ev(`document.querySelector('form.ck-form input[name=rights]').click()`);
    await shot('checklist-filled');
    await ev(`document.querySelector('form.ck-form button[type=submit]').click()`);
    check(await waitFor(async () => /All set/.test((await ev(`document.querySelector('.ck-msg')?.innerText ?? ''`)) ?? ''), 20000), `saving everything says all set (${await ev(`document.querySelector('.ck-msg')?.innerText ?? ''`)})`);
    const rec3 = must(await db.from('agent_records').select('data, note').eq('tenant_id', t3.id).eq('is_current', true).single(), 'rec3');
    const head = rec3.data.intake?.headshot ? must(await db.from('assets').select('rights_status, audience, location_kind').eq('id', rec3.data.intake.headshot).single(), 'headshot') : null;
    const gate = must(await db.from('gates').select('status, evidence').eq('tenant_id', t3.id).eq('kind', 'photo_rights').single(), 'gate');
    const t3s = must(await db.from('tenants').select('stage, checklist_done_at').eq('id', t3.id).single(), 't3s');
    check(rec3.note === 'From the client checklist' && rec3.data.intake.licensedStates === 'GA, AL' && rec3.data.intake.domain === 'caseyverify.com' && rec3.data.agencyName === 'Verify Checklist Agency', `their answers land on the record, cleaned (${JSON.stringify(rec3.data.intake)})`);
    check(head?.rights_status === 'pending' && head.audience === 'client' && head.location_kind === 'blob' && gate.status === 'open' && /confirmed rights/.test(gate.evidence ?? ''), 'the headshot is saved privately with rights pending; their statement is the photo-rights evidence, and the team still clears it');
    check(!!t3s.checklist_done_at && t3s.stage === 'intake', 'the checklist is done; they stay in Intake until photo rights and kickoff clear');
    must(await db.from('gates').update({ status: 'cleared' }).eq('tenant_id', t3.id).in('kind', ['photo_rights', 'kickoff']), 'clear3');
    check(must(await db.from('tenants').select('stage').eq('id', t3.id).single(), 's3').stage === 'build', 'and then move to Build on their own');
    const badStates = new FormData(); badStates.set('licensedStates', 'Georgia');
    const r1 = await (await fetch(`${ORIGIN}/api/welcome/${ctoken}/checklist`, { method: 'POST', body: badStates, headers: { origin: ORIGIN } })).json();
    const r2 = await fetch(`${ORIGIN}/api/welcome/${ctoken}/checklist`, { method: 'POST', body: new FormData(), headers: { origin: 'https://evil.example' } });
    const r3 = await (await fetch(`${ORIGIN}/api/welcome/notarealtoken12345/checklist`, { method: 'POST', body: new FormData(), headers: { origin: ORIGIN } })).json();
    check(r1.ok === false && /two-letter/.test(r1.error) && r2.status === 403 && r3.ok === false, 'bad input, another site and a bad link are refused');
  } finally {
    ws.close(); chrome.kill();
    try { execSync(`for /f "tokens=5" %a in ('netstat -ano ^| findstr :${PORT} ^| findstr LISTENING') do taskkill /F /T /PID %a`, { shell: 'cmd.exe', stdio: 'ignore' }); } catch {}
    dev.kill();
    await db.from('approvals').delete().in('id', [ap.id, other.id]);
  }
} finally {
  await db.from('tenants').update({ is_sample: true, name: 'Verify turnkey (test)' }).like('slug', 'verify-turnkey-%');
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
