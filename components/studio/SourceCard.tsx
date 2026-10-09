// A viral moment on the trend board, with the rights evidence its route needs before anything can be approved:
// Stitch/Remix (the creator allows remixing; posted in-app, credited by the platform), Licensed (their written
// permission on file), or Inspired (an original: someone attests it copies no person, character or footage).
import Link from 'next/link';
import { ActionForm } from '@/components/ActionForm';
import { CopyButton } from '@/components/CopyButton';
import { Chip } from '@/components/ui';
import { LicenseUpload } from '@/components/studio/StudioClient';
import { studioSourceRights } from '@/lib/actions';

export type Source = {
  id: string; url: string; platform: string; creator: string | null; title: string; route: string; notes: string | null;
  remix_allowed: boolean | null; license_status: string; license_blob: string | null; original_attested: boolean;
  studio_episodes?: { code: string; title: string } | null;
};

const ROUTE: Record<string, string> = { stitch: 'Stitch / Remix', licensed: 'Licensed', inspired: 'Inspired original' };
const PLATFORM: Record<string, string> = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', facebook: 'Facebook', other: 'Web' };

export function cleared(s: Source) {
  if (s.route === 'stitch') return s.remix_allowed === true;
  if (s.route === 'licensed') return s.license_status === 'granted' && Boolean(s.license_blob);
  return s.original_attested;
}

const dm = (s: Source) => `Hi${s.creator ? ` ${s.creator}` : ''}! We loved your video (${s.url}). We're Genovus, a small team that builds marketing tools for local insurance agents, and we're making a comedy series called "Genovus Just Knows." Could we license your clip to open one episode, with full credit and a link to you? Happy to pay a flat fee or make it a collab. Let us know what works for you!`;

export function SourceCard({ s, showEpisode = true }: { s: Source; showEpisode?: boolean }) {
  const ok = cleared(s);
  return (
    <article className="tile" style={{ gap: 10 }}>
      <div className="spread" style={{ gap: 6, flexWrap: 'wrap' }}>
        <span className="row" style={{ gap: 6 }}><Chip kind="info">{ROUTE[s.route] ?? s.route}</Chip><Chip kind={ok ? 'done' : 'pending'}>{ok ? 'Rights cleared' : 'Rights needed'}</Chip></span>
        <a className="muted" style={{ fontSize: 12 }} href={s.url} target="_blank" rel="noreferrer">{PLATFORM[s.platform] ?? s.platform}{s.creator ? ` · ${s.creator}` : ''} ↗</a>
      </div>
      <b style={{ font: '800 16px var(--display)' }}>{s.title}</b>
      {s.notes ? <span className="soft" style={{ fontSize: 13 }}>{s.notes}</span> : null}
      {showEpisode && s.studio_episodes ? <span className="muted" style={{ fontSize: 12 }}>Used in <Link href={`/console/studio/${s.studio_episodes.code}`}>{s.studio_episodes.title}</Link></span> : null}

      {s.route === 'stitch' ? (
        <ActionForm action={studioSourceRights} className="grid" style={{ gap: 6 }}>
          <input type="hidden" name="id" value={s.id} /><input type="hidden" name="remix_set" value="1" />
          <label className="row" style={{ gap: 8, fontSize: 13 }}><input type="checkbox" name="remix" defaultChecked={s.remix_allowed === true} /> I opened the original and its {s.platform === 'tiktok' ? 'Stitch' : 'Remix'} option is available (the creator allows it)</label>
          <button className="btn small" type="submit" style={{ justifySelf: 'start' }}>Save</button>
        </ActionForm>
      ) : null}

      {s.route === 'licensed' ? (
        <div className="grid" style={{ gap: 6 }}>
          <span className="muted" style={{ fontSize: 13 }}>{s.license_status === 'granted' ? 'Permission on file.' : s.license_status === 'requested' ? 'Asked, waiting for their reply.' : 'Not asked yet.'}</span>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <CopyButton text={dm(s)} label="Copy a DM to the creator" />
            {s.license_status === 'none' ? (
              <ActionForm action={studioSourceRights}><input type="hidden" name="id" value={s.id} /><input type="hidden" name="license" value="requested" /><button className="btn small ghost" type="submit">Mark as asked</button></ActionForm>
            ) : null}
            <LicenseUpload sourceId={s.id} />
            {s.license_blob ? <a className="btn small ghost" href={`/api/studio/media/rights/${s.id}`} target="_blank" rel="noreferrer">View permission</a> : null}
          </div>
        </div>
      ) : null}

      {s.route === 'inspired' ? (
        <ActionForm action={studioSourceRights} className="grid" style={{ gap: 6 }}>
          <input type="hidden" name="id" value={s.id} /><input type="hidden" name="attest_set" value="1" />
          <label className="row" style={{ gap: 8, fontSize: 13 }}><input type="checkbox" name="attest" defaultChecked={s.original_attested} /> Ours is original: it copies no real person, character, outfit, choreography or footage from this source</label>
          <button className="btn small" type="submit" style={{ justifySelf: 'start' }}>Save</button>
        </ActionForm>
      ) : null}
    </article>
  );
}
