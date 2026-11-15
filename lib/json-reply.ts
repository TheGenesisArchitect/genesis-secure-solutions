// The JSON object in a model's reply. A greedy /\{[\s\S]*\}/ breaks when the reply adds a note with a brace after the
// JSON ("Unexpected non-whitespace character after JSON", the 2026-11-15 graphics-plan failure). This returns the first
// complete, parseable object (string-aware brace matching), falling back to the greedy match. Shaped like
// String.match so callers keep `m[0]`.
export function jsonMatch(text: string): [string] | null {
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        const cand = text.slice(start, i + 1);
        try { JSON.parse(cand); return [cand]; } catch { break; }
      }
    }
  }
  const g = text.match(/\{[\s\S]*\}/);
  return g ? [g[0]] : null;
}
