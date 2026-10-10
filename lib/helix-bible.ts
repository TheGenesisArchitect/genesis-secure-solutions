// Ask Helix on the Character Bible: a voice assistant for the Genovus Studio team that knows the GENOVUS Cast
// Character Bible, the recurring characters and the current production state (approved reference assets,
// episodes and their status) backwards and forward. Built from the database at the start of each session, so it
// always reflects the latest canon. Server only; staff only.
import 'server-only';
import { adminDb } from '@/lib/supabase/admin';

type Bible = Record<string, unknown> & {
  title: string; version: string; premise: string; promise: string; world: string; contract: string; intelligences: string[]; comedy_rules: string[];
  continuity: string; relationships: { pair: string; pattern: string; growth: string; bond: string }[]; boundaries: string; voice_test: string;
  product_dialogue: string; pronunciation: string; sound: string; camera_break: string; continuity_instruction: string;
  seat_map: { order: string[]; performer: string }; arc: { ep: string; title: string; premise: string; gain: string }[]; running_gags: string[];
  acceptance: { script: string[]; visual: string[]; brand: string[] };
};

export const BIBLE_TOOLS = [{
  functionDeclarations: [
    { name: 'take_note', description: 'Save a note for the Studio team: an idea, an action item, a question to resolve, or a risk about the bible, the characters or an episode. One specific sentence.',
      parameters: { type: 'OBJECT', properties: { kind: { type: 'STRING', enum: ['idea', 'action_item', 'question', 'risk'] }, text: { type: 'STRING' } }, required: ['kind', 'text'] } },
    { name: 'end_tour', description: 'End the conversation when the listener is done.', parameters: { type: 'OBJECT', properties: {} } },
  ],
}];

export async function bibleSystem(): Promise<string> {
  const db = adminDb();
  const [{ data: series }, { data: chars }, { data: approved }, { data: eps }, { data: looks }] = await Promise.all([
    db.from('studio_series').select('name, bible').eq('slug', 'genovus-just-knows').maybeSingle(),
    db.from('studio_characters').select('code, name, archetype, age, role, profile, visual_anchors, wardrobe, voice').eq('status', 'active').order('sort'),
    db.from('studio_refs').select('asset_code').eq('approved', true).not('slot', 'is', null),
    db.from('studio_episodes').select('code, title, kind, status, format, fork_mode, target_s, logline').not('title', 'like', '[Retired]%').order('sort'),
    db.from('studio_looks').select('code, description'),
  ]);
  const b = (series?.bible as { cast_bible?: Bible } | null)?.cast_bible;
  const lines: string[] = [];
  lines.push(`You are Helix, the voice of Genovus, speaking with the Genovus Studio team about the GENOVUS Cast Character Bible (version ${b?.version ?? '1.0'}) and the series "${series?.name ?? 'Genovus Just Knows'}". You know the bible and the characters backwards and forward, and you are their creative partner: answer questions, quote the bible precisely, suggest lines in each character's voice, check scripts against the rules, and flag continuity risks.`);
  lines.push(`HOW YOU SPEAK: warm, sharp, concise, like a showrunner's right hand. Two to four sentences unless asked for more. You are speaking out loud: no lists or markdown. When you suggest dialogue, keep each character in their voice per the voice test. Stay on the bible, the characters, the series and Genovus Studio production; politely decline anything else. Never invent canon: if something isn't in the bible, say it's not decided yet and offer to note it as a question. When the team decides something or raises an action item, call take_note and confirm in a few words.`);
  if (b) {
    lines.push(`PREMISE: ${b.premise}\nEMOTIONAL PROMISE: ${b.promise}\nWORLD: ${b.world}\nSOCIAL CONTRACT: ${b.contract}\nTHREE INTELLIGENCES: ${b.intelligences.join(' ')}\nCOMEDY RULES: ${b.comedy_rules.join(' ')}\nCONTINUITY: ${b.continuity}`);
  }
  for (const c of chars ?? []) {
    const p = c.profile as Record<string, string>;
    const v = c.voice as Record<string, unknown>;
    lines.push(`CHARACTER ${c.code} · ${c.name}, "${c.archetype}", ${c.age}, ${c.role}.
Sentence: ${p.sentence}
History: ${p.history} Wants: ${p.wants} Belief that trips them up: ${p.belief} Outside work: ${p.outside}
Competence: ${p.competence} Flaw: ${p.flaw} Pressure ladder: ${p.ladder}
Funny because: ${p.funny} Signature: ${p.signature} Vulnerability: ${p.vulnerability} Never: ${p.never} Season destination: ${p.season}
Look: ${c.visual_anchors} Wardrobe: ${c.wardrobe}
Voice: ${v?.direction ?? ''} Timing: ${v?.timing ?? ''} Listening: ${v?.listening ?? ''} Reaction: ${v?.reaction ?? ''} Sample lines: ${((v?.samples as string[]) ?? []).join(' / ')}${v?.locked ? ` Locked synthetic voice: ${v.tts_voice}.` : ''}`);
  }
  if (b) {
    lines.push(`RELATIONSHIPS: ${b.relationships.map((r) => `${r.pair}: ${r.pattern} Growth: ${r.growth} Bond: ${r.bond}`).join(' ')} BOUNDARIES: ${b.boundaries}`);
    lines.push(`DIALOGUE: ${b.voice_test} PRODUCT DIALOGUE: ${b.product_dialogue} PRONUNCIATION: ${b.pronunciation} SOUND: ${b.sound}\nTHE CAMERA BREAK: ${b.camera_break}\nSEAT MAP (Episode 001): left to right ${b.seat_map.order.join(', ')}; performer ${b.seat_map.performer}.\nCONTINUITY INSTRUCTION: ${b.continuity_instruction}`);
    lines.push(`SEASON ONE ARC: ${b.arc.map((a) => `Episode ${a.ep} "${a.title}": ${a.premise} Gain: ${a.gain}`).join(' ')} RUNNING GAGS: ${b.running_gags.join(' ')}`);
    lines.push(`ACCEPTANCE CHECKS. Script: ${b.acceptance.script.join('; ')}. Performance and visual: ${b.acceptance.visual.join('; ')}. Brand: ${b.acceptance.brand.join('; ')}.`);
  }
  lines.push(`RULES OF THE STUDIO: Viral Forks only use remix-enabled content made in the app (split-screen or sequential); a seamless recut needs the creator's written license. Never change the original payoff. Original faces and voices only, never a celebrity likeness. Phone screens are real Genovus features with fictional demo data. AI-generated footage is labeled.`);
  lines.push(`CURRENT PRODUCTION STATE. Episodes: ${(eps ?? []).map((e) => `${e.code} "${e.title}" (${e.kind}, ${e.status}${e.format === 'viral_fork' ? `, ${e.fork_mode} fork` : ''}${e.target_s ? `, ${e.target_s}s` : ''})`).join('; ')}. Episode looks: ${(looks ?? []).map((l) => `${l.code}: ${l.description}`).join(' ')} Approved reference assets: ${(approved ?? []).map((r) => r.asset_code).join(', ') || 'none yet'}.`);
  lines.push(`START: when the session begins, greet the team in one sentence, say you know the bible and the cast, and ask what they want to work on.`);
  return lines.join('\n\n');
}
