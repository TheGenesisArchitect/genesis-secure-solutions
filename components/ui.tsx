// Small building blocks named in the spec's Look and feel: panel, KPI tile, chips, progress bar,
// empty state, plus the labels and formatters every surface shares. Server components; no client JavaScript.
import type { ReactNode } from 'react';

export function Panel({ title, sub, actions, children, id, tour }: { title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; id?: string; tour?: string }) {
  return (
    <section className="panel" id={id} data-tour={tour}>
      {title || actions ? (
        <header>
          <div>
            {title ? <h2>{title}</h2> : null}
            {sub ? <div className="sub">{sub}</div> : null}
          </div>
          {actions ? <div className="row">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function Tile({ label, value, hint, sample }: { label: ReactNode; value: ReactNode; hint?: ReactNode; sample?: boolean }) {
  return (
    <div className={'tile' + (sample ? ' sample' : '')}>
      <div className="label">
        <span>{label}</span>
        {sample ? <Chip kind="sample">Sample</Chip> : null}
      </div>
      <div className="value">{value}</div>
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function Chip({ kind, children }: { kind?: string; children: ReactNode }) {
  return <span className={'chip ' + (kind ?? '')}>{children}</span>;
}

/** A status chip whose colour follows the status word (approved, pending, blocked, ...). */
export function Status({ value }: { value: string }) {
  return <Chip kind={value}>{value.replace(/_/g, ' ')}</Chip>;
}

export function Bar({ value, total, done }: { value: number; total: number; done?: boolean }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className={'bar' + (done ? ' done' : '')} role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={value}>
      <i style={{ width: pct + '%' }} />
    </div>
  );
}

export function Empty({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="empty">
      <b>{title}</b>
      {children ? <span>{children}</span> : null}
    </div>
  );
}

export const STAGES = ['attract', 'consult', 'propose', 'deposit', 'intake', 'build', 'review', 'care'] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = {
  attract: 'Attract', consult: 'Consult', propose: 'Propose', deposit: 'Deposit',
  intake: 'Intake', build: 'Build', review: 'Review & launch', care: 'Care',
};
export const GATE_LABEL: Record<string, string> = {
  photo_rights: 'Photo rights', carrier_approval: 'Carrier approval', carrier_rules: 'Carrier rules attestation',
  meta_access: 'Meta partner access', domain: 'Domain', privacy_notice: 'Privacy notice', kickoff: 'Kickoff call',
};
export const PLAN_LABEL: Record<string, string> = { vip: 'Launch (VIP)', launch: 'Launch', growth: 'Growth', premium: 'Premium' };

export const money = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: cents % 100 ? 2 : 0 });
export const date = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' }) : '—';
export const dateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET' : '—';
export function daysSince(iso: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}
