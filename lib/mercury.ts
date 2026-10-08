// Mercury invoicing (Accounts Receivable API, beta): https://docs.mercury.com/reference/accounts_recievable
// Genovus creates each invoice in Mercury, opens it with the Mercury pay link (our branded email goes out from
// the outbox), cancels it in Mercury when voided here, and polls status because Mercury sends no invoice event.
// Server only. The read-write key works only from the allowlisted static IPs, so calls run on Vercel.
import 'server-only';
import { adminDb } from './supabase/admin';

const TOKEN = () => process.env.MERCURY_API_TOKEN || '';
const ACCOUNT = () => process.env.MERCURY_ACCOUNT_ID || '';
const BASE = () => (process.env.MERCURY_API_BASE || 'https://api.mercury.com/api/v1').replace(/\/$/, '');

export const mercuryConfigured = () => Boolean(TOKEN() && ACCOUNT());

type Json = Record<string, unknown>;
export class MercuryError extends Error {}

async function api<T = Json>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  if (!TOKEN()) throw new MercuryError('Mercury is not connected yet (MERCURY_API_TOKEN is not set).');
  let res: Response;
  try {
    res = await fetch(BASE() + path, {
      method: init.method ?? 'GET',
      headers: { Authorization: `Bearer ${TOKEN()}`, Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    });
  } catch (e) {
    throw new MercuryError(`Mercury did not answer (${e instanceof Error ? e.message : 'network error'}).`);
  }
  const text = await res.text();
  let body: Json = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text.slice(0, 200) }; }
  if (!res.ok) {
    const msg = String(body.message ?? body.error ?? body.errors ?? `HTTP ${res.status}`);
    console.error(`[mercury] ${init.method ?? 'GET'} ${path}: ${res.status} ${msg}`);
    if (res.status === 401 || res.status === 403) throw new MercuryError(`Mercury refused the key (${msg}). Check the token and that the server's static IPs are on its allowlist.`);
    throw new MercuryError(`Mercury: ${msg}`);
  }
  return body as T;
}

/** Mercury list responses wrap their rows; take the first array found. */
const rows = (b: unknown): Json[] => {
  if (Array.isArray(b)) return b as Json[];
  if (b && typeof b === 'object') for (const v of Object.values(b)) if (Array.isArray(v)) return v as Json[];
  return [];
};

export type MercuryInvoice = { id: string; slug: string; status: string; amount: number; invoiceNumber: string };

export async function listAccounts() {
  return rows(await api('/accounts')).map((a) => ({ id: String(a.id), name: String(a.nickname ?? a.name ?? 'Account'), kind: String(a.kind ?? a.type ?? ''), last4: String(a.accountNumber ?? '').slice(-4) }));
}

/** Every row of a Mercury list endpoint, following its page cursor ({ <rows>, page: { nextPage } }). */
async function listAll(path: string, max = 20): Promise<Json[]> {
  const all: Json[] = [];
  let after = '';
  for (let i = 0; i < max; i++) {
    const b = await api<Json>(`${path}?limit=1000${after ? `&start_after=${encodeURIComponent(after)}` : ''}`);
    all.push(...rows(b));
    const next = (b.page as { nextPage?: string | null } | undefined)?.nextPage;
    if (!next) break;
    after = next;
  }
  return all;
}

async function listInvoices(): Promise<MercuryInvoice[]> {
  return (await listAll('/ar/invoices')) as unknown as MercuryInvoice[];
}

// ---------- pay-page link ----------
// Mercury documents only that the pay page is built from the invoice slug. The format below is confirmed from a
// real JAVA Agency invoice link (2026-10-08); a link pasted on the setup page, or MERCURY_PAY_URL_TEMPLATE, overrides it.
export const DEFAULT_PAY_URL_TEMPLATE = 'https://app.mercury.com/pay/{slug}';
export async function payUrlTemplate(): Promise<string | null> {
  if (process.env.MERCURY_PAY_URL_TEMPLATE) return process.env.MERCURY_PAY_URL_TEMPLATE;
  const { data } = await adminDb().from('app_settings').select('value').eq('key', 'mercury_pay_url_template').maybeSingle();
  return data?.value ?? DEFAULT_PAY_URL_TEMPLATE;
}

export async function learnPayUrl(link: string): Promise<string> {
  const url = link.trim();
  if (!/^https:\/\/([a-z0-9-]+\.)*mercury\.com\//i.test(url)) throw new MercuryError('Paste a link that starts with https:// on mercury.com.');
  const hit = (await listInvoices()).find((i) => i.slug && url.includes(i.slug));
  if (!hit) throw new MercuryError('No invoice in this Mercury account matches that link. Paste the pay link of an invoice from this account.');
  const template = url.replace(hit.slug, '{slug}').split('?')[0];
  await adminDb().from('app_settings').upsert({ key: 'mercury_pay_url_template', value: template, updated_at: new Date().toISOString() });
  return template;
}

// ---------- customers ----------
async function ensureCustomer(tenantId: string): Promise<string> {
  const db = adminDb();
  const { data: t } = await db.from('tenants').select('name, mercury_customer_id').eq('id', tenantId).single();
  if (!t) throw new MercuryError('Client not found.');
  if (t.mercury_customer_id) return t.mercury_customer_id;
  const { data: owners } = await db.from('memberships').select('user_id').eq('tenant_id', tenantId).eq('role', 'owner').limit(1);
  const ownerId = owners?.[0]?.user_id;
  const email = ownerId ? (await db.auth.admin.getUserById(ownerId)).data.user?.email : null;
  if (!email) throw new MercuryError('Invite the agency owner first: Mercury needs an email to bill.');
  // Mercury does not enforce unique emails, so match on email before creating (their recommended practice).
  const existing = (await listAll('/ar/customers')).find((c) => String(c.email ?? '').toLowerCase() === email.toLowerCase());
  const id = existing ? String(existing.id) : String((await api<Json>('/ar/customers', { method: 'POST', body: { name: t.name, email } })).id);
  await db.from('tenants').update({ mercury_customer_id: id }).eq('id', tenantId);
  return id;
}

// ---------- invoices ----------
const dollars = (cents: number) => Math.round(cents) / 100;
const day = (d: Date) => d.toISOString().slice(0, 10);

/** Create the invoice in Mercury (idempotent by invoice number) and open it here with its pay link. */
export async function pushInvoice(invoiceId: string, dueOverride?: string): Promise<{ number: string; payUrl: string }> {
  if (!mercuryConfigured()) throw new MercuryError('Mercury is not connected yet.');
  const template = await payUrlTemplate();
  if (!template) throw new MercuryError('Teach Genovus the Mercury pay-link format first: Console → Domains & email → Mercury.');
  const db = adminDb();
  const { data: inv } = await db.from('invoices').select('*').eq('id', invoiceId).single();
  if (!inv) throw new MercuryError('Invoice not found.');
  if (inv.status !== 'draft') throw new MercuryError(`This invoice is already ${inv.status}.`);
  const customerId = await ensureCustomer(inv.tenant_id);
  let number: string = inv.number;
  if (!number) {
    const { data } = await db.rpc('next_invoice_number');
    number = String(data);
    await db.from('invoices').update({ number }).eq('id', invoiceId);
  }

  // Mercury line items are positive prices. Credits and $0 notes fold into one line with the math in the memo.
  const lines: { label: string; cents: number }[] = Array.isArray(inv.lines) ? inv.lines : [];
  const simple = lines.length > 0 && lines.every((l) => l.cents > 0);
  const label = inv.note || ({ deposit: 'Setup deposit', balance: 'Setup balance', care: 'Monthly care', upgrade: 'Plan upgrade', custom: 'Services' } as Record<string, string>)[inv.kind] || 'Services';
  const lineItems = simple ? lines.map((l) => ({ name: l.label, unitPrice: dollars(l.cents), quantity: 1 })) : [{ name: label, unitPrice: dollars(inv.amount_cents), quantity: 1 }];
  const memo = !simple && lines.length ? lines.map((l) => `${l.label}: ${l.cents < 0 ? '-' : ''}$${(Math.abs(l.cents) / 100).toFixed(2)}`).join('\n').slice(0, 1000) : undefined;
  const today = new Date();
  const chosen = dueOverride && /^\d{4}-\d{2}-\d{2}$/.test(dueOverride) ? dueOverride : null;
  if (chosen) await db.from('invoices').update({ due_date: chosen }).eq('id', invoiceId);
  const due = (chosen ?? inv.due_date) ?? day(new Date(today.getTime() + 7 * 86_400_000));

  let m: MercuryInvoice | undefined;
  try {
    m = await api<MercuryInvoice>('/ar/invoices', {
      method: 'POST',
      body: {
        customerId, destinationAccountId: ACCOUNT(), invoiceNumber: number, invoiceDate: day(today), dueDate: due < day(today) ? day(today) : due,
        lineItems, ccEmails: [], creditCardEnabled: false, achDebitEnabled: true, useRealAccountNumber: false, sendEmailOption: 'DontSend',
        ...(memo ? { payerMemo: memo } : {}), internalNote: `Genovus ${invoiceId}`,
        ...(inv.period_start ? { servicePeriodStartDate: inv.period_start, servicePeriodEndDate: inv.period_end } : {}),
      },
    });
  } catch (e) {
    // A retry after a timeout: the number already exists in Mercury, so pick that invoice up instead.
    m = (await listInvoices()).find((i) => i.invoiceNumber === number);
    if (!m) throw e;
  }
  if (Math.round(Number(m.amount) * 100) !== inv.amount_cents) {
    throw new MercuryError(`Mercury shows ${number} as $${Number(m.amount).toFixed(2)}, not $${(inv.amount_cents / 100).toFixed(2)}. Check it in Mercury before sending.`);
  }
  const payUrl = template.replace('{slug}', encodeURIComponent(m.slug));
  const { error } = await db.rpc('mercury_attach_invoice', { p_id: invoiceId, p_mercury_id: m.id, p_slug: m.slug, p_number: number, p_pay_url: payUrl, p_status: m.status });
  if (error) throw new MercuryError(error.message);
  return { number, payUrl };
}

export async function cancelInvoice(mercuryId: string) {
  await api(`/ar/invoices/${encodeURIComponent(mercuryId)}/cancel`, { method: 'POST' });
}

/** Poll every open Mercury invoice and record what Mercury reports (paid, cancelled). */
export async function syncOpenInvoices(): Promise<{ checked: number; paid: number; errors: number }> {
  const db = adminDb();
  const { data: open } = await db.from('invoices').select('id, mercury_invoice_id').eq('status', 'open').not('mercury_invoice_id', 'is', null).limit(500);
  let paid = 0, errors = 0;
  for (const i of open ?? []) {
    try {
      const m = await api<MercuryInvoice>(`/ar/invoices/${encodeURIComponent(i.mercury_invoice_id!)}`);
      const { error } = await db.rpc('mercury_sync_status', { p_id: i.id, p_status: m.status });
      if (error) throw error;
      if (m.status === 'Paid') paid++;
    } catch (e) {
      errors++;
      console.error(`[mercury] sync ${i.id}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return { checked: open?.length ?? 0, paid, errors };
}
