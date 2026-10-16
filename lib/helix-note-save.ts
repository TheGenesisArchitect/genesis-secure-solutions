// "Make a note" from typed Ask Helix, saved where the person will look for it: an agency's own Helix notes (a real
// question goes to the Genovus team), or the Enterprise Helix notes inbox tagged with who asked. Voice notes take the
// same routes through /api/helix/notes.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminDb } from './supabase/admin';
import type { HelixScope, HelixSurface } from './helix-thread';

export type NoteKind = 'action_item' | 'idea' | 'question' | 'risk';
export const NOTE_KINDS: NoteKind[] = ['action_item', 'idea', 'question', 'risk'];

/** Save the note; returns where to open it. */
export async function saveHelixNote(db: SupabaseClient, scope: HelixScope, surface: HelixSurface, slug: string | undefined, userId: string, kind: string, raw: string): Promise<{ ok: true; href: string; kind: NoteKind } | { ok: false; error: string }> {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 600);
  if (text.length < 2) return { ok: false, error: 'Empty note.' };
  const k: NoteKind = NOTE_KINDS.includes(kind as NoteKind) ? (kind as NoteKind) : 'action_item';
  if (surface === 'agency') {
    // The office's own note (risk counts as an idea there); a question goes to the Genovus team.
    const { error } = await db.rpc('agency_add_helix_note', { p_tenant: scope.tenantId, p_kind: k === 'risk' ? 'idea' : k, p_text: text });
    return error ? { ok: false, error: error.message } : { ok: true, href: `/app/${slug}/helix/notes`, kind: k };
  }
  // Enterprise: the team's inbox. Action items and ideas are the team's own; questions are knowledge gaps.
  const { error } = await adminDb().from('helix_notes').insert({ kind: k, text, chapter: k === 'question' ? 'ask-helix' : 'helix', source: 'helix', tenant_id: scope.tenantId, asked_by: userId });
  return error ? { ok: false, error: 'The note could not be saved.' } : { ok: true, href: '/console/helix', kind: k };
}

/** The note rule typed Helix follows (both surfaces). */
export const noteRules = (surface: HelixSurface) => `
NOTES: when the person asks you to make a note, write something down, remind them or remember to do something, add
"note": {"kind": "action_item"|"idea"${surface === 'agency' ? '' : '|"risk"'}|"question", "text": one clear sentence} to your JSON and say in a few words that it's in Helix notes${surface === 'agency' ? ' (questions go to the Genovus team)' : ''}. Offer to open Helix notes.`;
