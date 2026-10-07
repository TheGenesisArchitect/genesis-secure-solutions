// Live setup status for the dashboards, read from the same Blob files the welcome page and social wizard
// write. Read-only: dashboards never write these files, so a client mid-setup is never disturbed.
import 'server-only';
import { findClientBySlug, hasWelcome } from './clients';
import { readProgress, storageConfigured, STEP_KEYS } from './progress';
import { readSession, summary } from './social-session';
import { setupFor } from './social-setup';

export const WELCOME_STEP_LABEL: Record<(typeof STEP_KEYS)[number], string> = {
  portrait: 'Send a portrait',
  approval: 'Approve the draft site',
  social: 'Set up social profiles',
  domain: 'Choose a domain',
  kickoff: 'Book the kickoff call',
};

export type LiveSetup = {
  welcome: null | { steps: { key: string; label: string; done: boolean }[]; done: number; total: number; domainChoice: string; kickoffTimes: string; updatedAt?: string; url: string };
  social: null | { done: number; total: number; approvedBy: string | null; approvedAt: string | null; links: Record<string, string>; wants: string[]; updatedAt?: string; clientUrl: string; consoleUrl: string };
  error?: string;
};

export async function liveSetup(slug: string): Promise<LiveSetup> {
  const c = findClientBySlug(slug);
  if (!c) return { welcome: null, social: null };
  if (!storageConfigured()) return { welcome: null, social: null, error: 'Setup storage is not connected in this environment.' };
  try {
    const setup = c.social?.plan?.length ? setupFor(c) : null;
    const [progress, session] = await Promise.all([hasWelcome(c) ? readProgress(c) : null, setup ? readSession(c, setup) : null]);
    const welcome = progress && hasWelcome(c)
      ? {
          steps: STEP_KEYS.map((k) => ({ key: k, label: WELCOME_STEP_LABEL[k], done: progress.steps[k] })),
          done: STEP_KEYS.filter((k) => progress.steps[k]).length,
          total: STEP_KEYS.length,
          domainChoice: progress.domainChoice,
          kickoffTimes: progress.kickoffTimes,
          updatedAt: progress.updatedAt,
          url: `/welcome/${c.token}`,
        }
      : null;
    const social = session && setup
      ? {
          ...summary(session, setup.plan),
          approvedBy: session.approval?.by ?? null,
          approvedAt: session.approval?.at ?? null,
          links: session.links,
          wants: session.wants,
          updatedAt: session.updatedAt,
          clientUrl: `/welcome/${c.token}/social`,
          consoleUrl: `/console/social/${c.slug}`,
        }
      : null;
    return { welcome, social };
  } catch {
    return { welcome: null, social: null, error: 'Live setup status could not be read just now.' };
  }
}
