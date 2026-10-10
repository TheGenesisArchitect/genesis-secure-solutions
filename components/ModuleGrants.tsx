'use client';
// Enterprise toggle for one agency: every module by program, what this agency has (its program, a trial, or off),
// a one-tap "Growth for 30 days", and per-module grants or revokes. One shell, scaled by these switches.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { grantModules, revokeModules } from '@/lib/staff-access';
import { MODULES, PROGRAM_NAME, includes, type ProgramId } from '@/lib/programs';

type Grant = { module_key: string; until: string | null };
const toast = (r: { ok?: string; err?: string }) => window.dispatchEvent(new CustomEvent('genovus:toast', { detail: { ...r, at: Date.now() } }));
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });

export function ModuleGrants({ tenantId, program, grants }: { tenantId: string; program: ProgramId; grants: Grant[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const active = new Map(grants.filter((g) => !g.until || new Date(g.until).getTime() > Date.now()).map((g) => [g.module_key, g.until]));
  const run = async (p: Promise<{ ok?: string; err?: string }>) => { setBusy(true); toast(await p); setBusy(false); router.refresh(); };
  const growthLive = MODULES.filter((m) => m.tier === 'growth' && m.live).map((m) => m.key);
  return (
    <div className="grid" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {program === 'launch' ? <button className="btn small primary" type="button" disabled={busy} onClick={() => run(grantModules(tenantId, growthLive, 30, 'Growth trial'))}>Give Growth for 30 days</button> : null}
        {active.size ? <button className="btn small ghost" type="button" disabled={busy} onClick={() => run(revokeModules(tenantId, [...active.keys()]))}>Turn off all grants</button> : null}
        <span className="muted" style={{ fontSize: 12 }}>Program: {PROGRAM_NAME[program]}. Grants add modules on top; trials end by themselves.</span>
      </div>
      <ul className="list">
        {MODULES.filter((m) => m.tier !== 'launch').map((m) => {
          const inProgram = includes(program, m);
          const g = active.has(m.key);
          return (
            <li key={m.key} className="spread" style={{ gap: 8 }}>
              <span><b>{m.label}</b> <span className="muted" style={{ fontSize: 12 }}>· {PROGRAM_NAME[m.tier]}{m.live ? '' : ' · not built yet'}</span></span>
              <span className="row" style={{ gap: 6 }}>
                {inProgram ? <span className="chip done">In program</span> : g ? <span className="chip info">{active.get(m.key) ? `Trial to ${day(active.get(m.key)!)}` : 'On'}</span> : <span className="chip">Off</span>}
                {!inProgram && m.live ? (g
                  ? <button className="btn small ghost" type="button" disabled={busy} onClick={() => run(revokeModules(tenantId, [m.key]))}>Turn off</button>
                  : <><button className="btn small" type="button" disabled={busy} onClick={() => run(grantModules(tenantId, [m.key], 30, 'Trial'))}>30 days</button><button className="btn small ghost" type="button" disabled={busy} onClick={() => run(grantModules(tenantId, [m.key], null, 'Granted'))}>On</button></>) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
