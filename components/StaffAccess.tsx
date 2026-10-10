'use client';
// Staff tools on a client's page for getting the agency live: issue or revoke the website's lead key (shown once),
// and copy a one-time sign-in link for a member when an invitation email is slow or filtered.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { issueLeadKey, revokeLeadKey, staffSigninLink } from '@/lib/staff-access';

type Key = { id: string; label: string; created_at: string; last_used_at: string | null; revoked_at: string | null };
const toast = (r: { ok?: string; err?: string }) => window.dispatchEvent(new CustomEvent('genovus:toast', { detail: { ...r, at: Date.now() } }));
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : 'never');

function Secret({ value, onClose }: { value: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="secret">
      <code>{value}</code>
      <div className="row" style={{ gap: 6 }}>
        <button className="btn small primary" type="button" onClick={() => navigator.clipboard.writeText(value).then(() => setCopied(true), () => setCopied(false))}>{copied ? 'Copied' : 'Copy'}</button>
        <button className="btn small ghost" type="button" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

export function StaffAccess({ tenantId, keys }: { tenantId: string; keys: Key[] }) {
  const router = useRouter();
  const [secret, setSecret] = useState<{ kind: string; value: string } | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (kind: string, p: Promise<{ ok?: string; err?: string; secret?: string }>) => {
    setBusy(true);
    const r = await p;
    setBusy(false);
    toast(r);
    if (r.secret) setSecret({ kind, value: r.secret });
    router.refresh();
  };
  const live = keys.filter((k) => !k.revoked_at);
  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="grid" style={{ gap: 8 }}>
        <b>Website lead key</b>
        <span className="muted" style={{ fontSize: 13 }}>The agency’s site sends each callback to its Leads page with this key (Authorization: Bearer). Shown once; only its fingerprint is kept.</span>
        {live.length ? (
          <ul className="list">
            {live.map((k) => (
              <li key={k.id} className="spread">
                <span>{k.label} · issued {when(k.created_at)} · last lead {when(k.last_used_at)}</span>
                <button className="btn small ghost" type="button" disabled={busy} onClick={() => run('revoke', revokeLeadKey(k.id))}>Revoke</button>
              </li>
            ))}
          </ul>
        ) : <span className="soft" style={{ fontSize: 13 }}>No key yet: leads still arrive by email only.</span>}
        <div><button className="btn small" type="button" disabled={busy} onClick={() => run('key', issueLeadKey(tenantId, 'Website'))}>{live.length ? 'Issue another key' : 'Issue a lead key'}</button></div>
        {secret?.kind === 'key' ? <Secret value={secret.value} onClose={() => setSecret(null)} /> : null}
      </div>
      <div className="grid" style={{ gap: 8 }}>
        <b>One-time sign-in link</b>
        <span className="muted" style={{ fontSize: 13 }}>For a member who can’t find their invitation (corporate filters). Works once, expires in an hour, and is recorded in the audit trail.</span>
        <form className="row" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); void run('link', staffSigninLink(tenantId, email)); }}>
          <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="member@agency.com" style={{ flex: 1, minWidth: 200 }} aria-label="Member email" />
          <button className="btn small" type="submit" disabled={busy}>Create link</button>
        </form>
        {secret?.kind === 'link' ? <Secret value={secret.value} onClose={() => setSecret(null)} /> : null}
      </div>
    </div>
  );
}
