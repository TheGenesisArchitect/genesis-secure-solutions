// Upgrade notes for one client (lib/upgrade-notes.ts): tell Helix what shipped, edit its draft, queue it, and send it
// with one tap (the approval). Sent notes show who has read them and how the client answered each step; check-backs
// are written on their date (or now) with real numbers and sent the same way. Search Console is connected here too.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConsoleShell } from '@/components/ConsoleShell';
import { ActionForm } from '@/components/ActionForm';
import { Panel, Chip, Empty, Tile, dateTime } from '@/components/ui';
import { UpgradeNoteView } from '@/components/UpgradeNoteView';
import { db } from '@/lib/supabase/server';
import { adminDb } from '@/lib/supabase/admin';
import { decideApproval } from '@/lib/actions';
import { NOTE_COLS, noteWarnings, type Note, type CheckBack } from '@/lib/upgrade-notes';
import { draftUpgradeNote, saveUpgradeNote, queueUpgradeNote, deleteUpgradeNote, queueCheckBack, saveSearchConsole, pullSearchNow } from '@/lib/upgrade-actions';
import { searchNow, searchConsoleConfigured, searchConsoleUser } from '@/lib/search-console';

export const metadata = { title: 'Upgrade notes' };
export const dynamic = 'force-dynamic';

const STATUS: Record<string, [string, string]> = { draft: ['in_review', 'Draft'], queued: ['pending', 'Waiting on Send'], sent: ['approved', 'Sent'] };
const fmt = (n: number | null) => (n == null ? '—' : n.toLocaleString('en-US'));

export default async function ClientUpgrades({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await db();
  const { data: t } = await supabase.from('tenants').select('id, name, kind, search_console_site').eq('slug', slug).maybeSingle();
  if (!t || t.kind !== 'agency') notFound();
  const [{ data: rows }, { data: approvals }, search] = await Promise.all([
    supabase.from('upgrade_notes').select(NOTE_COLS).eq('tenant_id', t.id).order('created_at', { ascending: false }).limit(40),
    supabase.from('approvals').select('id, body').eq('tenant_id', t.id).eq('status', 'pending').in('body->>action', ['send_upgrade_note', 'send_checkback']),
    searchNow(supabase, t.id),
  ]);
  const notes = (rows ?? []) as unknown as Note[];
  const ids = notes.map((n) => n.id);
  const [{ data: reads }, { data: answers }, { data: members }] = ids.length
    ? await Promise.all([
      supabase.from('upgrade_note_reads').select('note_id, user_id, read_at').in('note_id', ids),
      supabase.from('upgrade_note_steps').select('note_id, step_key, status').in('note_id', ids),
      supabase.from('memberships').select('user_id').eq('tenant_id', t.id),
    ])
    : [{ data: [] }, { data: [] }, { data: [] }];
  // Readers by email (staff view; the admin client reads auth emails).
  const admin = adminDb();
  const emails = new Map<string, string>();
  for (const r of reads ?? []) if (!emails.has(r.user_id)) emails.set(r.user_id, (await admin.auth.admin.getUserById(r.user_id)).data.user?.email ?? 'a team member');
  const approvalFor = (id: string, action: string) => (approvals ?? []).find((a) => (a.body as { note?: string; action?: string }).note === id && (a.body as { action?: string }).action === action);
  const sendForm = (approvalId: string, label: string) => (
    <ActionForm action={decideApproval} className="row" lane="outward">
      <input type="hidden" name="id" value={approvalId} />
      <button className="btn primary small" name="decision" value="approved">{label}</button>
      <input className="input" name="note" placeholder="Note (to send back for changes)" style={{ flex: 1, minWidth: 180 }} />
      <button className="btn small" name="decision" value="changes_requested">Back to edit</button>
    </ActionForm>
  );
  return (
    <ConsoleShell title="Upgrade notes" crumbs={[{ href: '/console', label: 'Enterprise' }, { href: '/console/clients', label: 'Clients' }, { href: `/console/clients/${slug}`, label: t.name }, { label: 'Upgrade notes' }]}
      actions={<Link className="btn small" href={`/app/${slug}/upgrades`}>See it as the agency</Link>}>
      <p className="soft" style={{ margin: 0, maxWidth: '70ch' }}>One short note per upgrade, in five parts: what we did, what runs in the background, what to expect and when, their next steps, how it scales. Plain words only. Nothing reaches {t.name} until you tap Send.</p>

      <Panel title="Tell Helix what shipped" sub="Paste the change in your own words or the commit summary. Helix writes the client’s version; you edit it before anything goes out.">
        <ActionForm action={draftUpgradeNote} resetOnOk style={{ display: 'grid', gap: 10 }}>
          <input type="hidden" name="tenant" value={t.id} />
          <textarea className="input" name="shipped" rows={5} required minLength={20} placeholder="e.g. Added Auto and Home pages; Google now reads hours, the Google listing and the five lines from the site; share cards per page; hours match the GEICO profile (M–F 9–5, Sat 9–1)…" />
          <div className="row"><button className="btn primary">Draft with Helix</button><span className="muted" style={{ fontSize: 13 }}>Takes about 15 seconds.</span></div>
        </ActionForm>
      </Panel>

      {notes.length ? notes.map((n) => {
        const [kind, label] = STATUS[n.status];
        const warn = noteWarnings(n);
        const ans = Object.fromEntries((answers ?? []).filter((a) => a.note_id === n.id).map((a) => [a.step_key as string, a.status as string]));
        const readBy = (reads ?? []).filter((r) => r.note_id === n.id);
        const pendingSend = approvalFor(n.id, 'send_upgrade_note');
        const pendingCb = approvalFor(n.id, 'send_checkback');
        const cb = n.check_back as CheckBack | null;
        return (
          <Panel key={n.id} id={n.id} title={n.title} sub={n.sent_at ? `Sent ${dateTime(n.sent_at)}` : `Drafted ${dateTime(n.created_at)}`} actions={<Chip kind={kind}>{label}</Chip>}>
            {warn.length ? <ul className="notice err" style={{ margin: 0, paddingLeft: 28 }}>{warn.map((w) => <li key={w}>{w}</li>)}</ul> : null}
            {n.status === 'draft' ? (
              <>
                <ActionForm action={saveUpgradeNote} style={{ display: 'grid', gap: 10 }}>
                  <input type="hidden" name="id" value={n.id} />
                  <label className="field"><span>Title (the client’s benefit)</span><input className="input" name="title" defaultValue={n.title} maxLength={110} required /></label>
                  <label className="field"><span>What Helix says when they sign in (one or two sentences)</span><textarea className="input" name="summary" rows={2} defaultValue={n.summary} maxLength={400} /></label>
                  <div className="grid g2">
                    <label className="field"><span>What we did (one per line)</span><textarea className="input" name="did" rows={6} defaultValue={n.did.join('\n')} /></label>
                    <label className="field"><span>Working in the background (one per line)</span><textarea className="input" name="background" rows={6} defaultValue={n.background.join('\n')} /></label>
                    <label className="field"><span>What to expect (when | what, one per line)</span><textarea className="input" name="expect" rows={5} defaultValue={n.expect.map((e) => `${e.when} | ${e.what}`).join('\n')} /></label>
                    <label className="field"><span>Their next steps (up to 3, one per line)</span><textarea className="input" name="steps" rows={5} defaultValue={n.steps.map((s) => s.text).join('\n')} /></label>
                  </div>
                  <label className="field"><span>How this scales</span><textarea className="input" name="scales" rows={2} defaultValue={n.scales} maxLength={600} /></label>
                  <label className="field" style={{ maxWidth: 260 }}><span>Helix checks back on</span><input className="input" type="date" name="check_back_on" defaultValue={n.check_back_on ?? ''} /></label>
                  <div className="row"><button className="btn small">Save</button></div>
                </ActionForm>
                <div className="row">
                  <ActionForm action={queueUpgradeNote}><input type="hidden" name="id" value={n.id} /><button className="btn primary small">Queue to send</button></ActionForm>
                  <ActionForm action={deleteUpgradeNote} confirm="Delete this draft?"><input type="hidden" name="id" value={n.id} /><button className="btn ghost small">Delete draft</button></ActionForm>
                </div>
                <details><summary className="muted">Preview as the client sees it</summary><div style={{ paddingTop: 12 }}><UpgradeNoteView n={n} /></div></details>
              </>
            ) : (
              <>
                {n.status === 'queued' ? (pendingSend ? sendForm(pendingSend.id, `Send to ${t.name}`) : <p className="soft">Waiting on its approval in <Link href="/console/approvals">Approvals</Link>.</p>) : null}
                <UpgradeNoteView n={n} answers={ans} showCheckBack />
                {n.status === 'sent' ? (
                  <div className="grid g2">
                    <div style={{ display: 'grid', gap: 6 }}>
                      <b>Read by</b>
                      {readBy.length ? <ul className="list">{readBy.map((r) => <li key={r.user_id}>{emails.get(r.user_id)} · {dateTime(r.read_at)}</li>)}</ul> : <p className="soft">Nobody at the agency has opened it yet ({(members ?? []).length} {(members ?? []).length === 1 ? 'person' : 'people'} on their dashboard).</p>}
                    </div>
                    <div style={{ display: 'grid', gap: 6 }}>
                      <b>Check-back</b>
                      {n.check_back_status === 'sent' ? <p className="soft">Sent {n.check_back_sent_at ? dateTime(n.check_back_sent_at) : ''}.</p>
                        : n.check_back_status === 'queued' && cb ? (
                          <>
                            <ul className="list">{cb.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
                            {pendingCb ? sendForm(pendingCb.id, 'Send the check-back') : null}
                          </>
                        ) : (
                          <>
                            <p className="soft">{n.check_back_on ? `Helix writes it on ${n.check_back_on} with the real numbers, then it waits on your Send.` : 'No check-back date set.'}</p>
                            <ActionForm action={queueCheckBack}><input type="hidden" name="id" value={n.id} /><button className="btn small">Write it now with today’s numbers</button></ActionForm>
                          </>
                        )}
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </Panel>
        );
      }) : <Empty title="No upgrade notes yet">Tell Helix what shipped above. The first one for {t.name} can be the work you just finished.</Empty>}

      <Panel id="search-console" title="Google Search Console" sub="Gives Visibility, Helix and every check-back real Google numbers: searches, clicks and pages in Google.">
        {!searchConsoleConfigured() ? (
          <p className="notice err" style={{ margin: 0 }}>Genovus’s Search Console key isn’t set yet. Add the service account’s JSON key as GSC_SERVICE_ACCOUNT in Vercel (Production), then redeploy.</p>
        ) : (
          <p className="soft" style={{ margin: 0 }}>In the client’s Search Console: Settings → Users and permissions → Add user → <code style={{ userSelect: 'all' }}>{searchConsoleUser()}</code> with <b>Restricted</b> permission. Then save the property here.</p>
        )}
        <ActionForm action={saveSearchConsole} className="row">
          <input type="hidden" name="tenant" value={t.id} />
          <input className="input" name="property" defaultValue={t.search_console_site ?? ''} placeholder="sc-domain:example.com or https://example.com/" style={{ flex: 1, minWidth: 240 }} />
          <button className="btn small">Save</button>
        </ActionForm>
        {t.search_console_site ? (
          <>
            <div className="grid g4">
              <Tile label="Shown in searches" value={<span className="num">{fmt(search.impressions.now)}</span>} hint="Last 28 days with data" />
              <Tile label="Clicks" value={<span className="num">{fmt(search.clicks.now)}</span>} hint="Last 28 days with data" />
              <Tile label="Pages in Google" value={<span className="num">{search.pages ? `${search.pages.indexed} of ${search.pages.total}` : '—'}</span>} hint="From the site’s sitemap" />
              <Tile label="Last pull" value={search.pulledAt ? dateTime(search.pulledAt) : '—'} hint={search.error ?? 'Once a day'} />
            </div>
            <ActionForm action={pullSearchNow}><input type="hidden" name="tenant" value={t.id} /><button className="btn small">Pull now</button></ActionForm>
          </>
        ) : null}
      </Panel>
    </ConsoleShell>
  );
}
