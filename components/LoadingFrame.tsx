// What a screen shows the instant it's tapped, while its data loads: the dashboard frame with a content skeleton.
// Having these lets Next prefetch every dynamic route up to this frame, so navigation never sits on a blank wait.
import { Shell, type NavSection } from './Shell';

export function ContentSkeleton() {
  return (
    <div className="skel-page" aria-busy="true" aria-label="Loading">
      <div className="skel-row">{[0, 1, 2, 3].map((i) => <div key={i} className="skel skel-tile" />)}</div>
      <div className="skel skel-panel" />
      <div className="skel skel-panel short" />
    </div>
  );
}

export function LoadingFrame({ surface, home, nav }: { surface: string; home: string; nav: NavSection[] }) {
  return (
    <Shell surface={surface} home={home} title="" nav={nav} who={{ name: '', detail: '', signedOut: true }}>
      <ContentSkeleton />
    </Shell>
  );
}
