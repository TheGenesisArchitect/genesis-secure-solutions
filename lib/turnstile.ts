// Cloudflare Turnstile on the public forms. Off until both keys are set (NEXT_PUBLIC_TURNSTILE_SITE_KEY and
// TURNSTILE_SECRET_KEY), so a missing key never turns real leads away. Once on, a missing or bad token is refused;
// if Cloudflare itself can't be reached, the form still goes through (the honeypot and timing checks still run).
export const turnstileOn = () => Boolean(process.env.TURNSTILE_SECRET_KEY && process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);

export async function turnstileOk(token: string | null | undefined, ip?: string | null): Promise<boolean> {
  if (!turnstileOn()) return true;
  if (!token || token.length > 2048) return false;
  const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY!, response: token });
  if (ip && ip !== 'unknown') body.set('remoteip', ip);
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body, signal: AbortSignal.timeout(4000) });
    const j = (await r.json()) as { success?: boolean };
    return j.success === true;
  } catch (e) {
    console.error(`[turnstile] siteverify unreachable, letting the form through: ${(e as Error).message}`);
    return true;
  }
}
