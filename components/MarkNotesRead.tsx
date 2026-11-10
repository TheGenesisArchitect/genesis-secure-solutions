'use client';
// Opening the Upgrades page marks the notes on it read for this person (once each), so the menu count and Helix's
// "new from the Genovus team" card clear.
import { useEffect } from 'react';
import { readUpgradeNote } from '@/lib/upgrade-actions';

export function MarkNotesRead({ ids }: { ids: string[] }) {
  useEffect(() => {
    const t = setTimeout(() => { for (const id of ids) void readUpgradeNote(id); }, 1500);
    return () => clearTimeout(t);
  }, [ids]);
  return null;
}
