import { VisionShell, Src } from '@/components/vision/VisionShell';
import { CallSim } from '@/components/vision/CallSim';
import { CALL } from '@/data/vision';

export const metadata = { title: 'Call Desk · Growth Engine vision', robots: { index: false, follow: false } };

export default function Calls() {
  return (
    <VisionShell
      slug="calls"
      lede={<>Organic warms the market; <b>calls</b> close the loop. The Call Desk puts the best-fit office in front of a caller with the reason to call, the warm signal and an honest opener, then turns the call into an outcome and a booked consult.</>}
      spec={[
        { title: 'CallRail', items: [
          { k: 'Tracking', v: 'Local tracking numbers per market and campaign; inbound calls credited to the source.' },
          { k: 'Logging', v: 'Outbound calls from the CallRail app; call webhooks into prospect_events with duration and recording link.' },
          { k: 'Notes', v: 'Transcript → Call Desk agent summary → suggested outcome, confirmed by the caller.' },
        ] },
        { title: 'Rules', items: [
          { k: 'Dialing', v: <>By hand only; no auto-dialer or prerecorded messages. Mobile numbers checked against Do Not Call. <Src href="https://instantly.ai/blog/b2b-cold-calling-legal-guide/">guide</Src></> },
          { k: 'Recording', v: <>One-party consent states (Georgia) allow recording; two-party states announce it. <Src href="https://www.church.law/recording-phone-calls-in-georgia/">Georgia</Src></> },
          { k: 'Do not call', v: 'Opt-outs go to suppression immediately and permanently (built).' },
        ] },
        { title: 'Built today', items: [
          { k: 'Call list', v: 'Live: best fit first, local calling hours, opt-outs excluded, one-tap outcomes.' },
          { k: 'Next', v: 'CallRail integration, call summaries, booking from the outcome.' },
        ] },
      ]}
    >
      <CallSim {...CALL} />
    </VisionShell>
  );
}
