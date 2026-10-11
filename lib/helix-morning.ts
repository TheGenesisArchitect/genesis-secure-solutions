// Helix's morning brief: once a day per agency (the daily cron at 8 a.m. Eastern, or the first time Home opens that
// day), Helix reads the same brief Ask Helix uses and writes the day's plan: who to call back, which leads are new,
// what's on the calendar, which partner to call while the season fits. Cached in helix_briefs so opening Home is free.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { agencyBrief, askHelix, type HelixReply } from './helix-agency';
import { businessToday } from './billing';

const ASK = 'Write my morning brief for today. Start with the single most important thing. Then, in order: missed calls to return, new leads waiting for a first call, today’s consults and partner visits, and one partner worth calling because of the season. Use names, times and sources. Propose follow-ups for the calls I should make today (due today). No drafts unless a lead has waited over a day.';

export async function makeMorningBrief(db: SupabaseClient, tenantId: string, name: string, program: string): Promise<HelixReply> {
  const brief = await agencyBrief(db, tenantId, name, program);
  const reply = await askHelix(brief, [], ASK);
  await db.from('helix_briefs').upsert({ tenant_id: tenantId, day: businessToday(), body: reply, model: reply.model }, { onConflict: 'tenant_id,day' });
  return reply;
}
