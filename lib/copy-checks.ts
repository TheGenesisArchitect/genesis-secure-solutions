// Pre-checks shown on approval cards, built from the same rules as the social wizard's copy editor
// (lib/copy-rules.ts): hard failures block approval, warnings ask a person to look twice.
import { cleanCopy, copyWarnings, isCopyKey, COPY_RULES } from './copy-rules';

export type CopyFlag = { label: string; hard: boolean };

export function checkCopy(text: string, field?: string): CopyFlag[] {
  const flags: CopyFlag[] = copyWarnings(text).map((w) => ({ label: w, hard: false }));
  if (field && isCopyKey(field)) {
    const r = cleanCopy(field, text);
    if ('error' in r) flags.unshift({ label: r.error, hard: true });
    // The length only matters next to another flag; clean copy shows "Passed every rule" instead.
    else if (flags.length) flags.unshift({ label: `${r.text.length}/${COPY_RULES[field].limit} characters`, hard: false });
  }
  return flags;
}
