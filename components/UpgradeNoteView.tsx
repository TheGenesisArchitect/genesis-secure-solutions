// One Upgrade Note in its five parts, as the client sees it (the portal) and as the team previews it (the console).
// Next steps answer with one tap (Done, Help me, Later) when `answer` is on; the check-back shows once it's sent.
import { ActionForm } from './ActionForm';
import { answerUpgradeStep } from '@/lib/upgrade-actions';
import type { Note, CheckBack } from '@/lib/upgrade-notes';

const day = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: iso.length === 10 ? 'UTC' : 'America/New_York' });
const ANSWER: Record<string, string> = { done: 'Done', help: 'Help is on the way', later: 'Saved for later' };

export function UpgradeNoteView({ n, answers, answer, showCheckBack }: { n: Note; answers?: Record<string, string>; answer?: boolean; showCheckBack?: boolean }) {
  const cb = n.check_back as CheckBack | null;
  return (
    <article className="unote" id={n.id}>
      <header className="unote-head">
        <span className="eyebrow">Upgrade · {day(n.sent_at ?? n.created_at)}</span>
        <h3>{n.title}</h3>
        {n.summary ? <p className="soft">{n.summary}</p> : null}
      </header>
      {n.did.length ? <section><h4>What we did</h4><ul>{n.did.map((x, i) => <li key={i}>{x}</li>)}</ul></section> : null}
      {n.background.length ? <section><h4>Working in the background</h4><ul>{n.background.map((x, i) => <li key={i}>{x}</li>)}</ul></section> : null}
      {n.expect.length || n.check_back_on ? (
        <section>
          <h4>What to expect</h4>
          <ol className="unote-track">
            {n.expect.map((e, i) => <li key={i}><b>{e.when}</b><span>{e.what}</span></li>)}
            {n.check_back_on ? <li><b>{day(n.check_back_on)}</b><span>Helix checks back with what has changed.</span></li> : null}
          </ol>
        </section>
      ) : null}
      {n.steps.length ? (
        <section>
          <h4>Your next steps</h4>
          <ul className="unote-steps">
            {n.steps.map((s) => {
              const a = answers?.[s.key];
              return (
                <li key={s.key} data-state={a ?? 'open'}>
                  <span>{s.text}</span>
                  {a ? <span className={'chip ' + (a === 'done' ? 'approved' : 'pending')}>{ANSWER[a]}</span> : null}
                  {answer && a !== 'done' ? (
                    <ActionForm action={answerUpgradeStep} className="row">
                      <input type="hidden" name="note" value={n.id} />
                      <input type="hidden" name="step" value={s.key} />
                      <button className="btn small good" name="status" value="done">Done</button>
                      {a !== 'help' ? <button className="btn small" name="status" value="help">Help me</button> : null}
                      {!a ? <button className="btn small ghost" name="status" value="later">Later</button> : null}
                    </ActionForm>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {n.scales ? <section><h4>How this scales</h4><p className="soft">{n.scales}</p></section> : null}
      {showCheckBack && cb && n.check_back_status === 'sent' ? (
        <section className="unote-cb">
          <h4>Checking back · {day(n.check_back_sent_at ?? cb.written)}</h4>
          <div className="unote-metrics">
            {cb.pages ? <div><b className="num">{cb.pages.indexed} of {cb.pages.total}</b><span>pages in Google</span></div> : null}
            {cb.impressions != null ? <div><b className="num">{cb.impressions.toLocaleString('en-US')}</b><span>times your site showed in searches</span></div> : null}
            <div><b className="num">{cb.leads}</b><span>new leads since {day(cb.since)}</span></div>
          </div>
          <ul>{cb.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </section>
      ) : null}
    </article>
  );
}
