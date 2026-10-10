// Pipeline (Growth): every lead by stage, New → Contacted → Booked → Won (Lost kept out of the way), with the
// source, how long it has waited, and the next step on each card. Move a lead with one tap; book a consult with a
// day and time and it lands on the calendar.
import Link from 'next/link';
import { ActionForm } from '@/components/ActionForm';
import { AgencyShell, agencyContext } from '@/components/AgencyShell';
import { ModuleGate } from '@/components/ModuleGate';
import { Chip } from '@/components/ui';
import { db } from '@/lib/supabase/server';
import { businessToday } from '@/lib/billing';
import { accessFor } from '@/lib/access';
import { bookLead, updateLead } from '@/lib/actions';

export const metadata = { title: 'Pipeline' };
export const dynamic = 'force-dynamic';

type Lead = { id: string; name: string; phone: string | null; email: string | null; topic: string | null; source: string; campaign: string | null; status: string; note: string | null; booked_for: string | null; created_at: string; updated_at: string };
const STAGES = [['new', 'New', 'Call while it’s fresh'], ['contacted', 'Contacted', 'Book the consult'], ['booked', 'Booked', 'Meet, then mark won or lost'], ['won', 'Won', 'Ask for a review']] as const;
const NEXT: Record<string, [string, string]> = { new: ['contacted', 'Contacted'], contacted: ['booked', 'Booked'], booked: ['won', 'Won'] };
const SOURCE: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', google: 'Google', direct: 'Direct' };
const age = (iso: string) => { const h = (Date.now() - new Date(iso).getTime()) / 3_600_000; return h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} d`; };
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });

export default async function Pipeline({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await agencyContext(slug);
  const access = await accessFor(ctx.tenant.tenantId, ctx.tenant.plan);
  if (!access.has('pipeline')) return <AgencyShell ctx={ctx} title="Pipeline"><ModuleGate ctx={ctx} moduleKey="pipeline" /></AgencyShell>;
  const supabase = await db();
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const { data } = await supabase.from('leads').select('id, name, phone, email, topic, source, campaign, status, note, booked_for, created_at, updated_at').eq('tenant_id', ctx.tenant.tenantId).or(`status.in.(new,contacted,booked),updated_at.gte.${since}`).order('created_at', { ascending: false }).limit(400);
  const leads = (data ?? []) as Lead[];
  const lost = leads.filter((l) => l.status === 'lost');
  const today = businessToday();
  const total = leads.filter((l) => l.status !== 'lost').length;
  const won = leads.filter((l) => l.status === 'won').length;
  return (
    <AgencyShell ctx={ctx} title="Pipeline" actions={<Link className="btn small" href={`/app/${slug}/leads`}>List view</Link>}>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>{total} active and recent leads · {won} won in the last 60 days{lost.length ? ` · ${lost.length} lost` : ''}. Nothing is sent to a lead from here.</p>
      <div className="board">
        {STAGES.map(([key, label, hint]) => {
          const col = leads.filter((l) => l.status === key);
          return (
            <section key={key} className="board-col" aria-label={label}>
              <header><b>{label}</b><span className="num muted">{col.length}</span></header>
              <span className="muted" style={{ fontSize: 12 }}>{hint}</span>
              {col.map((l) => (
                <article key={l.id} className="board-card">
                  <div className="spread" style={{ gap: 6 }}><b>{l.name}</b><span className="muted" style={{ fontSize: 12 }}>{age(l.created_at)}</span></div>
                  <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}><Chip kind="info">{SOURCE[l.source] ?? l.source}</Chip>{l.topic ? <span style={{ fontSize: 13 }}>{l.topic}</span> : null}</span>
                  {l.booked_for ? <span style={{ fontSize: 13 }}><b>Consult:</b> {when(l.booked_for)}</span> : null}
                  {l.note ? <span className="muted" style={{ fontSize: 12 }}>{l.note}</span> : null}
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    {l.phone ? <a className="btn small" href={`tel:${l.phone.replace(/[^\d+]/g, '')}`}>Call</a> : null}
                    {NEXT[key] && key !== 'contacted' ? <ActionForm action={updateLead}><input type="hidden" name="id" value={l.id} /><input type="hidden" name="status" value={NEXT[key][0]} /><button className="btn small primary" type="submit">{NEXT[key][1]} →</button></ActionForm> : null}
                    {key !== 'won' ? <ActionForm action={updateLead}><input type="hidden" name="id" value={l.id} /><input type="hidden" name="status" value="lost" /><button className="btn small ghost" type="submit">Lost</button></ActionForm> : null}
                  </div>
                  {key === 'contacted' || key === 'new' ? (
                    <details className="book">
                      <summary>Book a consult</summary>
                      <ActionForm action={bookLead} className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'end' }}>
                        <input type="hidden" name="id" value={l.id} />
                        <label className="field"><span>Day</span><input className="input" type="date" name="day" defaultValue={today} required /></label>
                        <label className="field"><span>Time</span><input className="input" type="time" name="time" defaultValue="10:00" required /></label>
                        <button className="btn small primary" type="submit">Book</button>
                      </ActionForm>
                    </details>
                  ) : null}
                </article>
              ))}
              {!col.length ? <span className="muted" style={{ fontSize: 13, padding: '8px 0' }}>None right now.</span> : null}
            </section>
          );
        })}
      </div>
    </AgencyShell>
  );
}
