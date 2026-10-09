// The identity package from the GENOVUS Cast Character Bible: the slots every recurring character needs, in the
// bible's production order (front portrait first, everything else derived from it), with the asset-code parts
// used to name each image (MAYA01_FACE_v01_FRONT) and the direction used to generate it.

export type Slot = { slot: string; set: 'portrait' | 'performance' | 'look' | 'ensemble'; group: string; view: string; label: string; direction: string };

const PLAIN = 'plain light-gray studio background, even soft light, natural skin texture, realistic proportions, photoreal';

export const PORTRAIT: Slot[] = [
  { slot: 'FACE_FRONT', set: 'portrait', group: 'FACE', view: 'FRONT', label: 'Front portrait', direction: '' },
  { slot: 'FACE_34_L', set: 'portrait', group: 'FACE', view: '34L', label: 'Left three-quarter', direction: `Head-and-shoulders portrait, face turned to a three-quarter view toward the person's own left (we see more of their right cheek). Neutral relaxed expression. ${PLAIN}.` },
  { slot: 'FACE_34_R', set: 'portrait', group: 'FACE', view: '34R', label: 'Right three-quarter', direction: `Head-and-shoulders portrait, face turned to a three-quarter view toward the person's own right (we see more of their left cheek). Neutral relaxed expression. ${PLAIN}.` },
  { slot: 'PROFILE_L', set: 'portrait', group: 'FACE', view: 'PROFILE_L', label: 'Left profile', direction: `Head-and-shoulders strict side profile facing the person's own left. Neutral expression. ${PLAIN}.` },
  { slot: 'PROFILE_R', set: 'portrait', group: 'FACE', view: 'PROFILE_R', label: 'Right profile', direction: `Head-and-shoulders strict side profile facing the person's own right. Neutral expression. ${PLAIN}.` },
  { slot: 'SMILE', set: 'portrait', group: 'FACE', view: 'SMILE', label: 'Natural smile', direction: `Front head-and-shoulders portrait with a natural, genuine smile in this person's own way. ${PLAIN}.` },
  { slot: 'BODY', set: 'portrait', group: 'BODY', view: 'STAND', label: 'Full body standing', direction: `Full body standing, relaxed natural posture, simple plain clothing, feet visible, showing true height and build. ${PLAIN}.` },
];

export const PERFORMANCE: Slot[] = [
  { slot: 'SEATED', set: 'performance', group: 'BODY', view: 'SEATED', label: 'Seated neutral', direction: `Seated on a simple chair, medium shot from the waist up at seated eye level, relaxed neutral attention. ${PLAIN}.` },
  { slot: 'EXPR_LISTEN', set: 'performance', group: 'EXPR', view: 'LISTEN', label: 'Active listening', direction: `Seated medium close-up, actively listening to someone just off camera to their right, attentive eyes, slight lean. ${PLAIN}.` },
  { slot: 'EXPR_CONCERN', set: 'performance', group: 'EXPR', view: 'CONCERN', label: 'Controlled concern', direction: `Seated medium close-up, controlled concern: brows slightly drawn, mouth set, still composed. ${PLAIN}.` },
  { slot: 'EXPR_SURPRISE', set: 'performance', group: 'EXPR', view: 'SURPRISE', label: 'Surprise', direction: `Seated medium close-up, genuine surprise: raised brows, eyes widened, natural not cartoonish. ${PLAIN}.` },
  { slot: 'EXPR_LAUGH', set: 'performance', group: 'EXPR', view: 'LAUGH', label: 'Genuine laughter', direction: `Seated medium close-up, genuine uncontrolled laughter, eyes creased, head tipping back slightly. ${PLAIN}.` },
  { slot: 'EXPR_REASSURE', set: 'performance', group: 'EXPR', view: 'REASSURE', label: 'Reassurance', direction: `Seated medium close-up, warm reassuring look toward someone just off camera, small calm smile. ${PLAIN}.` },
  { slot: 'EXPR_DISAPPOINT', set: 'performance', group: 'EXPR', view: 'DISAPPOINT', label: 'Disappointment', direction: `Seated medium close-up, quiet disappointment, slight frown, eyes lowered. ${PLAIN}.` },
  { slot: 'EXPR_QUIET', set: 'performance', group: 'EXPR', view: 'QUIET', label: 'Quiet vulnerable moment', direction: `Seated medium close-up, a quiet, vulnerable, honest moment, soft eyes, no smile. ${PLAIN}.` },
];

export const ENSEMBLE: Slot[] = [
  { slot: 'ENS_SCALE', set: 'ensemble', group: 'ENSEMBLE', view: 'SCALE', label: 'Group scale (full body)', direction: `The three people from the reference portraits standing side by side, full body, each at their true height and build, relaxed and friendly, plain simple clothing. ${PLAIN}.` },
  { slot: 'ENS_SEATED', set: 'ensemble', group: 'ENSEMBLE', view: 'SEATED3', label: 'Seated three-shot', direction: `The three people from the reference portraits seated close together in a row, medium shot at seated eye level, left to right exactly in this order: TRENT, BRI, MAYA. Their gaze is slightly camera left. ${PLAIN}.` },
  { slot: 'ENS_PAIR_MT', set: 'ensemble', group: 'ENSEMBLE', view: 'PAIR_MT', label: 'Maya & Trent talking', direction: `Maya and Trent from the reference portraits in an ordinary friendly conversation, seated, medium two-shot. ${PLAIN}.` },
  { slot: 'ENS_PAIR_MB', set: 'ensemble', group: 'ENSEMBLE', view: 'PAIR_MB', label: 'Maya & Bri talking', direction: `Maya and Bri from the reference portraits in an ordinary friendly conversation, seated, medium two-shot. ${PLAIN}.` },
  { slot: 'ENS_PAIR_TB', set: 'ensemble', group: 'ENSEMBLE', view: 'PAIR_TB', label: 'Trent & Bri talking', direction: `Trent and Bri from the reference portraits in an ordinary friendly conversation, seated, medium two-shot. ${PLAIN}.` },
];

/** The character's signature beat (from the bible) as a performance slot. */
export function signatureSlot(sig: { slot: string; label: string; direction: string } | undefined): Slot | null {
  if (!sig) return null;
  return { slot: sig.slot, set: 'performance', group: 'EXPR', view: sig.slot.replace(/^SIG_/, ''), label: sig.label, direction: `${sig.direction} ${PLAIN}.` };
}

/** A wardrobe look (e.g. EP001_MAYA_LOOK01) as a full-body slot. */
export function lookSlot(look: { code: string; description: string }): Slot {
  return { slot: `LOOK_${look.code}`, set: 'look', group: 'LOOK', view: look.code, label: `Look ${look.code}`, direction: `Full body standing, wearing exactly: ${look.description} ${PLAIN}.` };
}

export function slotsFor(sig: { slot: string; label: string; direction: string } | undefined, looks: { code: string; description: string }[]): Slot[] {
  const s = signatureSlot(sig);
  return [...PORTRAIT, ...PERFORMANCE, ...(s ? [s] : []), ...looks.map(lookSlot)];
}

export function findSlot(slot: string, sig: { slot: string; label: string; direction: string } | undefined, looks: { code: string; description: string }[]): Slot | null {
  return [...slotsFor(sig, looks), ...ENSEMBLE].find((x) => x.slot === slot) ?? null;
}
