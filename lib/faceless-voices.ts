// The narrator voices a faceless video can use (original Gemini prebuilt voices, never an imitation of a real person).
// Shared by the server (lib/unedit-faceless.ts) and the Newsroom's Make it faceless control.
export const FACELESS_VOICES = [
  { id: 'Charon', label: 'Charon · informative' },
  { id: 'Sadaltager', label: 'Sadaltager · knowledgeable' },
  { id: 'Kore', label: 'Kore · firm' },
  { id: 'Puck', label: 'Puck · upbeat' },
] as const;
export type FacelessState = { status: 'voicing' | 'ready' | 'failed'; error?: string; vlog_id?: string; voice: string; length: 'short' | 'full'; at: string };
