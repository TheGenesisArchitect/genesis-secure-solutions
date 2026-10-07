// Builds a client's wizard: their plan channels, optional channels, screen order and profile kit.
import type { Client } from './clients';
import { channelRegistry, channelsForClient, partnerDetailsFromEnv, type KitAssetKey, type KitTextKey } from './channels';
import type { Setup } from './social-session';
import mendezKit from '@/data/kits/mendez-hollis.json';
import genovusKit from '@/data/kits/genovus.json';
import demoBrooksKit from '@/data/kits/demo-brooks.json';

export type Kit = {
  pageNames: string[];
  igUsernames: string[];
  facts: [string, string][];
  website: string;
  assets: Record<KitAssetKey | 'portrait', { url: string; file: string; size: string }>;
  /** Optional per-client notes shown at the top of a step, keyed by step id. */
  stepTips?: Record<string, string>;
} & Record<KitTextKey, string>;

const KITS: Record<string, Kit> = { 'mendez-hollis': mendezKit as unknown as Kit, genovus: genovusKit as unknown as Kit, 'demo-brooks': demoBrooksKit as unknown as Kit };

/** Screens around the channel steps: a start page, the copy review, optional channels and a finish page. */
export const FIXED_SCREENS = { start: 'start', review: 'review', more: 'more', finish: 'finish' } as const;

export function setupFor(c: Client): Setup & { kit: Kit | null } {
  const { plan, optional } = channelsForClient(channelRegistry(partnerDetailsFromEnv()), c.social?.plan ?? []);
  const kit = (c.kit as Kit | undefined) ?? KITS[c.slug] ?? null;
  const screens = [
    FIXED_SCREENS.start,
    ...(kit ? [FIXED_SCREENS.review] : []),
    ...plan.flatMap((ch) => ch.steps.map((s) => s.id)),
    ...(optional.length ? [FIXED_SCREENS.more] : []),
    FIXED_SCREENS.finish,
  ];
  return { plan, optional, screens, kit };
}
