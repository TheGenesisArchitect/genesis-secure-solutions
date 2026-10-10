// One recurring character from the GENOVUS Cast Character Bible: who they are (the bible's profile, voice and
// performance notes, Episode 001 look) and their identity package, built in the bible's production order.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConsoleShell } from '@/components/ConsoleShell';
import { Panel, Chip } from '@/components/ui';
import { CopyButton } from '@/components/CopyButton';
import { IdentitySlot, VoiceAudition, CastingUpload, type SlotRef, type VoiceClip } from '@/components/studio/StudioClient';
import { VOICES } from '@/lib/studio-voice';
import { requireStaff } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { PORTRAIT, PERFORMANCE, signatureSlot, lookSlot } from '@/lib/studio-cast';
import { IMAGE_CENTS } from '@/lib/studio-gen';

export const dynamic = 'force-dynamic';

type Sig = { slot: string; label: string; direction: string };
type Profile = Record<string, string> & { signature_slot?: Sig };
type Voice = { direction?: string; timing?: string; listening?: string; reaction?: string; samples?: string[]; tts_voice?: string; locked?: boolean; method?: string };

const SECTIONS: [string, string][] = [
  ['sentence', 'Character sentence'], ['history', 'History and inner life'], ['wants', 'Wants and private fear'], ['belief', 'The belief that trips them up'],
  ['outside', 'Outside work'], ['competence', 'Show their competence'], ['flaw', 'Show their flaw'], ['ladder', 'Pressure ladder'],
  ['funny', 'What makes them funny'], ['signature', 'Signature behavior'], ['vulnerability', 'Vulnerability beat'], ['never', 'Never write them as'], ['season', 'Season destination'],
];

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  return { title: `${(await params).code} · Cast` };
}

export default async function Character({ params }: { params: Promise<{ code: string }> }) {
  await requireStaff();
  const { code } = await params;
  const supabase = await db();
  const { data: c } = await supabase.from('studio_characters').select('*').eq('code', code.toUpperCase()).maybeSingle();
  if (!c) notFound();
  const [{ data: refs }, { data: looks }, { data: clips }] = await Promise.all([
    supabase.from('studio_refs').select('id, slot, status, approved, error, asset_code, version, created_at, basis_id').eq('character_id', c.id).order('created_at', { ascending: false }),
    supabase.from('studio_looks').select('code, description, prop_hand, phone_case').eq('character_id', c.id),
    supabase.from('studio_voice_clips').select('id, slot, voice_name, status, error, text, created_at').eq('character_id', c.id).eq('kind', 'audition').order('created_at', { ascending: false }).limit(60),
  ]);
  const profile = (c.profile ?? {}) as Profile;
  const voice = (c.voice ?? {}) as Voice;
  const all = (refs ?? []) as (SlotRef & { slot: string })[];
  const frontApproved = all.some((r) => r.slot === 'FACE_FRONT' && r.approved);
  const castingId = all.find((r) => r.slot === 'CASTING' && r.approved)?.id ?? null;
  const frontId = all.find((r) => r.slot === 'FACE_FRONT' && r.approved)?.id ?? null;
  const lock = frontApproved ? undefined : `Approve ${c.name.split(' ')[0]}’s front portrait first.`;
  const cost = `$${(IMAGE_CENTS / 100).toFixed(2)}`;
  const sig = signatureSlot(profile.signature_slot);
  const slotRefs = (s: string) => all.filter((r) => r.slot === s);
  return (
    <ConsoleShell title={c.name} crumbs={[{ href: '/console', label: 'Enterprise' }, { href: '/console/studio', label: 'Studio' }, { href: '/console/studio/cast', label: 'Cast' }, { label: c.name }]}>
      <div className="studio-hero">
        <span className="v-eyebrow">{c.code} · {c.archetype}</span>
        <h2>{c.name}</h2>
        <p className="soft">{c.age} · {c.role}</p>
        <p style={{ margin: 0 }}>{profile.sentence}</p>
      </div>

      <Panel title="Portrait set" sub="Upload and approve the casting sheet, then generate the neutral front portrait from it and the bible’s identity prompt. Everything else is derived from the approved front so every angle is the same face. Left and right are from the character’s perspective.">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}><CopyButton text={c.identity_prompt} label="Copy identity prompt" /><span className="muted" style={{ fontSize: 12 }}>Visual anchors: {c.visual_anchors}</span></div>
        <div className="casting-row">
          <IdentitySlot target={{ character: c.id }} label="Casting reference" slot="CASTING" refs={slotRefs('CASTING')} locked="Your chosen casting sheet. Once approved, the front portrait is generated from it." costLabel={cost} />
          <CastingUpload characterId={c.id} />
        </div>
        <div className="id-grid">
          {PORTRAIT.map((s) => <IdentitySlot key={s.slot} target={{ character: c.id }} label={s.label} slot={s.slot} refs={slotRefs(s.slot)} locked={s.slot === 'FACE_FRONT' ? undefined : lock} costLabel={cost} basis={s.slot === 'FACE_FRONT' ? castingId : frontId} />)}
        </div>
      </Panel>

      <Panel title="Performance set" sub={`Seated neutral, listening, concern, surprise, laughter, reassurance, disappointment, a quiet moment${sig ? `, and ${c.name.split(' ')[0]}’s signature: ${sig.label.toLowerCase()}` : ''}.`}>
        <div className="id-grid">
          {[...PERFORMANCE, ...(sig ? [sig] : [])].map((s) => <IdentitySlot key={s.slot} target={{ character: c.id }} label={s.label} slot={s.slot} refs={slotRefs(s.slot)} locked={lock} costLabel={cost} basis={frontId} />)}
        </div>
      </Panel>

      {(looks ?? []).length ? (
        <Panel title="Episode looks" sub="Wardrobe changes by episode; the face, hair and identifying jewelry never do.">
          <div className="id-grid">
            {(looks ?? []).map((l) => {
              const s = lookSlot(l);
              return (
                <div key={l.code} className="grid" style={{ gap: 6 }}>
                  <IdentitySlot target={{ character: c.id }} label={l.code} slot={s.slot} refs={slotRefs(s.slot)} locked={lock} costLabel={cost} basis={frontId} />
                  <span className="soft" style={{ fontSize: 12 }}>{l.description}{l.prop_hand ? ` ${l.prop_hand}` : ''}</span>
                </div>
              );
            })}
          </div>
        </Panel>
      ) : null}

      <div className="grid g2" style={{ alignItems: 'start' }}>
        <Panel title="Who they are" sub="GENOVUS Cast Character Bible v1.0">
          <dl className="bible-sec">{SECTIONS.filter(([k]) => profile[k]).flatMap(([k, label]) => [<dt key={`${k}t`}>{label}</dt>, <dd key={`${k}d`}>{profile[k]}</dd>])}</dl>
        </Panel>
        <Panel title="Voice and performance" sub={voice.locked ? `Locked voice: ${voice.tts_voice} · ${voice.method === 'veo_native' ? 'Veo native dialogue' : 'fixed voice + lip-sync'}` : 'Audition candidate voices with the bible’s voice set; lock the winner after the proof-of-concept.'}>
          <VoiceAudition characterId={c.id} current={voice.tts_voice ?? ''} voices={VOICES} clips={(clips ?? []) as VoiceClip[]} locked={Boolean(voice.locked)} />
          <dl className="bible-sec">
            {voice.direction ? <><dt>Voice direction</dt><dd>{voice.direction}</dd></> : null}
            {voice.timing ? <><dt>Timing</dt><dd>{voice.timing}</dd></> : null}
            {voice.listening ? <><dt>Listening</dt><dd>{voice.listening}</dd></> : null}
            {voice.reaction ? <><dt>Reaction sequence</dt><dd>{voice.reaction}</dd></> : null}
            {voice.samples?.length ? <><dt>Audition lines</dt><dd>{voice.samples.map((s) => <span key={s} style={{ display: 'block' }}>“{s}”</span>)}</dd></> : null}
            <dt>Wardrobe grammar</dt><dd>{c.wardrobe}</dd>
          </dl>
          <Chip kind="info">Voices are original synthetic voices; never a celebrity imitation.</Chip>
        </Panel>
      </div>
      <Link className="btn ghost small" href="/console/studio/cast" style={{ justifySelf: 'start' }}>← All cast</Link>
    </ConsoleShell>
  );
}
