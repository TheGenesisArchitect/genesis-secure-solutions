// The Genovus wordmark: GEN · the golden egg · VUS. The egg (glossy orange, tipped 8°, 118% of the cap height) is
// the centerpiece and overlaps the N and V. Size it with font-size; `flat` drops the shadow for small sizes.
export function Wordmark({ size = 20, flat, color, className }: { size?: number; flat?: boolean; color?: string; className?: string }) {
  return (
    <span className={'gv-wm' + (flat || size < 24 ? ' flat' : '') + (className ? ` ${className}` : '')} style={{ fontSize: size, color }} aria-label="Genovus" role="img">
      <span aria-hidden="true">GEN</span>
      <img src="/brand/genovus/genovus-egg.svg" alt="" aria-hidden="true" />
      <span aria-hidden="true">VUS</span>
    </span>
  );
}

/** The egg on its own: icons, avatars, placeholders. */
export function Egg({ size = 40, className }: { size?: number; className?: string }) {
  return <img className={'gv-egg' + (className ? ` ${className}` : '')} src="/brand/genovus/genovus-egg.svg" alt="" width={Math.round(size * 0.78)} height={size} />;
}
