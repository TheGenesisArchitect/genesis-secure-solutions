// The GENOVUS Cast Character Bible as a living page: the bible's text (series, world, cast, relationships,
// camera break, production standards, acceptance checks, season arc) with each character's approved portrait,
// the approved reference assets by code and version, and the decision record. Prints as a clean document.
import Link from 'next/link';
import { ConsoleShell } from '@/components/ConsoleShell';
import { Panel, Chip } from '@/components/ui';
import { requireStaff } from '@/lib/session';
import { Wordmark } from '@/components/Wordmark';
import { AskHelixEgg } from '@/components/studio/AskHelixEgg';
import { HelixTour } from '@/components/vision/HelixTour';
import { db } from '@/lib/supabase/server';

export const metadata = { title: 'Character Bible · Studio' };
export const dynamic = 'force-dynamic';

type Bible = {
  title: string; version: string; date: string; owner: string; premise: string; promise: string; world: string; contract: string;
  intelligences: string[]; comedy_rules: string[]; continuity: string; relationships: { pair: string; pattern: string; growth: string; bond: string }[];
  boundaries: string; voice_test: string; product_dialogue: string; pronunciation: string; sound: string; camera_break: string; continuity_instruction: string;
  seat_map: { order: string[]; performer: string; note: string }; arc: { ep: string; title: string; premise: string; gain: string }[]; running_gags: string[];
  acceptance: { script: string[]; visual: string[]; brand: string[] };
};

const when = (s: string) => new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });

export default async function BiblePage() {
  await requireStaff();
  const supabase = await db();
  const { data: series } = await supabase.from('studio_series').select('id, name, bible').eq('slug', 'genovus-just-knows').maybeSingle();
  const b = (series?.bible as { cast_bible?: Bible } | null)?.cast_bible;
  const [{ data: chars }, { data: approved }, { data: decisions }] = await Promise.all([
    supabase.from('studio_characters').select('id, code, name, archetype, age, role, profile, visual_anchors, wardrobe, voice').eq('status', 'active').order('sort'),
    supabase.from('studio_refs').select('id, character_id, slot, asset_code, version').eq('approved', true).not('slot', 'is', null).order('asset_code'),
    supabase.from('studio_decisions').select('decision, asset_ref, version, reason, decided_at').order('decided_at', { ascending: false }).limit(60),
  ]);
  if (!b) return <ConsoleShell title="Character Bible"><Panel><p className="soft" style={{ margin: 0 }}>Load the bible with scripts/seed-cast.mjs.</p></Panel></ConsoleShell>;
  const front = (cid: string) => (approved ?? []).find((r) => r.character_id === cid && r.slot === 'FACE_FRONT');
  const nameOf = (code: string) => (chars ?? []).find((c) => c.code === code)?.name.split(' ')[0] ?? code;
  return (
    <ConsoleShell title="Character Bible" crumbs={[{ href: '/console', label: 'Enterprise' }, { href: '/console/studio', label: 'Studio' }, { label: 'Character Bible' }]} actions={<Link className="btn small" href="/console/studio/cast">Cast &amp; identity packages</Link>}>
      <article className="bible">
        <header className="studio-hero bible-hero">
          <div className="grid" style={{ gap: 8 }}>
            <span className="v-eyebrow">Version {b.version} · {when(b.date)} · {b.owner}</span>
            <h2>{/^GENOVUS\b/.test(b.title) ? <><Wordmark size={30} /><span>{b.title.replace(/^GENOVUS\s*/, '')}</span></> : b.title}</h2>
            <p style={{ margin: 0 }}><b>Premise.</b> {b.premise}</p>
            <p className="soft" style={{ margin: 0 }}><b>The emotional promise.</b> {b.promise}</p>
          </div>
          <span className="no-print"><AskHelixEgg hint="Helix knows the bible and the cast. Ask anything, out loud." /></span>
        </header>

        <Panel title="The world they share">
          <p style={{ margin: 0 }}>{b.world}</p>
          <p style={{ margin: 0 }}><b>Their social contract.</b> {b.contract}</p>
          <ul className="bible-list">{b.intelligences.map((x) => <li key={x}>{x}</li>)}</ul>
        </Panel>

        <Panel title="Comedy rules">
          <ul className="bible-list">{b.comedy_rules.map((x) => <li key={x}>{x}</li>)}</ul>
          <p className="soft" style={{ margin: 0 }}>{b.continuity}</p>
        </Panel>

        <section className="bible-cast">
          {(chars ?? []).map((c) => {
            const p = c.profile as Record<string, string>;
            const f = front(c.id);
            return (
              <Panel key={c.id} title={`${c.name} · ${c.archetype}`} sub={`${c.code} · age ${c.age} · ${c.role}`}>
                <div className="bible-char">
                  {f ? <img src={`/api/studio/media/ref/${f.id}`} alt={`${c.name}, approved portrait ${f.asset_code}`} /> : <span className="cast-blank">{c.name[0]}</span>}
                  <dl className="bible-sec">
                    <dt>Character sentence</dt><dd>{p.sentence}</dd>
                    <dt>What makes them funny</dt><dd>{p.funny}</dd>
                    <dt>Signature behavior</dt><dd>{p.signature}</dd>
                    <dt>Never write them as</dt><dd>{p.never}</dd>
                    <dt>Visual anchors</dt><dd>{c.visual_anchors}</dd>
                    <dt>Voice</dt><dd>{(c.voice as { direction?: string }).direction}</dd>
                  </dl>
                </div>
                <Link className="btn small ghost no-print" href={`/console/studio/cast/${c.code}`} style={{ justifySelf: 'start' }}>Full profile and identity package →</Link>
              </Panel>
            );
          })}
        </section>

        <Panel title="Relationships">
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,300px),1fr))' }}>
            {b.relationships.map((r) => (
              <div key={r.pair} className="tile" style={{ gap: 6 }}>
                <b>{r.pair}</b>
                <span style={{ fontSize: 13 }}><b>Comic pattern.</b> {r.pattern}</span>
                <span style={{ fontSize: 13 }}><b>Growth.</b> {r.growth}</span>
                <span className="soft" style={{ fontSize: 13 }}><b>Private bond.</b> {r.bond}</span>
              </div>
            ))}
          </div>
          <p className="soft" style={{ margin: 0 }}>{b.boundaries}</p>
        </Panel>

        <Panel title="Dialogue, sound and the camera break">
          <dl className="bible-sec">
            <dt>The voice test</dt><dd>{b.voice_test}</dd>
            <dt>Product dialogue</dt><dd>{b.product_dialogue}</dd>
            <dt>Pronunciation</dt><dd>{b.pronunciation}</dd>
            <dt>Sound</dt><dd>{b.sound}</dd>
            <dt>Maya addresses the audience</dt><dd>{b.camera_break}</dd>
            <dt>Seat and gaze map (Episode 001)</dt><dd>Left to right: {b.seat_map.order.map(nameOf).join(', ')}. Performer {b.seat_map.performer}. {b.seat_map.note}</dd>
            <dt>Shared continuity instruction</dt><dd>{b.continuity_instruction}</dd>
          </dl>
        </Panel>

        <Panel title="Acceptance checks">
          <div className="grid g3" style={{ alignItems: 'start' }}>
            <div><b>Script</b><ul className="bible-list">{b.acceptance.script.map((x) => <li key={x}>{x}</li>)}</ul></div>
            <div><b>Performance and visual</b><ul className="bible-list">{b.acceptance.visual.map((x) => <li key={x}>{x}</li>)}</ul></div>
            <div><b>Brand</b><ul className="bible-list">{b.acceptance.brand.map((x) => <li key={x}>{x}</li>)}</ul></div>
          </div>
        </Panel>

        <Panel title="Season one arc">
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,280px),1fr))' }}>
            {b.arc.map((a) => <div key={a.ep} className="tile" style={{ gap: 6 }}><span className="muted" style={{ fontSize: 12 }}>Episode {a.ep}</span><b>{a.title}</b><span style={{ fontSize: 13 }}>{a.premise}</span><span className="soft" style={{ fontSize: 12 }}>Continuity gain: {a.gain}</span></div>)}
          </div>
          <ul className="bible-list">{b.running_gags.map((x) => <li key={x}>{x}</li>)}</ul>
        </Panel>

        <div className="grid g2" style={{ alignItems: 'start' }}>
          <Panel title="Approved reference assets" sub="By code and version; a change to a face, hair or voice is a new version.">
            {(approved ?? []).length ? <ul className="bible-list mono">{(approved ?? []).map((r) => <li key={r.id}>{r.asset_code}</li>)}</ul> : <p className="muted" style={{ margin: 0 }}>None approved yet.</p>}
          </Panel>
          <Panel title="Decision record">
            {(decisions ?? []).length ? (
              <ul className="bible-list">{(decisions ?? []).map((d, i) => <li key={i}><b>{d.decision}</b>{d.asset_ref ? <> · <span className="mono">{d.asset_ref}</span></> : null} · {when(d.decided_at)}{d.reason ? <> · {d.reason}</> : null}</li>)}</ul>
            ) : <p className="muted" style={{ margin: 0 }}>No decisions recorded yet.</p>}
          </Panel>
        </div>
        <Chip kind="info">All three are fictional adults with original faces and voices.</Chip>
      </article>
      <HelixTour context="bible" floating={false} />
    </ConsoleShell>
  );
}
