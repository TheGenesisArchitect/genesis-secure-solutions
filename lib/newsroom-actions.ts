// The Newsroom's buttons, shared by the page (app/api/studio/newsroom) and Helix (lib/helix-studio-act.ts), so a
// spoken "research it deeper" runs exactly what the button runs. Genovus team only (callers check staff).
import 'server-only';
import { after } from 'next/server';
import { adminDb } from '@/lib/supabase/admin';
import { deskFor } from '@/lib/desk';
import { produce, researchBeat, researchDeeper, useForNextUpload } from '@/lib/newsroom';
import { buildFaceless, startFaceless, type FacelessLength } from '@/lib/unedit-faceless';
import { writeBrief } from '@/lib/newsroom-morning';
import { sweepFree } from '@/lib/newsroom-feed';

const UUID = /^[0-9a-f-]{36}$/;
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

/** One Newsroom action. Returns what happened in words (and the production id after produce); throws a plain error. */
export async function newsroomAction(b: Record<string, unknown>, by: string, origin: string): Promise<{ say: string; id?: string }> {
  // The desk this button is on (the house desk when none is named; lib/desk.ts).
  const tenant = (await deskFor(typeof b.desk === 'string' ? b.desk : null)).id;
  const id = (k: string) => { const v = String(b[k] ?? ''); if (!UUID.test(v)) throw new Error('Which one?'); return v; };
  const story = async (sid: string) => { const { data } = await adminDb().from('newsroom_stories').select('id, angles').eq('id', sid).eq('tenant_id', tenant).single(); if (!data) throw new Error('Story not found.'); return data; };
  const touch = { updated_at: new Date().toISOString() };
  switch (b.tool) {
    case 'research': {
      const r = await researchBeat(tenant, String(b.beat ?? ''), by, b.sub ? String(b.sub) : null);
      const say = r.added ? `Helix filed ${r.added} new ${r.added === 1 ? 'story' : 'stories'} (${money(r.cents)}).` : `Nothing new worth filing on this beat right now (${money(r.cents)}).`;
      return { say: r.notes.length ? `${say} ${r.notes.slice(0, 2).join('; ')}.` : say };
    }
    case 'deeper': {
      const r = await researchDeeper(tenant, id('story'), by);
      return { say: r.added ? `Helix found ${r.added} new ${r.added === 1 ? 'fact' : 'facts'}. They wait for your approval before anything uses them (${money(r.cents)}).` : `Nothing new that meets the standards yet (${money(r.cents)}).` };
    }
    case 'set_build': {
      const sid = id('story'); await story(sid);
      const parts = (Array.isArray(b.parts) ? b.parts : []).map((p) => String(p).replace(/\s+/g, ' ').trim().slice(0, 160)).filter(Boolean).slice(0, 10);
      await adminDb().from('newsroom_stories').update({ build: parts, ...touch }).eq('id', sid);
      return { say: 'Story parts saved.' };
    }
    case 'set_angle': {
      const sid = id('story'); const s = await story(sid);
      const n = Number(b.angle);
      if (!(n >= 0 && n < (s.angles as unknown[]).length)) throw new Error('Pick one of the angles.');
      await adminDb().from('newsroom_stories').update({ chosen_angle: n, ...touch }).eq('id', sid);
      return { say: 'Angle picked.' };
    }
    case 'voiced': {
      const sid = id('story'); await story(sid);
      await adminDb().from('newsroom_stories').update({ voiced: Boolean(b.on), ...touch }).eq('id', sid);
      return { say: b.on ? 'Helix will write it in your voice. The facts stay as sourced.' : 'Back to the plain voice.' };
    }
    case 'approve_claim': case 'drop_claim': {
      const cid = id('claim');
      const q = adminDb().from('newsroom_claims');
      const r = b.tool === 'approve_claim' ? await q.update({ approved: true }).eq('id', cid).eq('tenant_id', tenant) : await q.delete().eq('id', cid).eq('tenant_id', tenant);
      if (r.error) throw new Error(r.error.message);
      return { say: b.tool === 'approve_claim' ? 'Fact approved.' : 'Fact taken out.' };
    }
    case 'dismiss': {
      const sid = id('story'); await story(sid);
      await adminDb().from('newsroom_stories').update({ status: 'dismissed', ...touch }).eq('id', sid);
      return { say: 'Story taken off the wire.' };
    }
    case 'produce': {
      const r = await produce(tenant, id('story'), { angle: Number(b.angle ?? 0), formats: (Array.isArray(b.formats) ? b.formats : []).map(String), voiced: Boolean(b.voiced) }, by);
      return { id: r.id, say: `Your package is ready (${money(r.cents)}).${r.notes.length ? ` ${r.notes.length} sheet ${r.notes.length === 1 ? 'line was' : 'lines were'} left out.` : ''}` };
    }
    case 'next_upload': {
      await useForNextUpload(tenant, id('production'));
      return { say: 'Your next Unedit upload will be cut against this package, with its sources on screen.' };
    }
    case 'sweep': {
      // The free wire on demand: every beat's public feeds read now (no paid search).
      const r = await sweepFree(tenant);
      return { say: r.added ? `The free wire added ${r.added} ${r.added === 1 ? 'story' : 'stories'} across ${r.beats} beats. Write the brief next.` : 'Nothing new on the free wire since the last sweep.' };
    }
    case 'brief': {
      const w = await writeBrief(tenant);
      return { say: w ? `Today's brief: ${w.hot.length} hot ${w.hot.length === 1 ? 'topic' : 'topics'} to review.` : 'Nothing on the desk to brief yet: research first.' };
    }
    case 'faceless': {
      const prod = id('production');
      const r = await startFaceless(tenant, prod, { voice: String(b.voice ?? ''), length: (b.length === 'full' ? 'full' : 'short') as FacelessLength });
      after(async () => { console.info(`[newsroom] ${prod} ${await buildFaceless(tenant, prod, origin, by)}`); });
      return { say: `Helix is voicing ${r.lines} lines and building the faceless video (about ${money(r.cents)} for the voice). It opens in Unedit when it's ready, usually in a few minutes.` };
    }
    default: throw new Error('Unknown action.');
  }
}
