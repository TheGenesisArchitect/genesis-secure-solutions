// Helix threads: the saved Ask Helix conversation that travels with a person across pages, reloads and devices.
// Reads use the person's own session (row-level security: their own threads, their agency owner, the Genovus team);
// writes go through helix_append (0066), which checks the account and surface again.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Viewer } from './session';
import { accessFor } from './access';
import { HOUSE_SLUG } from './phone-line';
import type { HelixTurn } from './helix-agency';
import type { ProgramId } from './programs';

export type HelixSurface = 'agency' | 'enterprise' | 'studio';
/** A saved turn as the drawer shows it: who said it, where, and what came with an answer. */
export type SavedTurn = { role: 'user' | 'helix'; text: string; page?: string; channel?: 'text' | 'voice'; meta?: Record<string, unknown> };
export type HelixScope = { tenantId: string; name: string; plan: string | null; program?: ProgramId };

/** Turns Helix reads before a question (the newest ones, oldest first). */
export const HISTORY_TURNS = 16;
/** Turns the drawer restores on a new page load or device. */
export const RESTORE_TURNS = 30;

/** Which account a Helix conversation belongs to, or why this person can't have one here. */
export async function helixScope(supabase: SupabaseClient, viewer: Viewer, surface: HelixSurface, slug?: string): Promise<HelixScope | { error: string; status: number }> {
  if (surface === 'agency') {
    const m = viewer.memberships.find((x) => x.slug === slug);
    const t = m ? { id: m.tenantId, name: m.name, plan: m.plan } : viewer.staff ? (await supabase.from('tenants').select('id, name, plan').eq('slug', String(slug ?? '')).maybeSingle()).data : null;
    if (!t) return { error: 'Not your agency.', status: 403 };
    const access = await accessFor(t.id, t.plan);
    if (!access.has('helix')) return { error: 'Ask Helix is part of Growth. Ask the Genovus team for a trial.', status: 403 };
    return { tenantId: t.id, name: t.name, plan: t.plan, program: access.program };
  }
  if (!viewer.staff) return { error: 'Enterprise Helix is for the Genovus team.', status: 403 };
  const { data: house } = await supabase.from('tenants').select('id, name').eq('slug', HOUSE_SLUG).maybeSingle();
  if (!house) return { error: 'The Genovus account is missing.', status: 500 };
  return { tenantId: house.id, name: house.name, plan: null };
}

/** The person's thread to continue: the one they name if it's theirs and open, else their latest from the last week. */
export async function openThread(supabase: SupabaseClient, viewer: Viewer, scope: HelixScope, surface: HelixSurface, threadId?: string | null) {
  const base = () => supabase.from('helix_threads').select('id, title, last_page, last_at').eq('user_id', viewer.userId).eq('tenant_id', scope.tenantId).eq('surface', surface).is('archived_at', null);
  if (threadId && /^[0-9a-f-]{36}$/i.test(threadId)) {
    const { data } = await base().eq('id', threadId).maybeSingle();
    if (data) return data;
  }
  const { data } = await base().gt('last_at', new Date(Date.now() - 7 * 86_400_000).toISOString()).order('last_at', { ascending: false }).limit(1).maybeSingle();
  return data ?? null;
}

/** The newest `limit` turns of a thread, oldest first. */
export async function threadTurns(supabase: SupabaseClient, threadId: string, limit: number): Promise<SavedTurn[]> {
  const { data } = await supabase.from('helix_messages').select('id, role, channel, text, page, meta').eq('thread_id', threadId).order('id', { ascending: false }).limit(limit);
  return (data ?? []).reverse().map((m) => ({ role: m.role, text: m.text, page: m.page ?? undefined, channel: m.channel, meta: m.meta && Object.keys(m.meta).length ? m.meta : undefined }));
}

/** What Helix reads before answering: the thread so far, as plain turns. */
export const historyOf = (turns: SavedTurn[]): HelixTurn[] => turns.map((t) => ({ role: t.role, text: t.text.slice(0, 1500) }));

/** Save turns to the person's thread (continuing `threadId` when it's theirs); returns the thread, or null if saving failed. */
export async function saveTurns(supabase: SupabaseClient, scope: HelixScope, surface: HelixSurface, threadId: string | null | undefined, page: string | undefined, turns: (SavedTurn & { context?: string })[]): Promise<string | null> {
  const { data, error } = await supabase.rpc('helix_append', { p_thread: threadId && /^[0-9a-f-]{36}$/i.test(threadId) ? threadId : null, p_tenant: scope.tenantId, p_surface: surface, p_page: page ?? '', p_turns: turns });
  if (error) { console.error(`[helix-thread] save failed: ${error.message}`); return null; }
  return data as string;
}
