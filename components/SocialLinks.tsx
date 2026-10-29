// Genovus's social profiles as icon links (data/socials.ts): the site header (desktop) and footer (every width).
import { SOCIALS, type Social } from '@/data/socials';

const PATHS: Record<Exclude<Social['id'], 'instagram'>, string> = {
  facebook: 'M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.4v7A10 10 0 0 0 22 12Z',
  youtube: 'M23 7.2a3 3 0 0 0-2.1-2.1C19 4.6 12 4.6 12 4.6s-7 0-8.9.5A3 3 0 0 0 1 7.2C.5 9.1.5 12 .5 12s0 2.9.5 4.8a3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.1c.5-1.9.5-4.8.5-4.8s0-2.9-.5-4.8ZM9.7 15.5v-7l6 3.5-6 3.5Z',
  tiktok: 'M16.6 2h-3.3v13.3a2.9 2.9 0 1 1-2-2.8V9.1a6.2 6.2 0 1 0 5.3 6.2V8.6a7.8 7.8 0 0 0 4.4 1.4V6.7a4.4 4.4 0 0 1-4.4-4.7Z',
  linkedin: 'M20.4 2H3.6C2.7 2 2 2.7 2 3.6v16.8c0 .9.7 1.6 1.6 1.6h16.8c.9 0 1.6-.7 1.6-1.6V3.6c0-.9-.7-1.6-1.6-1.6ZM8 19H5V9.5h3V19ZM6.5 8.2a1.7 1.7 0 1 1 0-3.5 1.7 1.7 0 0 1 0 3.5ZM19 19h-3v-4.6c0-1.1 0-2.5-1.5-2.5S12.8 13 12.8 14.3V19h-3V9.5h2.8v1.3h.1c.4-.7 1.4-1.5 2.8-1.5 3 0 3.6 2 3.6 4.6V19Z',
};

export function SocialLinks({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <span className={'socials ' + (className ?? '')}>
      {SOCIALS.map((s) => (
        <a key={s.id} href={s.url} target="_blank" rel="noopener" aria-label={`Genovus on ${s.name}`} title={`Genovus on ${s.name}`}>
          {s.id === 'instagram'
            ? <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.3" cy="6.7" r="1" fill="currentColor" stroke="none" /></svg>
            : <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="currentColor"><path d={PATHS[s.id]} /></svg>}
        </a>
      ))}
    </span>
  );
}
