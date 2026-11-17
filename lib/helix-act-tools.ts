// Helix's hands in UnEdit Studio and the Newsroom: the action list with each one's lane, the voice tool declarations and
// the rules Helix follows. Light on purpose (no server imports), so voice setups can include it; the actions themselves
// run in lib/helix-studio-act.ts.
export type Lane = 'free' | 'spend' | 'yes';
export const ACTIONS: Record<string, { lane: Lane; does: string; cost?: string; slow?: boolean }> = {
  // Newsroom
  sweep_wire: { lane: 'free', does: 'read every beat’s public feeds now (no paid search)', slow: true },
  write_brief: { lane: 'free', does: 'write today’s morning brief from the desk', slow: true },
  pick_angle: { lane: 'free', does: 'pick a story’s angle (angle: its number, 1 is the first)' },
  set_parts: { lane: 'free', does: 'set the parts Helix builds for a story (parts: separated by semicolons)' },
  voiced: { lane: 'free', does: 'write a story in the host’s own voice or not (on: yes/no)' },
  next_upload: { lane: 'free', does: 'cut the next UnEdit upload against a story’s latest production' },
  research_beat: { lane: 'spend', does: 'research one beat live with web search (beat: its name)', cost: 'about $0.20–0.60', slow: true },
  research_deeper: { lane: 'spend', does: 'research one story deeper for new sourced facts', cost: 'about $0.20–0.50', slow: true },
  write_production: { lane: 'spend', does: 'write the package for a story: script, teleprompter, article, social, newsletter (needs an approved fact)', cost: 'about $0.10–0.40', slow: true },
  faceless_video: { lane: 'spend', does: 'voice and build a faceless video from a story’s production (length: short/full)', cost: 'about $0.10–0.80 for the voice' },
  approve_claim: { lane: 'yes', does: 'approve a story’s fact (claim: its number on the story card) so productions may use it' },
  drop_claim: { lane: 'yes', does: 'take a fact out of a story (claim: its number)' },
  dismiss_story: { lane: 'yes', does: 'take a story off the wire' },
  // UnEdit (a recording's card)
  approve_clip: { lane: 'free', does: 'mark a clip approved (clip: its number)' },
  leave_out_clip: { lane: 'free', does: 'leave a clip out of the campaign' },
  reopen_clip: { lane: 'free', does: 'bring a left-out or approved clip back to review' },
  edit_clip: { lane: 'free', does: 'change a clip’s title or its Instagram, Facebook or YouTube copy' },
  edit_episode: { lane: 'free', does: 'change the recording’s title or description' },
  pick_thumbnail: { lane: 'free', does: 'pick the thumbnail (thumb: 1, 2 or 3)' },
  set_package: { lane: 'free', does: 'switch the graphics package (package: its name)' },
  redo_clip: { lane: 'spend', does: 'recut a clip from a note (note: what to change)', cost: 'a few cents' },
  retry: { lane: 'spend', does: 'retry a stopped recording from the step that failed', cost: 'the cost of that step' },
  approve_campaign: { lane: 'yes', does: 'Approve the campaign: every ready clip and the full video go on the calendar (mode: now/plan; rhythm: flood/drip/steady)' },
  post_full_video: { lane: 'yes', does: 'post the full video to YouTube now' },
};

/** Voice tools (Gemini Live) for Studio and Enterprise voice. */
export const studioActTools = [
  { name: 'studio_action', description: `Press a button in the Newsroom or UnEdit Studio. action: ${Object.entries(ACTIONS).map(([k, m]) => `${k} (${m.does}${m.lane === 'spend' ? `; spends ${m.cost}` : ''}${m.lane === 'yes' ? '; needs a yes' : ''})`).join('; ')}. story: words from the headline or "this"; recording: words from the title or "this"; clip, claim, angle, thumb: numbers.`,
    parameters: { type: 'OBJECT', properties: { action: { type: 'STRING', enum: Object.keys(ACTIONS) }, story: { type: 'STRING' }, recording: { type: 'STRING' }, clip: { type: 'NUMBER' }, claim: { type: 'NUMBER' }, angle: { type: 'NUMBER' }, thumb: { type: 'NUMBER' }, note: { type: 'STRING' }, title: { type: 'STRING' }, description: { type: 'STRING' }, instagram: { type: 'STRING' }, facebook: { type: 'STRING' }, youtube: { type: 'STRING' }, parts: { type: 'STRING' }, beat: { type: 'STRING' }, package: { type: 'STRING' }, mode: { type: 'STRING', enum: ['now', 'plan'] }, rhythm: { type: 'STRING', enum: ['flood', 'drip', 'steady'] }, length: { type: 'STRING', enum: ['short', 'full'] }, on: { type: 'STRING' } }, required: ['action'] } },
  { name: 'confirm_studio_action', description: 'Do the action you just read back. ONLY right after the person clearly said yes to that summary in this conversation. Pass the token the studio_action result gave you.', parameters: { type: 'OBJECT', properties: { token: { type: 'STRING' } }, required: ['token'] } },
  { name: 'open_studio', description: 'Take the person to a place in UnEdit Studio and show it: place newsroom, recordings, record, music, calendar, story (name: headline words) or recording (name: title words).', parameters: { type: 'OBJECT', properties: { place: { type: 'STRING', enum: ['newsroom', 'recordings', 'record', 'music', 'calendar', 'story', 'recording'] }, name: { type: 'STRING' } }, required: ['place'] } },
  { name: 'point_at', description: 'Point at something on the screen: a clip, a button, a heading or a story as its words appear.', parameters: { type: 'OBJECT', properties: { text: { type: 'STRING' } }, required: ['text'] } },
];

export const studioActRules = (voice: boolean) => `
HANDS-FREE IN THE NEWSROOM AND UNEDIT: you press the same buttons the team does. ${voice ? 'Call studio_action.' : 'Reply with only {"lookup": {"tool": "studio_action", "args": {"action": ..., ...}}, "answer": "One moment."} and you will be asked again with the result.'}
- Free actions (angles, parts, next upload, approving or leaving out clips, copy, thumbnails, sweeps, the brief): just do them, then say in one sentence what changed.
- Spend actions (research a beat or a story deeper, write the package, a faceless video, recut a clip, retry): say the rough cost in a few words, then do it; the slow ones run in the background and land on the page.
- Yes actions (approve the campaign, post the full video, approve or drop a fact, take a story off the wire): studio_action only returns a summary and a token. Read the summary out and ask "Shall I?". ${voice ? 'Only after a clear yes, call confirm_studio_action with that token.' : 'The person confirms with the Yes button on screen.'} Never confirm on your own, on a maybe, or for a different summary.
- Move around for them: ${voice ? 'open_studio to go to a story, a recording, the Newsroom or the calendar, and point_at to show what you mean.' : 'tell them where to look.'} Look stories and recordings up first (story_card, recording_card) when you need their details.
- Never say something was done unless the result says ok. If it fails, say why and what would fix it.`;
