// The cast: Maya, Trent and Bri from the GENOVUS Cast Character Bible, each with their identity-package progress,
// plus the ensemble set (relative scale, the seated three-shot in seat order, each pair) once all three front
// portraits are approved.
import Link from 'next/link';
import { ConsoleShell } from '@/components/ConsoleShell';
import { Panel, Chip, Empty } from '@/components/ui';
import { IdentitySlot, type SlotRef } from '@/components/studio/StudioClient';
import { requireStaff } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { ENSEMBLE, slotsFor } from '@/lib/studio-cast';
import { IMAGE_CENTS } from '@/lib/studio-gen';
import { StudioHelix } from '@/components/studio/StudioHelix';

export const metadata = { title: 'Cast · Studio' };
export const dynamic = 'force-dynamic';

type Sig = { slot: string; label: string; direction: string };

export default async function Cast() {
  await requireStaff();
  const supabase = await db();
  const { data: series } = await supabase.from('studio_series').select('id, name').eq('slug', 'genovus-just-knows').maybeSingle();
  const [{ data: chars }, { data: refs }, { data: looks }] = await Promise.all([
    supabase.from('studio_characters').select('id, code, name, archetype, role, age, profile').eq('status', 'active').order('sort'),
    supabase.from('studio_refs').select('id, character_id, slot, ref_set, status, approved, error, asset_code, version, created_at').not('slot', 'is', null).order('created_at', { ascending: false }),
    supabase.from('studio_looks').select('character_id, code, description'),
  ]);
  const all = (refs ?? []) as (SlotRef & { character_id: string | null; slot: string; ref_set: string })[];
  const allFronts = (chars ?? []).every((c) => all.some((r) => r.character_id === c.id && r.slot === 'FACE_FRONT' && r.approved));
  const cost = `$${(IMAGE_CENTS / 100).toFixed(2)}`;
  return (
    <ConsoleShell title="Cast" crumbs={[{ href: '/console', label: 'Enterprise' }, { href: '/console/studio', label: 'Studio' }, { label: 'Cast' }]} actions={<span className="row" style={{ gap: 8 }}><Link className="btn small" href="/console/studio/bible">Open the Character Bible</Link><StudioHelix focus={{ kind: 'cast', label: 'the cast' }} /></span>}>
      <p className="soft">Maya, Trent and Bri, from the GENOVUS Cast Character Bible v1.0. Each face is locked once: the front portrait comes from the bible’s identity prompt, and every other view is derived from it, so every angle is the same person.</p>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,340px),1fr))' }}>
        {(chars ?? []).map((c) => {
          const mine = all.filter((r) => r.character_id === c.id);
          const front = mine.find((r) => r.slot === 'FACE_FRONT' && r.approved);
          const slots = slotsFor((c.profile as { signature_slot?: Sig }).signature_slot, (looks ?? []).filter((l) => l.character_id === c.id));
          const done = slots.filter((s) => mine.some((r) => r.slot === s.slot && r.approved)).length;
          return (
            <Link key={c.id} href={`/console/studio/cast/${c.code}`} className="tile cast-card">
              {front ? <img src={`/api/studio/media/ref/${front.id}`} alt={`${c.name}, approved front portrait`} /> : <span className="cast-blank">{c.name[0]}</span>}
              <span className="grid" style={{ gap: 6 }}>
                <span className="row" style={{ gap: 6 }}><Chip kind="info">{c.code}</Chip><Chip kind={done === slots.length ? 'done' : 'pending'}>{done}/{slots.length} approved</Chip></span>
                <b style={{ font: '800 18px var(--display)' }}>{c.name}</b>
                <span className="muted" style={{ fontSize: 13 }}>{c.archetype} · {c.age} · {c.role}</span>
                <span className="soft" style={{ fontSize: 13 }}>{(c.profile as { sentence?: string }).sentence}</span>
              </span>
            </Link>
          );
        })}
      </div>
      {!(chars ?? []).length ? <Panel><Empty title="No cast yet">Load the bible with scripts/seed-cast.mjs.</Empty></Panel> : null}
      {series ? (
        <Panel title="Ensemble set" sub="Relative scale, the seated three-shot in the bible’s seat order (Trent, Bri, Maya, left to right), and each pair. Unlocks once all three front portraits are approved.">
          <div className="id-grid">
            {ENSEMBLE.map((s) => (
              <IdentitySlot key={s.slot} target={{ series: series.id }} label={s.label} slot={s.slot} refs={all.filter((r) => r.character_id === null && r.slot === s.slot)} locked={allFronts ? undefined : 'Approve all three front portraits first.'} costLabel={cost} />
            ))}
          </div>
        </Panel>
      ) : null}
    </ConsoleShell>
  );
}
