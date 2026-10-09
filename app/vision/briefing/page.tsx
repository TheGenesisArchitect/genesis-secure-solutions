import { VisionShell, Src } from '@/components/vision/VisionShell';
import { HelixLive } from '@/components/vision/HelixLive';
import { Panel } from '@/components/ui';

export const metadata = { title: 'Helix Live · Growth Engine vision', robots: { index: false, follow: false } };

const ASKS: [string, string, string, 'auto' | 'queued' | 'required'][] = [
  ['“Brief me.”', 'Reads the nightly analysis and what changed since', 'Ground layer, helix_events', 'auto'],
  ['“What’s hot?”', 'Ranks markets by heat score, with sample sizes', 'Meta, LinkedIn, YouTube insights; CallRail; funnel', 'auto'],
  ['“Rescan Columbus.”', 'Runs a Radar sweep against the monthly Places budget', 'Places API (metered)', 'auto'],
  ['“Build the call list.”', 'Ranks offices in the top markets by fit and warm signal, Do Not Call checked', 'Radar, Call Desk', 'auto'],
  ['“Set a Zoom with the team.”', 'Creates the meeting and calendar event', 'Zoom, Google Calendar', 'auto'],
  ['“Set a Zoom with that office.”', 'Drafts the invite to an external contact', 'Zoom, Calendar, Resend', 'required'],
  ['“Start the storyboard.”', 'Opens preproduction and reserves the estimated cost', 'Studio, provider adapter', 'queued'],
  ['“Move ad budget to Columbus.”', 'Proposes the reallocation with expected cost per consult', 'Meta and Google Ads APIs', 'required'],
  ['“Publish it.”', 'Publishes the approved version to its channels', 'Meta, LinkedIn, YouTube', 'required'],
];

export default function HelixLivePage() {
  return (
    <VisionShell
      slug="briefing"
      lede={<>Ask the business. It answers, then acts. By morning <b>Helix</b> has gone through the whole engine (Radar, engagement, calls, Studio, finance), briefs you, and you talk back in real time. It books the meeting, writes the brief, starts the storyboard and builds tomorrow’s call list, every action through the HAP lanes.</>}
      spec={[
        { title: 'Model stack', items: [
          { k: 'Voice', v: <>Gemini Live models stream speech both ways, can be interrupted and call tools mid-conversation. <Src href="https://ai.google.dev/gemini-api/docs/live">Live API</Src></> },
          { k: 'Reasoning', v: 'Nightly analysis, market heat and mission plans on the strongest reasoning model, through the existing Claude → Gemini fallback.' },
          { k: 'Rule', v: 'The voice reads the briefing and calls tools; it never invents a figure.' },
        ] },
        { title: 'How it learns', items: [
          { k: 'Memory', v: 'Preferences (stated, editable), facts (queried live), decisions and outcomes, playbooks promoted after evidence + a human approval.' },
          { k: 'Track record', v: <><code>helix_recommendations</code> scores every call it made against what happened next.</> },
          { k: 'Moat', v: 'The model is replaceable; the memory is the moat.' },
        ] },
        { title: 'Build sequence', items: [
          { k: 'V1', v: 'A briefing you read and chat with; auto-lane tools; recommendations logged from day one.' },
          { k: 'V2', v: 'Real-time voice; queued and required actions as HAP cards; Zoom and Calendar; Studio briefs.' },
          { k: 'V3', v: 'Helix proposes missions with a visible scorecard; Helix Live for Premium agencies.' },
        ] },
      ]}
    >
      <HelixLive />
      <Panel title="What you can ask, and what it does" sub="Every request routes through HAP: auto, queued, or required">
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>You say</th><th>Helix does</th><th>Systems</th><th>Lane</th></tr></thead>
            <tbody>{ASKS.map(([q, d, s, l]) => <tr key={q}><td><b>{q}</b></td><td>{d}</td><td className="muted">{s}</td><td><span className={'hx-lane ' + l} style={{ color: l === 'auto' ? 'var(--done)' : l === 'queued' ? 'var(--info)' : 'var(--accent)' }}>{l}</span></td></tr>)}</tbody>
          </table>
        </div>
      </Panel>
    </VisionShell>
  );
}
