// The client's checklist behind their welcome link (lib/checklist.ts is what's on it). Server only.
//  - tenantForToken: the welcome link's client (hashed token lookup, never the token itself).
//  - sendChecklistLinks: once a deposit is paid (the client is in Intake), a fresh welcome link goes to the email on
//    their record, once. The email is transactional: they paid and are waiting for it.
//  - saveChecklist: their answers onto their record (a new version), photos into private storage as their assets
//    (photo rights pending until the team clears them), and "done" when every required item is in.
import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { put } from '@vercel/blob';
import { adminDb } from './supabase/admin';
import { CHECKLIST, checklistStatus } from './checklist';

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const hash = (t: string) => createHash('sha256').update(t).digest('hex');

export async function tenantForToken(token: string): Promise<{ tenantId: string; name: string; slug: string; record: Record<string, unknown> } | null> {
  if (!TOKEN_RE.test(token)) return null;
  const db = adminDb();
  const { data: link } = await db.from('client_links').select('tenant_id').eq('token_hash', hash(token)).is('revoked_at', null).maybeSingle();
  if (!link) return null;
  const [{ data: t }, { data: r }] = await Promise.all([
    db.from('tenants').select('id, name, slug').eq('id', link.tenant_id).single(),
    db.from('agent_records').select('data').eq('tenant_id', link.tenant_id).eq('is_current', true).maybeSingle(),
  ]);
  return t ? { tenantId: t.id as string, name: t.name as string, slug: t.slug as string, record: (r?.data ?? {}) as Record<string, unknown> } : null;
}

/** A new welcome link for a client (earlier ones revoked; saved progress keeps its storage key). Returns the token. */
export async function issueLink(tenantId: string, by: string | null): Promise<string> {
  const db = adminDb();
  const token = randomBytes(16).toString('base64url'), full = hash(token);
  const { data: first } = await db.from('client_links').select('key16').eq('tenant_id', tenantId).order('created_at').limit(1).maybeSingle();
  await db.from('client_links').update({ revoked_at: new Date().toISOString() }).eq('tenant_id', tenantId).is('revoked_at', null);
  const { error } = await db.from('client_links').insert({ tenant_id: tenantId, token_hash: full, key16: first?.key16 ?? full.slice(0, 16), created_by: by });
  if (error) throw new Error(error.message);
  return token;
}

/** Clients whose deposit is paid get their checklist link by email, once. */
export async function sendChecklistLinks(origin: string): Promise<number> {
  const db = adminDb();
  const { data: ts } = await db.from('tenants').select('id, name').eq('stage', 'intake').eq('is_sample', false).is('checklist_link_sent_at', null).limit(10);
  let sent = 0;
  for (const t of ts ?? []) {
    const { data: r } = await db.from('agent_records').select('data').eq('tenant_id', t.id).eq('is_current', true).maybeSingle();
    const rec = (r?.data ?? {}) as Record<string, unknown>;
    const email = typeof rec.email === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rec.email) ? rec.email.toLowerCase() : null;
    if (!email) continue;
    const token = await issueLink(t.id as string, null);
    const first = String(rec.contactName ?? '').split(/\s+/)[0] || 'there';
    await db.from('outbox').insert({ tenant_id: t.id, to_email: email, template: 'checklist_ready', data: { agency: t.name, first, link: `${origin}/welcome/${token}/checklist`, count: String(checklistStatus(rec).missing.length) }, dedupe_key: `checklist:${t.id}` });
    await db.from('tenants').update({ checklist_link_sent_at: new Date().toISOString() }).eq('id', t.id);
    sent++;
  }
  return sent;
}

const PHOTO_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_PHOTO = 8 * 1024 * 1024;
const STATES = /^[A-Z]{2}(\s*,\s*[A-Z]{2})*$/;

export async function saveChecklist(token: string, form: FormData): Promise<{ ok: true; done: boolean; missing: string[] } | { ok: false; error: string }> {
  const who = await tenantForToken(token);
  if (!who) return { ok: false, error: 'This link isn’t valid anymore. Ask us for a new one.' };
  const db = adminDb();
  // A few saves an hour is plenty for a person; more is a script.
  const { count } = await db.from('agent_records').select('id', { count: 'exact', head: true }).eq('tenant_id', who.tenantId).eq('note', 'From the client checklist').gte('created_at', new Date(Date.now() - 3_600_000).toISOString());
  if ((count ?? 0) >= 20) return { ok: false, error: 'Too many saves in an hour. Try again a little later.' };
  const intake: Record<string, unknown> = {};
  for (const item of CHECKLIST) {
    if (item.kind === 'photo') {
      const f = form.get(item.key);
      if (!(f instanceof File) || f.size === 0) continue;
      const ext = PHOTO_TYPES[f.type];
      if (!ext) return { ok: false, error: `${item.label}: please use a JPG, PNG or WebP photo.` };
      if (f.size > MAX_PHOTO) return { ok: false, error: `${item.label}: please keep it under 8 MB.` };
      if (item.key === 'headshot' && form.get('rights') !== 'yes') return { ok: false, error: 'Please confirm you have the rights to use your headshot.' };
      const key = `assets/${who.tenantId}/intake/${item.key}-${Date.now()}.${ext}`;
      await put(key, Buffer.from(await f.arrayBuffer()), { access: 'private', contentType: f.type, addRandomSuffix: false });
      const title = item.key === 'headshot' ? 'Headshot (from your checklist)' : 'Logo (from your checklist)';
      const { data: a, error } = await db.from('assets').upsert({ tenant_id: who.tenantId, kind: item.key === 'logo' ? 'brand' : 'image', title, location_kind: 'blob', location: key, audience: 'client', rights_status: 'pending', notes: 'Uploaded by the client from their checklist.' }, { onConflict: 'tenant_id,title' }).select('id').single();
      if (error) return { ok: false, error: 'The photo couldn’t be saved. Please try again.' };
      intake[item.key] = a.id;
      continue;
    }
    const raw = form.get(item.key);
    if (typeof raw !== 'string') continue;
    let v = raw.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, item.max ?? 300);
    if (!v) continue;
    if (item.kind === 'states') { v = v.toUpperCase().replace(/\s+/g, ' '); if (!STATES.test(v)) return { ok: false, error: `${item.label}: use two-letter codes, like GA, AL.` }; }
    if (item.kind === 'url' && !/^https:\/\/[^\s]+\.[^\s]+/.test(v)) return { ok: false, error: `${item.label}: please paste the full link, starting with https://` };
    if (item.kind === 'choice' && !(item.options ?? []).some(([o]) => o === v)) continue;
    intake[item.key] = v;
  }
  const after = checklistStatus({ ...who.record, intake: { ...((who.record.intake ?? {}) as object), ...intake } });
  const attest = intake.headshot ? `Client confirmed rights to the headshot on ${new Date().toISOString().slice(0, 10)} (checklist).` : null;
  const { error } = await db.rpc('save_intake', { p_tenant: who.tenantId, p_intake: intake, p_done: after.done, p_attest: attest });
  if (error) return { ok: false, error: 'Your answers couldn’t be saved. Please try again.' };
  return { ok: true, done: after.done, missing: after.missing.map((m) => m.label) };
}
