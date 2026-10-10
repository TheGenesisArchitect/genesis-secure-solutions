'use client';
// The Genovus World sandbox: switch between the Enterprise, Agent and Network surfaces (and "Hire Helix"), toggle
// the agency's package, and click any module to see what it does, whether it is Live, Building or Vision, and
// open the real page when it is live. Sample data throughout.
import { useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { MODULES, SURFACES, TIERS, HELIX_ROLES, WORLD, STATUS_LABEL, tierRank, type Surface, type Tier, type WorldModule } from '@/lib/world';

type View = Surface | 'helix';

export function WorldSandbox() {
  const [view, setView] = useState<View>('enterprise');
  const [tier, setTier] = useState<Tier>('growth');
  const [pick, setPick] = useState<Record<string, string>>({});
  const [role, setRole] = useState(HELIX_ROLES[0].key);

  const surface = view === 'helix' ? null : SURFACES.find((s) => s.key === view)!;
  const mods = view === 'helix' ? [] : MODULES.filter((m) => m.surface === view);
  const included = (m: WorldModule) => !m.tier || tierRank[m.tier] <= tierRank[tier];
  const current = mods.find((m) => m.key === pick[view]) ?? mods.find(included) ?? mods[0];
  const r = HELIX_ROLES.find((x) => x.key === role)!;
  const roleLocked = tierRank[r.tier] > tierRank[tier];

  return (
    <div className="world">
      <div className="world-tabs" role="tablist" aria-label="Surface" data-tour="world-tabs">
        {[...SURFACES.map((s) => ({ key: s.key as View, name: s.name, who: s.who })), { key: 'helix' as View, name: 'Hire Helix', who: 'The agency’s first hire' }].map((s) => (
          <button key={s.key} data-tour-action={s.key === 'helix' ? 'hire_helix' : `show_${s.key}`} role="tab" aria-selected={view === s.key} className={'world-tab' + (view === s.key ? ' on' : '') + (s.key === 'helix' ? ' helix' : '')} onClick={() => setView(s.key)}>
            {s.key === 'helix' ? <img src="/brand/genovus/genovus-egg.svg" alt="" aria-hidden="true" /> : null}
            <b>{s.name}</b><small>{s.who}</small>
          </button>
        ))}
      </div>

      {view === 'agent' || view === 'helix' ? (
        <div className="world-tiers" role="radiogroup" aria-label="Package" data-tour="world-tiers">
          {TIERS.map((t) => (
            <button key={t.key} data-tour-action={`package_${t.key}`} role="radio" aria-checked={tier === t.key} className={'world-tier' + (tier === t.key ? ' on' : '')} onClick={() => setTier(t.key)}>
              <b>{t.name}</b><span>{t.price}</span><small>{t.line}</small>
            </button>
          ))}
        </div>
      ) : null}

      {surface ? (
        <div className="world-frame" data-tour="world-frame">
          <div className="world-frame-head">
            <span className="v-eyebrow">{surface.name} · {view === 'agent' ? `${WORLD.agency.name} (demo agency)` : view === 'network' ? `${WORLD.network.name} · ${WORLD.network.region}` : WORLD.hq}</span>
            <p>{surface.promise}</p>
          </div>
          <div className="world-body">
            <nav className="world-rail" aria-label={`${surface.name} modules`}>
              {mods.map((m) => {
                const ok = included(m);
                return (
                  <button key={m.key} className={'world-mod' + (current?.key === m.key ? ' on' : '') + (ok ? '' : ' locked')} onClick={() => setPick((p) => ({ ...p, [view]: m.key }))} aria-current={current?.key === m.key}>
                    <Icon name={m.icon} size={16} />
                    <span>{m.name}</span>
                    {ok ? <i className={`world-dot ${m.status}`} title={STATUS_LABEL[m.status]} /> : <small className="world-lock">{TIERS.find((t) => t.key === m.tier)!.name}</small>}
                  </button>
                );
              })}
            </nav>
            {current ? (
              <article className="world-card" key={current.key}>
                <div className="spread">
                  <h3><Icon name={current.icon} size={20} /> {current.name}</h3>
                  <span className={`world-status ${current.status}`}>{STATUS_LABEL[current.status]}</span>
                </div>
                {!included(current) ? <p className="world-upsell">Included in <b>{TIERS.find((t) => t.key === current.tier)!.name}</b>. <button className="btn small" onClick={() => setTier(current.tier!)}>See it in {TIERS.find((t) => t.key === current.tier)!.name}</button></p> : null}
                <p className="world-blurb">{current.blurb}</p>
                {current.kpis ? <div className="world-kpis">{current.kpis.map(([k, v]) => <div key={k}><small>{k}</small><b>{v}</b></div>)}</div> : null}
                {current.items ? <ul className="world-items">{current.items.map((x) => <li key={x}>{x}</li>)}</ul> : null}
                <div className="row" style={{ gap: 8 }}>
                  {current.route ? <Link className="btn small primary" href={current.route}>{current.status === 'live' ? 'Open the live page →' : 'See it in the vision →'}</Link> : null}
                  <span className="chip sample">Sample data</span>
                </div>
              </article>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="world-frame" data-tour="world-frame">
          <div className="world-frame-head">
            <span className="v-eyebrow">Hire Helix · {WORLD.agency.name}</span>
            <p>Hiring Helix is the agency hiring its first agent. It knows the business and every role in it. On Growth it assists in every channel; on Premium you give it a role, a task or a department.</p>
          </div>
          <div className="world-body">
            <nav className="world-rail" aria-label="Helix roles">
              {HELIX_ROLES.map((x) => {
                const ok = tierRank[x.tier] <= tierRank[tier];
                return (
                  <button key={x.key} className={'world-mod' + (role === x.key ? ' on' : '') + (ok ? '' : ' locked')} onClick={() => setRole(x.key)}>
                    <Icon name="helix" size={16} /><span>{x.name}</span>
                    {ok ? null : <small className="world-lock">{TIERS.find((t) => t.key === x.tier)!.name}</small>}
                  </button>
                );
              })}
            </nav>
            <article className="world-card" key={r.key}>
              <div className="spread"><h3><img src="/brand/genovus/genovus-egg.svg" alt="" aria-hidden="true" className="world-egg" /> A sample day: {r.name}</h3><span className="world-status vision">Vision</span></div>
              {roleLocked ? <p className="world-upsell">Assigning roles is a <b>Premium</b> feature. <button className="btn small" onClick={() => setTier('premium')}>See it in Premium</button></p> : null}
              <ol className="world-day">
                {r.day.map((d) => <li key={d.t + d.what}><time>{d.t}</time><span>{d.what}</span>{d.lane ? <em className={d.lane === 'auto' ? 'auto' : 'tap'}>{d.lane}</em> : null}</li>)}
              </ol>
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>Hard lines: Helix never quotes, binds or gives coverage advice; every send, post or call waits for a person; it always says it’s an AI.</p>
              <span className="chip sample" style={{ justifySelf: 'start' }}>Sample data</span>
            </article>
          </div>
        </div>
      )}
    </div>
  );
}
