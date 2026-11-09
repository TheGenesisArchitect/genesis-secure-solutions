// Where a meeting is: a video link becomes a short "Join Zoom meeting" link (a raw meeting URL has no spaces, so it
// can't wrap and runs off the card on a phone); a place stays text and wraps inside its card.
const PROVIDERS: [RegExp, string][] = [
  [/(^|\.)zoom\.us$/i, 'Zoom'],
  [/^meet\.google\.com$/i, 'Google Meet'],
  [/(^|\.)teams\.(microsoft|live)\.com$/i, 'Teams'],
  [/(^|\.)webex\.com$/i, 'Webex'],
];

/** "Join Zoom meeting" for a known video link, "Join the meeting" for another link, or null for a place. */
export function joinLabel(location: string): string | null {
  try {
    const u = new URL(location);
    if (!/^https?:$/.test(u.protocol)) return null;
    const p = PROVIDERS.find(([re]) => re.test(u.hostname));
    return p ? `Join ${p[1]} meeting` : 'Join the meeting';
  } catch {
    return null;
  }
}

export function MeetingPlace({ location, size = 12 }: { location: string; size?: number }) {
  const join = joinLabel(location.trim());
  return join ? (
    <a href={location.trim()} target="_blank" rel="noreferrer" title={location.trim()} style={{ fontSize: size, fontWeight: 600, justifySelf: 'start' }}>{join} ↗</a>
  ) : (
    <span className="muted" style={{ fontSize: size, overflowWrap: 'anywhere' }}>{location}</span>
  );
}
