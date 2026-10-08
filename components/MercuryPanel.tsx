// Console → Domains & email → Mercury: the invoicing connection's status, the checks it needs, and the one
// thing Genovus learns from you (the pay-link format, taken from any real Mercury invoice link).
import { ActionForm } from './ActionForm';
import { Panel, Chip } from './ui';
import { learnMercuryPayUrl } from '@/lib/actions';
import { listAccounts, mercuryConfigured, payUrlTemplate } from '@/lib/mercury';

export async function MercuryPanel() {
  const hasToken = Boolean(process.env.MERCURY_API_TOKEN);
  const account = process.env.MERCURY_ACCOUNT_ID || '';
  let accounts: Awaited<ReturnType<typeof listAccounts>> = [];
  let reach = '';
  if (hasToken) {
    try { accounts = await listAccounts(); } catch (e) { reach = e instanceof Error ? e.message : 'Mercury did not answer'; }
  }
  const template = hasToken ? await payUrlTemplate() : null;
  const dest = accounts.find((a) => a.id === account);
  const ready = mercuryConfigured() && !reach && Boolean(dest) && Boolean(template);
  const steps: [boolean, string][] = [
    [hasToken, 'Mercury API key saved in Vercel as MERCURY_API_TOKEN (read-write, invoicing scopes)'],
    [hasToken && !reach, reach ? `Mercury reachable from this server: ${reach}` : 'Mercury reachable from this server (static IPs on the key’s allowlist)'],
    [Boolean(dest), dest ? `Payments land in ${dest.name}${dest.last4 ? ` ··${dest.last4}` : ''}` : 'Deposit account chosen: set MERCURY_ACCOUNT_ID to one of the account IDs below'],
    [Boolean(template), template ? `Pay-link format learned: ${template}` : 'Pay-link format learned from one real Mercury invoice link (below)'],
  ];
  return (
    <Panel title="Mercury invoicing" sub="Invoices are created and sent through Mercury, and marked paid when Mercury reports the payment"
      actions={<Chip kind={ready ? 'done' : 'pending'}>{ready ? 'Connected' : 'Setting up'}</Chip>}>
      <ul className="list">
        {steps.map(([ok, label], i) => (
          <li key={i} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}><Chip kind={ok ? 'done' : 'pending'}>{ok ? 'Done' : 'To do'}</Chip><span style={{ fontSize: 14, overflowWrap: 'anywhere' }}>{label}</span></li>
        ))}
      </ul>
      {accounts.length && !dest ? (
        <dl className="kv" style={{ fontSize: 13 }}>
          {accounts.flatMap((a) => [<dt key={a.id + 'n'}>{a.name} {a.kind ? `(${a.kind})` : ''} {a.last4 ? `··${a.last4}` : ''}</dt>, <dd key={a.id} className="num" style={{ overflowWrap: 'anywhere' }}>{a.id}</dd>])}
        </dl>
      ) : null}
      {hasToken && !reach ? (
        <ActionForm action={learnMercuryPayUrl} className="row">
          <input className="input" name="link" type="url" required placeholder="Paste the pay link of any invoice you sent from Mercury" style={{ flex: 1, minWidth: 260 }} aria-label="Mercury invoice pay link" />
          <button className="btn small" type="submit">{template ? 'Relearn' : 'Learn the format'}</button>
        </ActionForm>
      ) : null}
    </Panel>
  );
}
