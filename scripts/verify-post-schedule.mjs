// Verify the posting schedule (migration 0074, lib/post-distribute.ts, the signed image link):
//  1. staff plan a post with an ad from that agency's own Library; another agency's ad, an internal file, a past time,
//     a Google story and a non-staff caller are refused
//  2. the owner's approval shows the ad; approving moves the post to approved, asking for changes moves it back to draft
//  3. only owner-approved, non-sample posts with an ad go to the agency's own Metricool brand: a feed image as POST with
//     its caption, a story as STORY with no caption, the image through a signed link; draft mode leaves the post
//     "approved"; a post approved hours after its time is held for a new time; live mode books it, then sync marks it
//     published with its link
//  4. the signed link serves the ad, and nothing for a bad signature, the video kinds or an internal file
//  5. the Studio's Metricool posts are unchanged (Instagram Reel; Facebook post unless vertical)
// Preview database only. Run: node --conditions=react-server --env-file=.env.local scripts/verify-post-schedule.mjs <ad.jpg>
import fs from 'node:fs';
import http from 'node:http';
import { register } from 'node:module';
import { createClient } from '@supabase/supabase-js';
import { put, del } from '@vercel/blob';

if (/prod/i.test(process.env.VERCEL_ENV ?? '')) throw new Error('refusing: production environment');
const AD = process.argv[2];
if (!AD || !fs.existsSync(AD)) throw new Error('pass a JPEG ad as the first argument');
const MOCK = 39601, SLUG = 'test-launch', OPS = 'verify-posts-ops@genovus.example', BLOG = '1234567';
Object.assign(process.env, { METRICOOL_API_BASE: `http://localhost:${MOCK}`, METRICOOL_GENOVUS_API_KEY: 'test', MEDIA_LINK_SECRET: 'verify-posts', METRICOOL_MODE: '' });
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL, ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const db = createClient(URL_, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed++; };

// A stand-in Metricool: records each scheduled post, reports PUBLISHED on status reads.
const sent = [];
const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    res.setHeader('content-type', 'application/json');
    if (req.method === 'POST' && u.pathname === '/v2/scheduler/posts') { sent.push({ blogId: u.searchParams.get('blogId'), body: JSON.parse(b) }); return res.end(JSON.stringify({ data: { id: 9000 + sent.length } })); }
    if (req.method === 'GET' && u.pathname.startsWith('/v2/scheduler/posts/')) return res.end(JSON.stringify({ data: { providers: [{ network: 'instagram', status: 'PUBLISHED', publicUrl: 'https://www.instagram.com/p/verify/' }] } }));
    res.statusCode = 404; res.end('{}');
  });
}).listen(MOCK);

const t = must(await db.from('tenants').select('id').eq('slug', SLUG).single(), 'tenant');
const other = must(await db.from('tenants').select('id').neq('slug', SLUG).limit(1).single(), 'another agency');
const users = async () => (await db.auth.admin.listUsers({ perPage: 1000 })).data?.users ?? [];
const KEY = 'assets/verify/post-ad.jpg';
const clean = async () => {
  const ids = (await db.from('assets').select('id').in('tenant_id', [t.id, other.id]).like('title', 'Verify post:%')).data?.map((a) => a.id) ?? [];
  if (ids.length) {
    must(await db.from('content_items').delete().in('asset_id', ids), 'clear posts');
    must(await db.from('assets').delete().in('id', ids), 'clear ads');
  }
  must(await db.from('content_items').delete().eq('tenant_id', t.id).like('copy', 'Verify post%'), 'clear sample posts');
  must(await db.from('tenants').update({ metricool_blog_id: null }).eq('id', t.id), 'clear brand');
  for (const x of (await users()).filter((x) => x.email === OPS)) { await db.from('staff').delete().eq('user_id', x.id); await db.auth.admin.deleteUser(x.id); }
};
await clean();
const ops = must(await db.auth.admin.createUser({ email: OPS, email_confirm: true }), 'operator').user;
must(await db.from('staff').insert({ user_id: ops.id, role: 'operator', display_name: 'Verify Posts' }), 'operator staff');
const signedIn = async (email) => { const link = must(await db.auth.admin.generateLink({ type: 'magiclink', email }), 'link'); const c = createClient(URL_, ANON, { auth: { persistSession: false } }); must(await c.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' }), 'sign in'); return c; };
const asOps = await signedIn(OPS), asOwner = await signedIn(`owner@${SLUG}.example`);

const bytes = fs.readFileSync(AD);
await put(KEY, bytes, { access: 'private', allowOverwrite: true, contentType: 'image/jpeg', addRandomSuffix: false });
const asset = (tenant_id, title, audience = 'client') => db.from('assets').insert({ tenant_id, kind: 'image', title, location_kind: 'blob', location: KEY, audience, rights_status: 'cleared' }).select('id').single();
const ad = must(await asset(t.id, 'Verify post: Auto ad'), 'ad');
const story = must(await asset(t.id, 'Verify post: Story ad'), 'story ad');
const internal = must(await asset(t.id, 'Verify post: internal', 'internal'), 'internal ad');
const theirs = must(await asset(other.id, 'Verify post: another agency'), 'other agency ad');

// 1. planning
const inDays = (d, h = 15) => new Date(Date.now() + d * 86_400_000 + h * 60_000).toISOString();
const plan = (c, p) => c.rpc('propose_post', { p_tenant: t.id, p_asset: ad.id, p_channel: 'instagram', p_format: 'post', p_copy: 'Verify post: your local Columbus agent is here to help. 706-555-0100', p_when: inDays(2), ...p });
const feed = await plan(asOps, {});
const fbStory = await plan(asOps, { p_asset: story.id, p_channel: 'facebook', p_format: 'story', p_copy: '' });
check(!feed.error && !fbStory.error, `staff plan an Instagram feed post and a Facebook story from the agency’s Library ${feed.error?.message ?? fbStory.error?.message ?? ''}`);
const refusals = await Promise.all([
  plan(asOps, { p_asset: theirs.id }), plan(asOps, { p_asset: internal.id }), plan(asOps, { p_when: new Date(Date.now() - 60_000).toISOString() }),
  plan(asOps, { p_channel: 'google', p_format: 'story' }), plan(asOps, { p_copy: '' }), plan(asOwner, {}),
]);
check(refusals.every((r) => r.error), `refused: another agency’s ad, an internal file, a past time, a Google story, a feed post with no caption, and a non-staff caller (${refusals.map((r) => r.error?.message).join(' | ')})`);

// 2. the owner's approval
const approvals = must(await db.from('approvals').select('id, content_item_id, body, lane, approver, status').in('content_item_id', [feed.data, fbStory.data]), 'approvals');
const aFeed = approvals.find((a) => a.content_item_id === feed.data), aStory = approvals.find((a) => a.content_item_id === fbStory.data);
check(aFeed?.approver === 'client' && aFeed.lane === 'required' && aFeed.body.asset_id === ad.id && aFeed.body.format === 'post' && aStory?.body.format === 'story', 'each post waits on the owner, with its ad and format on the approval');
const status = async (id) => must(await db.from('content_items').select('status').eq('id', id).single(), 'status').status;
check(await status(feed.data) === 'in_review', 'a planned post is in review until the owner decides');
must(await asOwner.rpc('decide_approval', { p_id: aFeed.id, p_decision: 'approved' }), 'approve feed');
must(await asOwner.rpc('decide_approval', { p_id: aStory.id, p_decision: 'changes_requested', p_note: 'Verify: later in the week' }), 'changes');
check(await status(feed.data) === 'approved' && await status(fbStory.data) === 'draft', 'approving moves the post to approved; asking for changes moves it back to draft');
const story2 = must(await plan(asOps, { p_asset: story.id, p_channel: 'facebook', p_format: 'story', p_copy: '' }), 'story again');
const a2 = must(await db.from('approvals').select('id').eq('content_item_id', story2).single(), 'a2');
must(await asOwner.rpc('decide_approval', { p_id: a2.id, p_decision: 'approved' }), 'approve story');
const waiting = must(await plan(asOps, {}), 'one left waiting');
// A sample post, approved, with an ad: never sent.
const sample = must(await db.from('content_items').insert({ tenant_id: t.id, channel: 'instagram', copy: 'Verify post sample', status: 'approved', scheduled_for: inDays(2), asset_id: ad.id, format: 'post', is_sample: true }).select('id').single(), 'sample');
must(await db.from('approvals').insert({ tenant_id: t.id, subject_kind: 'post', title: 'Verify post sample', body: {}, lane: 'required', approver: 'client', status: 'approved', content_item_id: sample.id }), 'sample approval');
// Approved but its planned time passed five hours ago.
const late = must(await plan(asOps, { p_asset: story.id }), 'late post');
must(await asOwner.rpc('decide_approval', { p_id: must(await db.from('approvals').select('id').eq('content_item_id', late).single(), 'la').id, p_decision: 'approved' }), 'approve late');
must(await db.from('content_items').update({ scheduled_for: new Date(Date.now() - 5 * 3_600_000).toISOString() }).eq('id', late), 'make late');

// 2b. a batch (a month of posts): each post gets its own approval, the owner gets ONE email; a single post still emails
const owner = (await users()).find((x) => x.email === `owner@${SLUG}.example`);
// By outbox id, not time: this machine's clock and the database's can differ by seconds.
const lastMail = async () => (await db.from('outbox').select('id').order('id', { ascending: false }).limit(1)).data?.[0]?.id ?? 0;
const mails = async (after) => must(await db.from('outbox').select('to_email, data, dedupe_key').eq('tenant_id', t.id).eq('template', 'approval_waiting').gt('id', after), 'outbox');
const before = await lastMail();
const batchStart = new Date(Date.now() - 120_000).toISOString();
const batch = [
  { asset: ad.id, channel: 'facebook', format: 'post', copy: 'Verify post batch one', when: inDays(3) },
  { asset: ad.id, channel: 'instagram', format: 'post', copy: 'Verify post batch one', when: inDays(3) },
  { asset: story.id, channel: 'instagram', format: 'story', copy: '', when: inDays(4) },
];
const nb = await db.rpc('plan_post_batch', { p_tenant: t.id, p_posts: batch });
const bm = await mails(before);
const batchApprovals = must(await db.from('approvals').select('id, body').eq('tenant_id', t.id).not('body->>batch', 'is', null).gte('requested_at', batchStart), 'batch approvals');
check(nb.data === 3 && batchApprovals.length === 3 && bm.length === 1 && bm[0].to_email === owner?.email && bm[0].data.count === 3 && /3 posts for (Facebook and Instagram|Instagram and Facebook)/.test(bm[0].data.title), `a batch of 3: three approvals, one email to the owner (“${bm[0]?.data.title}”, ${bm.length} email)`);
const badBatch = await db.rpc('plan_post_batch', { p_tenant: t.id, p_posts: [batch[0], { ...batch[1], asset: theirs.id }] });
const after = must(await db.from('content_items').select('id').eq('tenant_id', t.id).eq('copy', 'Verify post batch one'), 'after bad');
check(badBatch.error && after.length === 2, `one bad post refuses the whole batch, nothing half-loaded (${badBatch.error?.message})`);
const noBatch = await asOps.rpc('plan_post_batch', { p_tenant: t.id, p_posts: batch });
check(noBatch.error, 'a batch can only come from the Genovus server, not a signed-in person');
const before2 = await lastMail();
must(await plan(asOps, { p_when: inDays(5) }), 'single');
check((await mails(before2)).length === 1, 'a single planned post still emails the owner once');
for (const a of batchApprovals) must(await db.from('content_items').delete().eq('id', (await db.from('approvals').select('content_item_id').eq('id', a.id).single()).data.content_item_id), 'clear batch');

// 3. sending
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); if (s.startsWith('@/')) return next(new URL('../' + s.slice(2) + (/\\.[a-z]+$/.test(s) ? '' : '.ts'), ${JSON.stringify(new URL('./', import.meta.url).href)}).href, c); throw e; } }`));
const P = await import('../lib/post-distribute.ts');
const M = await import('../lib/metricool.ts');
const ORIGIN = 'https://genovus.test';
let r = await P.sendApprovedPosts(ORIGIN);
check(sent.length === 0 && r.skipped >= 2, `no brand on the agency yet: nothing goes out (${JSON.stringify(r)})`);
must(await db.from('tenants').update({ metricool_blog_id: BLOG }).eq('id', t.id), 'brand');
r = await P.sendApprovedPosts(ORIGIN);
const row = async (id) => must(await db.from('content_items').select('status, mc_status, mc_post_id, mc_error, post_url').eq('id', id).single(), 'row');
const ig = sent.find((s) => s.body.providers[0].network === 'instagram'), fb = sent.find((s) => s.body.providers[0].network === 'facebook');
check(sent.length === 2 && sent.every((s) => s.blogId === BLOG), `only the two owner-approved posts go out, both on the agency’s own brand (${sent.length} sent: ${JSON.stringify(r)})`);
check(ig?.body.instagramData.type === 'POST' && !('showReelOnFeed' in ig.body.instagramData) && ig.body.instagramData.isAiGenerated === false && /local Columbus agent/.test(ig.body.text ?? ''), 'Instagram gets a feed image post with its caption (not a Reel)');
check(fb?.body.facebookData.type === 'STORY' && !('text' in fb.body), 'Facebook gets the story with no caption');
const media = new URL(ig?.body.media?.[0] ?? 'https://x/');
check(media.origin === ORIGIN && media.pathname === `/api/media/signed/asset/${ad.id}.jpg` && media.searchParams.get('sig'), 'the image goes through a signed, expiring link');
check(ig?.body.draft === true && ig.body.autoPublish === false && (await row(feed.data)).status === 'approved' && (await row(feed.data)).mc_status === 'DRAFT', 'draft mode: a Metricool draft, and the post stays “approved”, not booked');
check(!sent.some((s) => /sample/.test(s.body.text ?? '')) && (await row(waiting)).mc_status === null && (await row(sample.id)).mc_status === null, 'a sample post and a post still waiting on the owner are never sent');
const lr = await row(late);
check(lr.mc_status === 'NEEDS_TIME' && lr.status === 'approved', `approved hours after its time: held for a new time (${lr.mc_error})`);
r = await P.sendApprovedPosts(ORIGIN);
check(r.sent === 0 && sent.length === 2, 'a second run sends nothing twice');
process.env.METRICOOL_MODE = 'publish';
const liveId = must(await plan(asOps, {}), 'live post');
must(await asOwner.rpc('decide_approval', { p_id: must(await db.from('approvals').select('id').eq('content_item_id', liveId).single(), 'al').id, p_decision: 'approved' }), 'approve live');
await P.sendApprovedPosts(ORIGIN);
check((await row(liveId)).status === 'scheduled' && sent.at(-1)?.body.autoPublish === true, 'publish mode: the approved post is booked to go out');
await P.syncAgencyPosts();
const done = await row(liveId);
check(done.status === 'published' && done.post_url === 'https://www.instagram.com/p/verify/', 'when the network posts it, the post is marked published with its live link');

// 4. the signed link
const { signedMediaUrl } = await import('../lib/media-link.ts');
const route = await import('../app/api/media/signed/[kind]/[file]/route.ts');
const hit = async (u) => { const x = new URL(u); const [, , , , kind, file] = x.pathname.split('/'); return route.GET(new Request(x), { params: Promise.resolve({ kind, file }) }); };
const good = signedMediaUrl(ORIGIN, 'asset', ad.id);
const res = await hit(good);
const got = res.status === 200 ? Buffer.from(await res.arrayBuffer()) : null;
check(res.status === 200 && res.headers.get('content-type') === 'image/jpeg' && got?.equals(bytes), `the signed link serves the ad itself (${res.status}, ${got?.length ?? 0} bytes)`);
const bad = await hit(good.replace(/sig=[^&]+/, 'sig=AAAA'));
const asVideo = await hit(signedMediaUrl(ORIGIN, 'final', ad.id));
const inner = await hit(signedMediaUrl(ORIGIN, 'asset', internal.id));
check(bad.status === 404 && asVideo.status === 404 && inner.status === 404, 'nothing for a bad signature, a video kind, or an internal file');

// 5. the Studio's posts are unchanged
const n = sent.length;
await M.schedulePost({ blogId: BLOG, network: 'instagram', text: 'Verify studio', mediaUrl: 'https://x/v.mp4', when: new Date(Date.now() + 3_600_000), vertical: true, aiGenerated: true });
await M.schedulePost({ blogId: BLOG, network: 'facebook', text: 'Verify studio', mediaUrl: 'https://x/v.mp4', when: new Date(Date.now() + 3_600_000), vertical: false, aiGenerated: true });
check(sent[n]?.body.instagramData.type === 'REEL' && sent[n].body.instagramData.showReelOnFeed === true && sent[n + 1]?.body.facebookData.type === 'POST' && sent[n].body.text === 'Verify studio', 'the Studio still posts an Instagram Reel and a Facebook post, with captions');

await clean();
await del(KEY).catch(() => {});
mock.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
