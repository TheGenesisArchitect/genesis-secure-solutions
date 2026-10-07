// Where to send someone after sign-in: only our own dashboard paths, never another site.
const ALLOWED = /^\/(console|app|network)(\/[A-Za-z0-9/_\-?=&.%]*)?$/;

export function safeNext(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let p: string;
  try {
    p = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (!p.startsWith('/') || p.startsWith('//') || p.includes('\\') || p.length > 300) return null;
  return ALLOWED.test(p) ? p : null;
}
