// Stylized storyboard and post art drawn in SVG (no stock photos): each scene is a small composition in the
// Genovus palette, so frames read as "film storyboard", consistent and resolution-free.
export type Scene = 'dawn' | 'desk' | 'kitchen' | 'screen' | 'ring' | 'endcard' | 'street' | 'skyline';

export function SceneArt({ scene, label }: { scene: Scene; label?: string }) {
  const sky: Record<Scene, [string, string]> = {
    dawn: ['#2a1a3f', '#ff8a4c'], desk: ['#14161d', '#30364a'], kitchen: ['#0c0f18', '#1f2a44'], screen: ['#0b0c10', '#14161d'],
    ring: ['#1b1220', '#ff6a2b'], endcard: ['#0b0c10', '#1a1d24'], street: ['#1d2340', '#ffa31a'], skyline: ['#101a33', '#6aa8ff'],
  };
  const [a, b] = sky[scene];
  const id = `g-${scene}`;
  return (
    <svg viewBox="0 0 320 180" className="scene" role="img" aria-label={label ?? scene} preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={a} /><stop offset="1" stopColor={b} /></linearGradient>
        <radialGradient id={`${id}-glow`} cx="0.5" cy="0.5" r="0.5"><stop offset="0" stopColor="#ffd9a8" stopOpacity="0.9" /><stop offset="1" stopColor="#ffd9a8" stopOpacity="0" /></radialGradient>
      </defs>
      <rect width="320" height="180" fill={`url(#${id})`} />
      {scene === 'dawn' || scene === 'street' ? (
        <g>
          <circle cx="250" cy="120" r="46" fill={`url(#${id}-glow)`} />
          <circle cx="250" cy="122" r="16" fill="#ffd38a" />
          <path d="M0 132 L40 132 L40 96 L72 96 L72 132 L96 132 L96 84 L132 84 L132 132 L160 132 L160 104 L196 104 L196 132 L320 132 L320 180 L0 180 Z" fill="#0b0c10" />
          <rect x="104" y="98" width="10" height="12" fill="#ffb35c" opacity=".9" /><rect x="118" y="98" width="10" height="12" fill="#ffb35c" opacity=".5" />
          <rect x="52" y="108" width="8" height="10" fill="#ffb35c" opacity=".7" />
          {scene === 'dawn' ? <g><rect x="166" y="112" width="24" height="12" rx="2" fill="#3dd691" /><text x="178" y="121" textAnchor="middle" fontSize="7" fontWeight="700" fill="#052114">OPEN</text></g> : null}
          <path d="M0 150 L320 150" stroke="#ffffff22" />
        </g>
      ) : null}
      {scene === 'desk' ? (
        <g>
          <rect x="40" y="110" width="240" height="10" rx="3" fill="#2a2f3d" />
          <rect x="120" y="70" width="80" height="44" rx="4" fill="#0b0c10" stroke="#ffffff22" /><rect x="126" y="76" width="68" height="32" rx="2" fill="#1a2240" />
          <circle cx="70" cy="82" r="12" fill="#c5c8cf" /><path d="M52 112 Q70 90 88 112 Z" fill="#c5c8cf" />
          {[200, 230, 260].map((x) => <g key={x}><rect x={x} y="128" width="18" height="22" rx="3" fill="#2a2f3d" /><rect x={x} y="120" width="18" height="10" rx="3" fill="#353b4d" /></g>)}
        </g>
      ) : null}
      {scene === 'kitchen' ? (
        <g>
          <rect x="0" y="120" width="320" height="60" fill="#0b0c10" />
          <circle cx="110" cy="80" r="14" fill="#8b909a" /><path d="M86 122 Q110 94 134 122 Z" fill="#8b909a" />
          <rect x="146" y="92" width="24" height="40" rx="4" fill="#0b0c10" stroke="#6aa8ff" /><rect x="149" y="96" width="18" height="30" rx="2" fill="#6aa8ff" opacity=".85" />
          <circle cx="158" cy="110" r="38" fill="#6aa8ff" opacity=".12" />
          <rect x="240" y="40" width="40" height="50" rx="3" fill="#1f2a44" /><path d="M260 40 L260 90 M240 65 L280 65" stroke="#0c0f18" strokeWidth="3" />
        </g>
      ) : null}
      {scene === 'screen' ? (
        <g>
          <rect x="112" y="14" width="96" height="156" rx="14" fill="#0b0c10" stroke="#ffffff33" />
          <rect x="120" y="26" width="80" height="34" rx="4" fill="#ff6a2b" opacity=".85" />
          <circle cx="160" cy="70" r="10" fill="#c5c8cf" />
          <rect x="128" y="86" width="64" height="6" rx="3" fill="#f4f5f7" /><rect x="136" y="96" width="48" height="4" rx="2" fill="#8b909a" />
          <text x="160" y="114" textAnchor="middle" fontSize="8" fill="#ffd38a">★★★★★</text>
          <rect x="128" y="124" width="64" height="16" rx="8" fill="#ff6a2b" /><text x="160" y="135" textAnchor="middle" fontSize="7" fontWeight="700" fill="#160803">Call the office</text>
        </g>
      ) : null}
      {scene === 'ring' ? (
        <g>
          <circle cx="160" cy="96" r="30" fill="#ffd9a8" opacity=".15" /><circle cx="160" cy="96" r="48" fill="#ffd9a8" opacity=".08" />
          <rect x="138" y="80" width="44" height="30" rx="8" fill="#0b0c10" /><path d="M146 80 Q160 64 174 80" stroke="#0b0c10" strokeWidth="8" fill="none" />
          <path d="M120 70 l-10 -6 M118 96 l-12 0 M120 122 l-10 6 M200 70 l10 -6 M202 96 l12 0 M200 122 l10 6" stroke="#ffd38a" strokeWidth="3" strokeLinecap="round" />
        </g>
      ) : null}
      {scene === 'skyline' ? (
        <g>
          {[[20, 60], [50, 90], [80, 40], [110, 100], [150, 30], [190, 80], [225, 55], [260, 95], [290, 70]].map(([x, h], k) => <rect key={k} x={x} y={180 - h - 20} width="26" height={h + 20} fill="#0b0c10" />)}
          {Array.from({ length: 30 }, (_, k) => <rect key={k} x={24 + (k * 37) % 290} y={100 + (k * 23) % 50} width="4" height="5" fill="#ffd38a" opacity={0.4 + (k % 3) * 0.2} />)}
        </g>
      ) : null}
      {scene === 'endcard' ? (
        <g>
          <circle cx="160" cy="76" r="30" fill="none" stroke="#ff6a2b" strokeWidth="6" />
          <path d="M160 76 h22" stroke="#ff6a2b" strokeWidth="6" strokeLinecap="round" />
          <text x="160" y="134" textAnchor="middle" fontSize="16" fontWeight="800" fill="#f4f5f7" letterSpacing="3">BE FOUND.</text>
          <text x="160" y="152" textAnchor="middle" fontSize="8" fill="#8b909a" letterSpacing="2">GENOVUS.IO</text>
        </g>
      ) : null}
    </svg>
  );
}

export const SHOT_SCENES: Scene[] = ['dawn', 'desk', 'kitchen', 'screen', 'ring', 'endcard'];
export const POST_SCENES: Scene[] = ['street', 'skyline', 'dawn', 'kitchen'];
