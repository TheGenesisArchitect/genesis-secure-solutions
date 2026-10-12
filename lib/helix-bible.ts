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

/** On an episode's production board, Helix can direct and produce by voice: the team stays hands-free on the move. */
export const BOARD_TOOLS = [{
  functionDeclarations: [
    ...BIBLE_TOOLS[0].functionDeclarations,
    { name: 'production_status', description: 'Where every shot on this board is (queued, reading lines, drawing, rendering, ready for review, approved, needs a phone capture, blocked) and what the run has spent. Call it before summarizing progress.', parameters: { type: 'OBJECT', properties: {} } },
    { name: 'direct_shot', description: 'Change a shot\'s direction. shot is the BOARD number (1 is the first card). acting: the performance note; read: the line read with the speaker in capitals and bracketed direction tags, e.g. "TASHA: [warm] Got questions? [quiet] Ask Helix."; camera: the camera move. Free: nothing is generated.',
      parameters: { type: 'OBJECT', properties: { shot: { type: 'NUMBER' }, acting: { type: 'STRING' }, read: { type: 'STRING' }, camera: { type: 'STRING' } }, required: ['shot'] } },
    { name: 'plan_production', description: 'Price producing shots (one read per line, one keyframe and one take each). shots: "all", one number, a range like "4-9", or a list like "2, 5, 11" (board numbers). Returns a quote_id and a total. Read the total out loud and ask for a yes before approving.',
      parameters: { type: 'OBJECT', properties: { shots: { type: 'STRING' } } } },
    { name: 'approve_production', description: 'Start producing exactly the quoted shots. ONLY call this right after the person clearly said yes to the total you read out from plan_production in this conversation. Pass that quote_id. Never guess or reuse an old quote.',
      parameters: { type: 'OBJECT', properties: { quote_id: { type: 'STRING' } }, required: ['quote_id'] } },
    { name: 'review_shot', description: 'Approve a finished shot, or send it back with a note (redo makes a new keyframe and take inside the approved budget). shot is the board number.',
      parameters: { type: 'OBJECT', properties: { shot: { type: 'NUMBER' }, action: { type: 'STRING', enum: ['approve', 'redo'] }, note: { type: 'STRING' } }, required: ['shot', 'action'] } },
    { name: 'lock_cast', description: 'Lock every cast member\'s identity to the official V2 cast sheet (free). Do this when the person approves the cast sheets or when shots are blocked waiting on a lock.', parameters: { type: 'OBJECT', properties: {} } },
    { name: 'raise_ceiling', description: 'When the run paused at its approved ceiling: price what it still needs. Returns a quote_id and total; read it out, and on a clear yes call approve_production with that quote_id.', parameters: { type: 'OBJECT', properties: {} } },
    { name: 'retry_shot', description: 'Start one shot over (cancels its running Runway jobs first). shot is the board number. Use when a shot is stuck or failed.', parameters: { type: 'OBJECT', properties: { shot: { type: 'NUMBER' } }, required: ['shot'] } },
    { name: 'cancel_shot', description: 'Stop one shot: cancel its running Runway jobs (unused credits are returned). shot is the board number.', parameters: { type: 'OBJECT', properties: { shot: { type: 'NUMBER' } }, required: ['shot'] } },
    { name: 'retry_blocked', description: 'Retry every blocked shot in the production run (after fixing what blocked it).', parameters: { type: 'OBJECT', properties: {} } },
    { name: 'pause_production', description: 'Pause the production run: work already started finishes, nothing new starts.', parameters: { type: 'OBJECT', properties: {} } },
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
  lines.push(`You are Helix, the voice of Genovus, speaking with the Genovus Studio team inside the Studio. You know the GENOVUS Cast Character Bible (version ${b?.version ?? '1.0'}), the series "${series?.name ?? 'Genovus Just Knows'}" and its production backwards and forward, and you are their creative partner: answer questions, quote the bible precisely, suggest lines in each character's voice, check scripts against the rules, and flag continuity risks.`);
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

export type StudioFocus = { kind: 'home' | 'bible' | 'cast' | 'episode' | 'character'; code?: string };

/** What the person is looking at in the Studio, in detail, so Helix can work on it with them. */
async function focusBlock(focus: StudioFocus): Promise<string> {
  const db = adminDb();
  if (focus.kind === 'episode' && focus.code) {
    const { data: e } = await db.from('studio_episodes').select('id, code, title, kind, status, logline, script, music, format, fork_mode, target_s, cut_family, final_url').eq('code', focus.code).maybeSingle();
    if (!e) return '';
    const [{ data: shots }, { data: posts }, { data: qa }] = await Promise.all([
      db.from('studio_shots').select('n, shot_code, beat, shot_kind, timing, description, lines, status, log').eq('episode_id', e.id).order('n'),
      db.from('studio_posts').select('platform, status, method, scheduled_for').eq('episode_id', e.id),
      db.from('studio_qa').select('check_key, pass, note').eq('episode_id', e.id),
    ]);
    const shotLines = (shots ?? []).map((s) => `${s.shot_code ?? `Shot ${s.n}`} (beat ${s.beat ?? '-'}, ${s.shot_kind ?? 'shot'}, ${s.timing ?? ''}, ${s.status}): ${s.description}${((s.lines as { who: string; text: string }[]) ?? []).map((l) => ` ${l.who.replace(/\d+$/, '')}: "${l.text}"`).join('')}`).join('\n');
    const board = (shots ?? []).map((s, i) => `Board shot ${i + 1} = ${s.shot_code ?? `shot ${s.n}`}`).join('; ');
    return `PRODUCTION BOARD (you can direct and produce by voice): the team is often on the move, so do the work for them with your tools and keep confirmations short. Shots are referred to by BOARD number: ${board}. To produce: call plan_production, read the total aloud in one sentence and ask "Shall I go ahead?"; only after a clear yes call approve_production with that quote_id. Then say each finished shot is ready for review; they approve or redo by voice. Never claim something was generated, approved or spent unless a tool result says so.\n\nON SCREEN NOW: the episode ${e.code} "${e.title}" (${e.kind}, status ${e.status}${e.format === 'viral_fork' ? `, ${e.fork_mode} Viral Fork, target ${e.target_s}s, ${e.cut_family ?? ''} cut` : ''}${e.final_url ? ', final cut uploaded' : ', no final cut yet'}).\nLogline: ${e.logline}\nScript:\n${e.script}\nMusic/sound: ${e.music}\nShots:\n${shotLines}\nPosts: ${(posts ?? []).map((p) => `${p.platform} ${p.status}${p.method !== 'upload' ? ` (${p.method})` : ''}`).join(', ') || 'none'}.\nAcceptance checks recorded: ${(qa ?? []).length ? (qa ?? []).map((q) => `${q.check_key} ${q.pass ? 'pass' : `FAIL (${q.note})`}`).join('; ') : 'none yet'}.\nHelp them finish this episode: what is left, what to shoot next, whether lines fit the characters, and anything that would fail a check.`;
  }
  if (focus.kind === 'character' && focus.code) {
    const { data: c } = await db.from('studio_characters').select('id, code, name').eq('code', focus.code).maybeSingle();
    if (!c) return '';
    const { data: refs } = await db.from('studio_refs').select('slot, asset_code, approved, status').eq('character_id', c.id).order('created_at', { ascending: false });
    const approved = (refs ?? []).filter((r) => r.approved).map((r) => r.asset_code);
    const slots = [...new Set((refs ?? []).map((r) => r.slot))];
    return `ON SCREEN NOW: ${c.name} (${c.code})'s character page: their bible profile, voice, and identity package. Approved: ${approved.join(', ') || 'nothing yet'}. Slots generated so far: ${slots.join(', ') || 'none'}. The production order is casting sheet, then the front portrait from it, then every other view derived from the approved front. Help them with this character: who they are, how they'd react or speak, and what to generate or approve next.`;
  }
  if (focus.kind === 'cast') return 'ON SCREEN NOW: the cast page with Marcus, Tasha and Julian and the ensemble set. Help with the ensemble: chemistry, seat order, relative scale, and what each character still needs.';
  if (focus.kind === 'home') return 'ON SCREEN NOW: the Studio home: the season gallery, the trend board of viral moments (Remix / licensed / inspired), fresh takes, the cast and the posting schedule. Help them decide what to make next and keep the season on track.';
  return '';
}

/** The Studio brief: the whole bible and production state, plus what is on screen. */
export async function studioSystem(focus: StudioFocus): Promise<string> {
  const base = await bibleSystem();
  const block = await focusBlock(focus);
  return block ? `${base}\n\n${block}` : base;
}
