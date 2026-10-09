import { VisionShell } from '@/components/vision/VisionShell';
import { ApproveList } from '@/components/vision/ApproveList';
import { Panel, Chip } from '@/components/ui';
import { BRIEFING } from '@/data/vision';

export const metadata = { title: 'Daily Briefing · Growth Engine vision', robots: { index: false, follow: false } };

export default function Briefing() {
  return (
    <VisionShell
      slug="briefing"
      lede={<>Every morning the engine writes the <b>briefing</b>: what happened overnight, what’s next, and the few decisions only a person can make. Read it in two minutes; approve from your phone.</>}
      spec={[
        { title: 'Sources', items: [
          { k: 'Radar', v: 'New offices, closures, competitor ads (read-only sweeps).' },
          { k: 'Engine', v: 'Post insights, short views, calls and outcomes, consults, deposits, care.' },
          { k: 'Finance', v: 'Spend vs budget per market; paid-gate status.' },
        ] },
        { title: 'Delivery', items: [
          { k: 'Where', v: 'Console home, a morning email through the outbox, and (later) a short narrated version.' },
          { k: 'Approvals', v: 'Lane 3 items approved one by one; Lane 2 missions can be approved as a batch.' },
        ] },
        { title: 'Honesty', items: [
          { k: 'Rule', v: 'Every number in the briefing links to its audited fact; celebrations only for real events.' },
        ] },
      ]}
    >
      <div className="vgrid2" style={{ gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1fr)' }}>
        <Panel title={`Good morning, Anthony`} sub={BRIEFING.date} actions={<Chip kind="sample">Sample</Chip>}>
          <div className="brief">
            <div><h3>What happened</h3><ul>{BRIEFING.happened.map((h) => <li key={h}>{h}</li>)}</ul></div>
            <div><h3>What’s next</h3><ul>{BRIEFING.next.map((h) => <li key={h}>{h}</li>)}</ul></div>
          </div>
        </Panel>
        <Panel title="Needs your approval" sub="Only the decisions a person must make">
          <ApproveList items={BRIEFING.approve} />
        </Panel>
      </div>
    </VisionShell>
  );
}
