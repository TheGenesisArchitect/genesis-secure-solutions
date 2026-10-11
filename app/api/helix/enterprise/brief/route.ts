// Enterprise Helix's morning brief: made once a day, the first time someone on the team opens the overview, and
// cached under the Genovus house account. It is written from the operations brief (no Finance section), so the
// cached text is safe for every staff role; the money line on the overview is computed live for money roles only.
import { getViewer } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { adminDb } from '@/lib/supabase/admin';
import { askHelix } from '@/lib/helix-agency';
import { ENTERPRISE_SYSTEM, enterpriseBrief } from '@/lib/helix-enterprise';
import { businessToday } from '@/lib/billing';
import { HOUSE_SLUG } from '@/lib/phone-line';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ASK = 'Write the Genovus team’s morning brief for today. Start with the single most important move. Then one line per department that has something worth doing today: Sales (calls due, new inquiries, Genovus line callers to call back), Pipeline (who is stuck and the next step), Clients & delivery (approvals, care requests, trials ending, an agency whose numbers slipped), Studio (budget), Spend. Numbers and names, no filler. No drafts. No remember items.';

export async function POST() {
  const viewer = await getViewer().catch(() => null);
  if (!viewer?.staff) return Response.json({ error: 'Staff only.' }, { status: 403 });
  const admin = adminDb();
  const { data: house } = await admin.from('tenants').select('id').eq('slug', HOUSE_SLUG).maybeSingle();
  if (!house) return Response.json({ error: 'The Genovus house account is missing.' }, { status: 500 });
  const { data: have } = await admin.from('helix_briefs').select('body').eq('tenant_id', house.id).eq('day', businessToday()).maybeSingle();
  if (have) return Response.json(have.body);
  try {
    const brief = await enterpriseBrief(await db(), { money: false });
    const reply = await askHelix(brief.text, [], ASK, undefined, ENTERPRISE_SYSTEM);
    const body = { answer: reply.answer, followUps: [], drafts: [] };
    await admin.from('helix_briefs').upsert({ tenant_id: house.id, day: businessToday(), body, model: reply.model }, { onConflict: 'tenant_id,day' });
    return Response.json(body);
  } catch (e) {
    console.error(`[helix-enterprise-brief] ${e instanceof Error ? e.message : e}`);
    return Response.json({ error: 'Helix couldn’t write today’s brief just now.' }, { status: 502 });
  }
}
