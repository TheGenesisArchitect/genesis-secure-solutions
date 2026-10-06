// Meta (Facebook, Instagram, Marketing API) connector. Server-only: holds the app secret and tokens.
// Read-only for now. Anything outward (posting, ads, replies) goes through the approval lanes, never straight from here.
// Graph API version is pinned; Meta publishes a new one about twice a year (v26.0 released 2026-07-29).
import { createHmac, timingSafeEqual } from 'node:crypto';

export const GRAPH_VERSION = 'v26.0';
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

export type MetaConfig = {
  appId?: string;
  appSecret?: string;
  /** Token for a system user in Genesis's own business portfolio: our own Page and Instagram only. */
  systemToken?: string;
  /** The string we type into the App Dashboard's webhook Verify Token field. */
  webhookVerifyToken?: string;
  /** Our business portfolio ID: the partner ID clients enter. */
  businessId?: string;
};

export function metaConfig(): MetaConfig {
  const v = (k: string) => (process.env[k] || '').trim() || undefined;
  return {
    appId: v('META_APP_ID'),
    appSecret: v('META_APP_SECRET'),
    systemToken: v('META_SYSTEM_USER_TOKEN'),
    webhookVerifyToken: v('META_WEBHOOK_VERIFY_TOKEN'),
    businessId: v('GSS_META_BUSINESS_ID'),
  };
}

const sameText = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Webhook setup handshake: true only when Meta sends our verify token. */
export function verifyTokenMatches(given: string | null, expected: string | undefined): boolean {
  return !!given && !!expected && sameText(given, expected);
}

/** X-Hub-Signature-256 is "sha256=" + HMAC-SHA256 of the raw body with the app secret. */
export function validHubSignature(rawBody: string, header: string | null, appSecret: string | undefined): boolean {
  if (!header || !appSecret || !header.startsWith('sha256=')) return false;
  const expected = 'sha256=' + createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
  return sameText(header, expected);
}

const b64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** Parses Meta's signed_request (data deletion callback). Returns the payload, or null if the signature is wrong. */
export function parseSignedRequest(signed: string, appSecret: string | undefined): { user_id: string; issued_at?: number } | null {
  if (!appSecret || typeof signed !== 'string' || signed.length > 4000) return null;
  const parts = signed.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [sigPart, payloadPart] = parts;
  const expected = createHmac('sha256', appSecret).update(payloadPart).digest();
  const got = b64url(sigPart);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  try {
    const payload = JSON.parse(b64url(payloadPart).toString('utf8'));
    if (String(payload.algorithm).toUpperCase() !== 'HMAC-SHA256' || typeof payload.user_id !== 'string' || !/^\d{1,40}$/.test(payload.user_id)) return null;
    return { user_id: payload.user_id, issued_at: typeof payload.issued_at === 'number' ? payload.issued_at : undefined };
  } catch {
    return null;
  }
}

/** Keeps only identifiers from a webhook change (ids, field, verb, item): no message text or lead answers. */
export function idsOnly(value: unknown): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (!value || typeof value !== 'object') return out;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if ((k.endsWith('_id') || k === 'id' || k === 'item' || k === 'verb' || k === 'created_time') && (typeof v === 'string' || typeof v === 'number')) out[k] = v;
  }
  return out;
}

type GraphResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function graph<T>(path: string, params: Record<string, string>, token: string, appSecret?: string): Promise<GraphResult<T>> {
  const q = new URLSearchParams(params);
  // appsecret_proof proves the call comes from our server, so a leaked token alone is not enough.
  if (appSecret) q.set('appsecret_proof', createHmac('sha256', appSecret).update(token).digest('hex'));
  try {
    const r = await fetch(`${GRAPH}${path}?${q}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: AbortSignal.timeout(8000) });
    const j = (await r.json()) as T & { error?: { message?: string; code?: number } };
    if (!r.ok || j.error) return { ok: false, error: j.error?.message ? `${j.error.message} (code ${j.error.code ?? r.status})` : `HTTP ${r.status}` };
    return { ok: true, data: j };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Request failed' };
  }
}

export type TokenInfo = { valid: boolean; type?: string; appId?: string; scopes: string[]; expiresAt?: string; error?: string };

/** Inspects the system user token with the app token. Never returns the token itself. */
export async function inspectToken(cfg: MetaConfig): Promise<TokenInfo> {
  if (!cfg.systemToken || !cfg.appId || !cfg.appSecret) return { valid: false, scopes: [], error: 'Missing app ID, app secret or token' };
  const appToken = `${cfg.appId}|${cfg.appSecret}`;
  const r = await graph<{ data: { is_valid: boolean; type?: string; app_id?: string; scopes?: string[]; expires_at?: number; error?: { message: string } } }>(
    '/debug_token',
    { input_token: cfg.systemToken },
    appToken,
  );
  if (!r.ok) return { valid: false, scopes: [], error: r.error };
  const d = r.data.data;
  return {
    valid: !!d.is_valid,
    type: d.type,
    appId: d.app_id,
    scopes: d.scopes ?? [],
    expiresAt: d.expires_at ? new Date(d.expires_at * 1000).toISOString() : 'never',
    error: d.error?.message,
  };
}

export type ConnectedPage = { id: string; name: string; followers?: number; instagram?: { id: string; username?: string; followers?: number } };

/** The Pages (and linked Instagram accounts) our system user can see. Read-only. */
export async function connectedPages(cfg: MetaConfig): Promise<GraphResult<ConnectedPage[]>> {
  if (!cfg.systemToken) return { ok: false, error: 'No system user token' };
  const r = await graph<{ data: { id: string; name: string; followers_count?: number; instagram_business_account?: { id: string; username?: string; followers_count?: number } }[] }>(
    '/me/accounts',
    { fields: 'id,name,followers_count,instagram_business_account{id,username,followers_count}', limit: '25' },
    cfg.systemToken,
    cfg.appSecret,
  );
  if (!r.ok) return r;
  return {
    ok: true,
    data: r.data.data.map((p) => ({
      id: p.id,
      name: p.name,
      followers: p.followers_count,
      instagram: p.instagram_business_account
        ? { id: p.instagram_business_account.id, username: p.instagram_business_account.username, followers: p.instagram_business_account.followers_count }
        : undefined,
    })),
  };
}
