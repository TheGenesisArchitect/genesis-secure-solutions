// What an agency sees on a module its program doesn't include (and no trial covers): what it does, which program
// includes it, and a one-tap ask to the Genovus team for a trial or an upgrade.
import { ActionForm } from '@/components/ActionForm';
import { Panel, Chip } from '@/components/ui';
import { createCareRequest } from '@/lib/actions';
import { MODULES, PROGRAM_NAME } from '@/lib/programs';
import type { AgencyCtx } from '@/components/AgencyShell';

export function ModuleGate({ ctx, moduleKey }: { ctx: AgencyCtx; moduleKey: string }) {
  const m = MODULES.find((x) => x.key === moduleKey);
  if (!m) return null;
  const base = `/app/${ctx.tenant.slug}`;
  return (
    <Panel title={m.label} sub={m.blurb} actions={<Chip kind="info">Included in {PROGRAM_NAME[m.tier]}</Chip>}>
      <p className="soft" style={{ margin: 0 }}>{m.label} is part of the {PROGRAM_NAME[m.tier]} program. Ask the Genovus team and we can switch it on for you, as a free trial or with an upgrade.</p>
      {ctx.isOwner ? (
        <ActionForm action={createCareRequest} className="row" style={{ gap: 8 }}>
          <input type="hidden" name="tenant" value={ctx.tenant.tenantId} />
          <input type="hidden" name="back" value={`${base}${m.path ?? ''}`} />
          <input type="hidden" name="kind" value="support" />
          <input type="hidden" name="title" value={`Trial request: ${m.label}`} />
          <input type="hidden" name="detail" value={`${ctx.tenant.name} would like to try ${m.label} (${PROGRAM_NAME[m.tier]}).`} />
          <button className="btn small primary" type="submit">Try {m.label} free</button>
          <span className="muted" style={{ fontSize: 12 }}>Goes to the Genovus team; nothing changes on your bill without your OK.</span>
        </ActionForm>
      ) : <p className="muted" style={{ margin: 0, fontSize: 13 }}>Ask your agency owner to request it.</p>}
    </Panel>
  );
}
