// The Genovus Newsroom's actions, Genovus team only: research a beat live, research one story deeper, shape a
// story (parts, angle, voice), approve or drop a claim, produce the content package, and hand it to the next upload.
// Research and production can take a few minutes (live web search), and a faceless version is voiced and rendered
// in the background after the answer, hence the long limit.
import { after } from 'next/server';
import { db } from '@/lib/supabase/server';
import { adminDb } from '@/lib/supabase/admin';
import { genovusTenant } from '@/lib/unedit';
import { produce, researchBeat, researchDeeper, useForNextUpload } from '@/lib/newsroom';
import { buildFaceless, startFaceless, type FacelessLength } from '@/lib/unedit-faceless';

export const dynamic = 'force-dynamic';
export const maxDuration = 800;

const UUID = /^[0-9a-f-]{36}$/;
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

export async function POST(req: Request) {
  const supabase = await db();
  const [{ data: staff }, { data: auth }] = await Promise.all([supabase.rpc('is_staff'), supabase.auth.getUser()]);
  if (!staff || !auth.user) return Response.json({ ok: false, error: 'Only the Genovus team can use the newsroom.' }, { status: 403 });
  let b: Record<string, unknown>;
  try { b = (await req.json()) as Record<string, unknown>; } catch { return Response.json({ ok: false, error: 'Bad request.' }, { status: 400 }); }
  const tenant = await genovusTenant();
  const by = auth.user.id;
  const id = (k: string) => { const v = String(b[k] ?? ''); if (!UUID.test(v)) throw new Error('Which one?'); return v; };
  const story = async (sid: string) => { const { data } = await adminDb().from('newsroom_stories').select('id, angles').eq('id', sid).eq('tenant_id', tenant).single(); if (!data) throw new Error('Story not found.'); return data; };
  const touch = { updated_at: new Date().toISOString() };
  try {
    switch (b.tool) {
      case 'research': {
        const r = await researchBeat(tenant, String(b.beat ?? ''), by, b.sub ? String(b.sub) : null);
        const say = r.added ? `Helix filed ${r.added} new ${r.added === 1 ? 'story' : 'stories'} (${money(r.cents)}).` : `Nothing new worth filing on this beat right now (${money(r.cents)}).`;
        return Response.json({ ok: true, say: r.notes.length ? `${say} ${r.notes.slice(0, 2).join('; ')}.` : say });
      }
      case 'deeper': {
        const r = await researchDeeper(tenant, id('story'), by);
        return Response.json({ ok: true, say: r.added ? `Helix found ${r.added} new ${r.added === 1 ? 'fact' : 'facts'}. They wait for your approval before anything uses them (${money(r.cents)}).` : `Nothing new that meets the standards yet (${money(r.cents)}).` });
      }
      case 'set_build': {
        const sid = id('story'); await story(sid);
        const parts = (Array.isArray(b.parts) ? b.parts : []).map((p) => String(p).replace(/\s+/g, ' ').trim().slice(0, 160)).filter(Boolean).slice(0, 10);
        await adminDb().from('newsroom_stories').update({ build: parts, ...touch }).eq('id', sid);
        return Response.json({ ok: true, say: 'Story parts saved.' });
      }
      case 'set_angle': {
        const sid = id('story'); const s = await story(sid);
        const n = Number(b.angle);
        if (!(n >= 0 && n < (s.angles as unknown[]).length)) throw new Error('Pick one of the angles.');
        await adminDb().from('newsroom_stories').update({ chosen_angle: n, ...touch }).eq('id', sid);
        return Response.json({ ok: true, say: 'Angle picked.' });
      }
      case 'voiced': {
        const sid = id('story'); await story(sid);
        await adminDb().from('newsroom_stories').update({ voiced: Boolean(b.on), ...touch }).eq('id', sid);
        return Response.json({ ok: true, say: b.on ? 'Helix will write it in your voice. The facts stay as sourced.' : 'Back to the plain voice.' });
      }
      case 'approve_claim': case 'drop_claim': {
        const cid = id('claim');
        const q = adminDb().from('newsroom_claims');
        const r = b.tool === 'approve_claim' ? await q.update({ approved: true }).eq('id', cid).eq('tenant_id', tenant) : await q.delete().eq('id', cid).eq('tenant_id', tenant);
        if (r.error) throw new Error(r.error.message);
        return Response.json({ ok: true, say: b.tool === 'approve_claim' ? 'Fact approved.' : 'Fact taken out.' });
      }
      case 'dismiss': {
        const sid = id('story'); await story(sid);
        await adminDb().from('newsroom_stories').update({ status: 'dismissed', ...touch }).eq('id', sid);
        return Response.json({ ok: true, say: 'Story taken off the wire.' });
      }
      case 'produce': {
        const r = await produce(tenant, id('story'), { angle: Number(b.angle ?? 0), formats: (Array.isArray(b.formats) ? b.formats : []).map(String), voiced: Boolean(b.voiced) }, by);
        return Response.json({ ok: true, id: r.id, say: `Your package is ready (${money(r.cents)}).${r.notes.length ? ` ${r.notes.length} sheet ${r.notes.length === 1 ? 'line was' : 'lines were'} left out.` : ''}` });
      }
      case 'next_upload': {
        await useForNextUpload(tenant, id('production'));
        return Response.json({ ok: true, say: 'Your next Unedit upload will be cut against this package, with its sources on screen.' });
      }
      case 'faceless': {
        const prod = id('production');
        const r = await startFaceless(tenant, prod, { voice: String(b.voice ?? ''), length: (b.length === 'full' ? 'full' : 'short') as FacelessLength });
        const origin = new URL(req.url).origin;
        after(async () => { console.info(`[newsroom] ${prod} ${await buildFaceless(tenant, prod, origin, by)}`); });
        return Response.json({ ok: true, say: `Helix is voicing ${r.lines} lines and building the faceless video (about ${money(r.cents)} for the voice). It opens in Unedit when it's ready, usually in a few minutes.` });
      }
      default: return Response.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
    }
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : 'That didn’t work.' }, { status: 400 });
  }
}
