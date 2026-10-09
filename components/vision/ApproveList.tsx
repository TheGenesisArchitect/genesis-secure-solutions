'use client';
// Chapter 10: the decisions waiting for a person. Each one approved individually (Lane 3 never batch-approves).
import { useState } from 'react';

export function ApproveList({ items }: { items: { what: string; lane: number }[] }) {
  const [state, setState] = useState<Record<number, 'approved' | 'held' | undefined>>({});
  const left = items.filter((_, i) => !state[i]).length;
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {items.map((it, i) => (
        <div key={i} className="approve-row">
          <span style={{ display: 'grid', gap: 2 }}><b style={{ fontSize: 14 }}>{it.what}</b><span className={`vlane l${it.lane}`} style={{ justifySelf: 'start' }}>LANE {it.lane}</span></span>
          {state[i] ? <span className={'chip ' + (state[i] === 'approved' ? 'done' : 'pending')}>{state[i] === 'approved' ? 'Approved · sealed' : 'Held'}</span> : (
            <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
              <button className="btn small primary" onClick={() => setState((s) => ({ ...s, [i]: 'approved' }))}>Approve</button>
              <button className="btn small ghost" onClick={() => setState((s) => ({ ...s, [i]: 'held' }))}>Hold</button>
            </span>
          )}
        </div>
      ))}
      <span className="muted" style={{ fontSize: 12 }}>{left ? `${left} decision${left === 1 ? '' : 's'} waiting` : 'All clear for today.'}</span>
    </div>
  );
}
