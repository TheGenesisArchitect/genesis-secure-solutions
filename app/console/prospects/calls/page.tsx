// The call list: offices due a call, best fit first, in focus states, never opted out. Humans dial; outcomes
// are one tap. Offices outside their local calling hours (weekdays 9:30–4:30) drop to the bottom.
import Link from 'next/link';
import { ConsoleShell } from '@/components/ConsoleShell';
import { ActionForm } from '@/components/ActionForm';
import { Panel, Chip, Empty } from '@/components/ui';
import { requireStaff } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { getDetails, GOOGLE_ATTRIBUTION } from '@/lib/places';
import { scanSettings } from '@/lib/scanner';
import { OUTCOMES, officeClock } from '@/lib/prospects';
import { logProspect } from '@/lib/scan-actions';

export const metadata = { title: 'Call list' };
export const dynamic = 'force-dynamic';

const TALKING_POINTS = [
  'Who we are: Genovus builds local websites and social profiles for agents, written to their carrier’s rules and approved by them.',
  'Why them: offices without their own site lose local searches to neighbors; we set them up live in days.',
  'The offer: Launch is $1,500 setup, then optional monthly care. A 15-minute consult, no obligation.',
  'Never quote insurance or imply a carrier endorsement. If they ask not to be called, log “Asked not to be contacted”.',
];

export default async function Calls() {
  await requireStaff();
  const supabase = await db();
  const settings = await scanSettings();
  const now = new Date().toISOString();
  const { data: due } = await supabase.from('prospects')
    .select('id, code, place_id, state, status, fit_score, contact_name, carriers(name)')
    .in('status', ['new', 'verified', 'contacting'])
    .in('state', settings.states)
    .or(`next_action_at.is.null,next_action_at.lte.${now}`)
    .order('fit_score', { ascending: false })
    .limit(30);
  const { data: blocked } = await supabase.from('suppression').select('place_id').not('place_id', 'is', null);
  const skip = new Set((blocked ?? []).map((b) => b.place_id));
  const list = (due ?? []).filter((p) => !skip.has(p.place_id)).map((p) => ({ ...p, clock: officeClock(p.state) }))
    .sort((a, b) => Number(b.clock.callable) - Number(a.clock.callable) || b.fit_score - a.fit_score).slice(0, 10);
  const details = await Promise.all(list.map((p) => getDetails(p.place_id)));
  return (
    <ConsoleShell title="Call list" crumbs={[{ href: '/console', label: 'Enterprise' }, { href: '/console/prospects', label: 'Prospects' }, { label: 'Call list' }]}>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <Panel title="Next 10 calls" sub={`Best fit first in ${settings.states.join(', ')}; offices open for calls now come first`}>
          {list.length ? (
            <ul className="list">
              {list.map((p, i) => {
                const d = details[i];
                return (
                  <li key={p.id} style={{ gap: 8 }}>
                    <div className="spread">
                      <Link href={`/console/prospects/${p.code}`}><b>{d?.name || p.contact_name || `Office ${p.code}`}</b></Link>
                      <span className="row" style={{ gap: 6 }}><Chip kind="info">Fit {p.fit_score}</Chip>{p.clock.callable ? <Chip kind="done">{p.clock.label}</Chip> : <Chip kind="pending">{p.clock.label}</Chip>}</span>
                    </div>
                    <span className="muted" style={{ fontSize: 13 }}>{(p.carriers as { name?: string } | null)?.name ?? 'Independent'} · {d?.address ?? p.state}</span>
                    {d?.phone ? <a className="btn small primary" href={`tel:${d.phone}`} style={{ justifySelf: 'start' }}>Call {d.phone}</a> : <span className="muted" style={{ fontSize: 13 }}>No phone listed: open the office for details.</span>}
                    <ActionForm action={logProspect} className="row">
                      <input type="hidden" name="id" value={p.id} />
                      <select className="select" name="outcome" required defaultValue="" aria-label="Outcome" style={{ flex: 1 }}>
                        <option value="" disabled>Outcome…</option>
                        {OUTCOMES.map(([o, l]) => <option key={o} value={o}>{l}</option>)}
                      </select>
                      <input className="input" name="next" type="date" aria-label="Next call" style={{ width: 160 }} />
                      <button className="btn small" type="submit">Log</button>
                    </ActionForm>
                  </li>
                );
              })}
            </ul>
          ) : <Empty title="No calls due">Run the scanner, widen the focus states, or check back when follow-ups come due.</Empty>}
          {list.length ? <p className="muted" style={{ fontSize: 12, margin: 0 }}>{GOOGLE_ATTRIBUTION}</p> : null}
        </Panel>
        <Panel title="Talking points" sub="Keep it short and honest">
          <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 8, fontSize: 14 }}>{TALKING_POINTS.map((t) => <li key={t}>{t}</li>)}</ol>
        </Panel>
      </div>
    </ConsoleShell>
  );
}
