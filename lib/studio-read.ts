// Parsing a shot's line read ("JULIAN: [dry] Nobody missed them. · TASHA: [plain] …") into spoken lines.
// Shared by the production board and the Runway engine; no server-only imports.
export type Line = { slot: string; code: string; speaker: string; text: string };
/** The spoken lines of a shot's line read, with their direction tags. Untagged-speaker cues ([impact] drum hit) are
 *  sound, not dialogue, and are left for the score. */
export function parseRead(read: string, cast: { code: string; name: string }[]): Line[] {
  const out: Line[] = [];
  read.split(/\s+·\s+(?=[A-Z][A-Z]+(?:\s*\([^)]*\))?:)/).forEach((part) => {
    const m = part.match(/^([A-Z][A-Z]+)(?:\s*\(([^)]*)\))?:\s*([\s\S]+)$/);
    if (!m) return;
    const c = cast.find((x) => x.name.toUpperCase() === m[1] || x.code.startsWith(m[1]));
    if (!c) return;
    out.push({ slot: `L${out.length + 1}`, code: c.code, speaker: c.name, text: m[3].trim() });
  });
  return out;
}
