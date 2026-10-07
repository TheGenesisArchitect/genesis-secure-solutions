import { ConsoleShell, Flash } from '@/components/ConsoleShell';
import { Panel, Chip, Status, Empty, dateTime } from '@/components/ui';
import { db } from '@/lib/supabase/server';
import { convertInquiry, setInquiryStatus } from '@/lib/actions';

export const metadata = { title: 'Inquiries' };

const LABEL: Record<string, string> = {
  carrier: 'Carrier', states: 'States', presence: 'Current presence', goals: 'Goals', agencies: 'Agencies', regions: 'Regions', role: 'Role', plan: 'Plan interest',
};

export default async function Inquiries({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const supabase = await db();
  const { data } = await supabase.from('inquiries').select('*').order('created_at', { ascending: false }).limit(200);
  const rows = data ?? [];
  return (
    <ConsoleShell title="Inquiries" crumbs={[{ href: '/console', label: 'Enterprise' }, { label: 'Inquiries' }]}>
      <Flash ok={sp.ok} err={sp.err} />
      <p className="soft">Agency and carrier requests from the website, with the consent text each person agreed to. Converting an agency inquiry creates a client in Consult with a draft record and its gates.</p>
      {rows.length ? rows.map((i) => (
        <Panel
          key={i.id}
          title={i.org}
          sub={`${i.name} · ${dateTime(i.created_at)}`}
          actions={<><Chip kind={i.kind === 'carrier' ? 'required' : 'info'}>{i.kind}</Chip><Status value={i.status} /></>}
        >
          <dl className="kv">
            <dt>Email</dt><dd><a href={`mailto:${i.email}`}>{i.email}</a></dd>
            {i.phone ? <><dt>Phone</dt><dd><a href={`tel:${i.phone}`}>{i.phone}</a></dd></> : null}
            {Object.entries((i.details ?? {}) as Record<string, string>).filter(([, v]) => v).flatMap(([k, v]) => [<dt key={k}>{LABEL[k] ?? k}</dt>, <dd key={k + 'v'}>{String(v)}</dd>])}
            <dt>Consent</dt><dd className="muted" style={{ fontSize: 13 }}>{i.consent_text}</dd>
          </dl>
          <div className="row">
            {i.status !== 'converted' ? (
              <form action={setInquiryStatus} className="row">
                <input type="hidden" name="id" value={i.id} />
                <select className="select" name="status" defaultValue={i.status} style={{ width: 'auto' }} aria-label="Status">
                  {['new', 'contacted', 'closed'].map((s) => <option key={s}>{s}</option>)}
                </select>
                <button className="btn small" type="submit">Save</button>
              </form>
            ) : null}
            {i.kind === 'agency' && i.status !== 'converted' ? (
              <form action={convertInquiry} className="row">
                <input type="hidden" name="id" value={i.id} />
                <input className="input" name="slug" required placeholder="client-address" defaultValue={i.org.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)} style={{ width: 200 }} aria-label="Client address" />
                <button className="btn primary small" type="submit">Convert to client</button>
              </form>
            ) : null}
          </div>
        </Panel>
      )) : <Empty title="No inquiries yet">The website’s forms send agency and carrier requests here.</Empty>}
    </ConsoleShell>
  );
}
