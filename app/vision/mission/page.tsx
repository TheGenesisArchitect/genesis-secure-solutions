import { VisionShell, Src } from '@/components/vision/VisionShell';
import { MissionRun } from '@/components/vision/MissionRun';
import { MISSION } from '@/data/vision';

export const metadata = { title: 'Mission Control · Growth Engine vision', robots: { index: false, follow: false } };

export default function MissionPage() {
  return (
    <VisionShell
      slug="mission"
      lede={<>A <b>mission</b> turns a goal into a plan the team approves once. Agents do the work in order and every step is sealed in the audit chain. Anything public or paid still stops for a named person. Press <b>Approve mission</b> to watch it run.</>}
      spec={[
        { title: 'Model', items: [
          { k: 'Tables', v: <><code>missions</code> (goal, budget, status) · <code>mission_steps</code> (lane, agent, state, proposal_id) · steps reuse the existing <code>approvals</code> queue.</> },
          { k: 'Audit', v: 'Each step writes log_event with mission_id into the hash-chained audit_events (already live).' },
        ] },
        { title: 'Rules (Helix 2.0 canon)', items: [
          { k: 'One approval', v: 'Goal → plan → one batch approval → steps run.' },
          { k: 'Lane 3', v: 'Publishing, sending and spending are always confirmed individually, never standing approval.' },
          { k: 'Budget', v: 'A mission cannot spend past its budget; the step stops and asks.' },
        ] },
        { title: 'Agents', items: [
          { k: 'Orchestrator', v: <>Claude via the Anthropic API, one tenant per run; fast model for checks. <Src href="https://docs.anthropic.com/en/docs/about-claude/models">models</Src></> },
          { k: 'Verified Work', v: 'A second agent checks every outward draft before it reaches a person.' },
        ] },
      ]}
    >
      <MissionRun {...MISSION} />
    </VisionShell>
  );
}
