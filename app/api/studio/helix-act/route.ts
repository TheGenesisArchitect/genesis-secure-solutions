// Helix's hands in UnEdit Studio and the Newsroom (lib/helix-studio-act.ts), Genovus team only:
//   { tool: 'studio_action', args, current?, currentStory? }  press a button (yes-lane actions only return a summary)
//   { tool: 'confirm_studio_action', args: { token } }       run the action the person said yes to
//   { tool: 'open_studio', args: { place, name? } }           where to take the person (an address on UnEdit only)
// Slow actions (research, writing the package, sweeps, the brief) answer right away and finish in the background.
import { after } from 'next/server';
import { db } from '@/lib/supabase/server';
import { confirmStudioAction, studioAction } from '@/lib/helix-studio-act';
import { runStoryLookup } from '@/lib/helix-stories';

export const dynamic = 'force-dynamic';
export const maxDuration = 800;

const UUID = /^[0-9a-f-]{36}$/i;
const PLACES: Record<string, string> = { newsroom: '/console/studio/unedit/newsroom', recordings: '/console/studio/unedit', calendar: '/console/studio/unedit', record: '/console/studio/unedit/record', music: '/console/studio/unedit/music' };

export async function POST(req: Request) {
  const supabase = await db();
  const [{ data: staff }, { data: auth }] = await Promise.all([supabase.rpc('is_staff'), supabase.auth.getUser()]);
  if (!staff || !auth.user) return Response.json({ ok: false, error: 'Only the Genovus team can use the Studio.' }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { tool?: string; args?: Record<string, unknown>; current?: string; currentStory?: string };
  const args = b.args && typeof b.args === 'object' && !Array.isArray(b.args) ? Object.fromEntries(Object.entries(b.args).slice(0, 24)) : {};
  const ctx = { by: auth.user.id, origin: new URL(req.url).origin, current: UUID.test(String(b.current)) ? b.current : undefined, currentStory: UUID.test(String(b.currentStory)) ? b.currentStory : undefined };
  if (b.tool === 'open_studio') {
    const place = String(args.place ?? '');
    if (PLACES[place]) return Response.json({ ok: true, href: PLACES[place], anchor: place === 'calendar' ? 'Posting calendar' : undefined });
    if (place === 'story') {
      const r = await runStoryLookup(supabase, 'story_card', { headline: args.name }) as { found?: boolean; story?: { headline: string }; id?: string; closest?: string[] };
      if (!r.found) return Response.json({ ok: false, error: `No story matches “${args.name ?? ''}”.`, closest: r.closest });
      const { data } = await supabase.from('newsroom_stories').select('id').eq('headline', r.story!.headline).order('created_at', { ascending: false }).limit(1).maybeSingle();
      return Response.json({ ok: true, href: '/console/studio/unedit/newsroom', story: data?.id, headline: r.story!.headline });
    }
    if (place === 'recording') {
      const r = await studioActionLookup(String(args.name ?? ''), ctx.current);
      return Response.json(r);
    }
    return Response.json({ ok: false, error: 'Say newsroom, recordings, record, music, calendar, a story or a recording.' });
  }
  const r = b.tool === 'confirm_studio_action' ? await confirmStudioAction(String(args.token ?? ''), ctx) : b.tool === 'studio_action' ? await studioAction(String(args.action ?? ''), args, ctx) : { ok: false, error: 'Unknown tool.' };
  const { background, ...out } = r as typeof r & { background?: () => Promise<string> };
  if (background) after(async () => { try { console.info(`[helix-act] ${await background()}`); } catch (e) { console.error(`[helix-act] ${e instanceof Error ? e.message : e}`); } });
  return Response.json(out);
}

// A recording's page by title words (the same matching as the actions).
async function studioActionLookup(name: string, current?: string) {
  const { data } = await (await db()).from('unedit_vlogs').select('id, title, episode').order('created_at', { ascending: false }).limit(200);
  const { best } = await import('@/lib/helix-stories');
  const label = (v: { title: string | null; episode: { title?: string } | null }) => v.episode?.title || v.title || 'Recording';
  if (/^(this|this one)?$/i.test(name.trim()) && current) return { ok: true, href: `/console/studio/unedit/${current}` };
  const rows = ((data ?? []) as { id: string; title: string | null; episode: { title?: string } | null }[]).filter((v) => !/^\[test/i.test(label(v)));
  const r = best(rows, name, label);
  return r.row ? { ok: true, href: `/console/studio/unedit/${r.row.id}`, title: label(r.row) } : { ok: false, error: `No recording matches “${name}”.`, closest: r.others };
}
