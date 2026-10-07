// Shown while a dashboard page loads, in the same shape as the page, so nothing jumps when it arrives.
export function DashboardSkeleton() {
  const block = (h: number) => <div className="skel" style={{ height: h }} />;
  return (
    <div className="dash" aria-busy="true" aria-label="Loading">
      <aside className="rail">{block(28)}{block(36)}{block(200)}</aside>
      <div className="main">
        <div className="topbar">{block(22)}</div>
        <div className="content">
          <div className="grid g4">{block(96)}{block(96)}{block(96)}{block(96)}</div>
          <div className="grid g2">{block(220)}{block(220)}</div>
        </div>
      </div>
    </div>
  );
}
