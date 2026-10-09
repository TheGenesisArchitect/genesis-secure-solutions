'use client';
// Studio generation controls: a shot's takes (generate with Veo, upload a recording, watch, choose), the cast's
// character sheets (generate with Nano Banana Pro, pick the reference), and the final-cut upload. Results come
// back through polling; the page refreshes itself when something finishes.
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { upload } from '@vercel/blob/client';
import { studioChooseTake, studioSetCanonical, studioRegisterUpload, studioChooseArt, studioRegisterLicense, studioApproveRef, type ActionResult } from '@/lib/actions';

const toast = (r: ActionResult) => { if (r) window.dispatchEvent(new CustomEvent('genovus:toast', { detail: r })); };
const ok = (msg: string) => toast({ ok: msg, at: Date.now() });
const err = (msg: string) => toast({ err: msg, at: Date.now() });

export type Take = { id: string; kind: string; status: string; chosen: boolean; error: string | null; cost_cents: number; created_at: string; params?: { method?: string; cast?: string[] } | null };
export type Ref = { id: string; character: string; status: string; canonical: boolean; error: string | null; created_at: string };

async function sha256(file: File): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Poll running items until they settle, then refresh the page's server data. */
function usePolling(ids: string[]) {
  const router = useRouter();
  const key = ids.join(',');
  useEffect(() => {
    if (!key) return;
    let stop = false;
    const tick = async () => {
      let changed = false;
      for (const id of key.split(',')) {
        const r = await fetch(`/api/studio/takes/${id}/poll`, { method: 'POST' }).then((x) => x.json()).catch(() => null);
        if (r && r.status !== 'running' && r.status !== 'queued') changed = true;
        if (r?.status === 'failed' && r.error) err(`Take failed: ${r.error}`);
      }
      if (changed) router.refresh();
      if (!stop) setTimeout(tick, 8000);
    };
    const t = setTimeout(tick, 6000);
    return () => { stop = true; clearTimeout(t); };
  }, [key, router]);
}

function Choose({ id, label = 'Use this take' }: { id: string; label?: string }) {
  const router = useRouter();
  return (
    <button className="btn small primary" type="button" onClick={async () => {
      const f = new FormData(); f.set('id', id);
      const r = await studioChooseTake(null, f); toast(r); router.refresh();
    }}>{label}</button>
  );
}

export function ShotTakes({ shotId, tool, prompt, takes, costLabel }: { shotId: string; tool: string; prompt: string; takes: Take[]; costLabel: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState(prompt);
  const [edit, setEdit] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  usePolling(takes.filter((t) => t.status === 'running' || t.status === 'queued').map((t) => t.id));

  const generate = async () => {
    setBusy(true);
    const r = await fetch('/api/studio/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'video', shot: shotId, prompt: text }) }).then(async (x) => ({ okay: x.ok, j: await x.json().catch(() => ({})) }));
    setBusy(false);
    if (r.okay) ok(`Generating… usually 1–3 minutes${r.j.refs ? ` (with ${r.j.refs} character reference${r.j.refs > 1 ? 's' : ''})` : ''}.`); else err(r.j.error ?? 'Could not start.');
    router.refresh();
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const blob = await upload(`studio/uploads/${shotId}/${f.name.replace(/[^A-Za-z0-9._-]+/g, '-')}`, f, { access: 'private', handleUploadUrl: '/api/studio/upload', contentType: f.type || 'video/mp4' });
      toast(await studioRegisterUpload('take', shotId, blob.pathname, ''));
    } catch (e) { err(e instanceof Error ? e.message : 'Upload failed.'); }
    setBusy(false);
    if (file.current) file.current.value = '';
    router.refresh();
  };

  return (
    <div className="take-box">
      {takes.length ? (
        <div className="take-strip">
          {takes.map((t, i) => (
            <figure key={t.id} className={'take' + (t.chosen ? ' chosen' : '')}>
              {t.status === 'ready' ? <video src={`/api/studio/media/take/${t.id}`} controls playsInline preload="metadata" /> : (
                <div className="take-wait">{t.status === 'failed' ? <span>✕ {t.error ?? 'Failed'}</span> : <><span className="take-spin" />Generating…</>}</div>
              )}
              <figcaption>
                <span className="muted">Take {takes.length - i}{t.kind === 'upload' ? ' · uploaded' : t.cost_cents ? ` · $${(t.cost_cents / 100).toFixed(2)}` : ''}</span>
                {t.status === 'ready' ? (t.chosen ? <b className="take-chosen">✓ In the edit</b> : <Choose id={t.id} />) : null}
                {t.status === 'ready' ? <a className="btn small ghost" href={`/api/studio/media/take/${t.id}?download=1`}>Download</a> : null}
              </figcaption>
              {t.params?.cast?.length ? <span className={'take-cast' + (t.params.method === 'prompt' ? ' off' : '')} title={t.params.cast.join(', ')}>Cast via {t.params.method === 'keyframe' ? 'keyframe' : t.params.method === 'references' ? 'references' : 'prompt only'}</span> : null}
              {t.error && t.status === 'ready' ? <span className="muted" style={{ fontSize: 11 }}>{t.error}</span> : null}
            </figure>
          ))}
        </div>
      ) : null}
      {tool === 'capture' ? (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input ref={file} type="file" accept="video/mp4,video/quicktime,video/webm" hidden onChange={(e) => onFile(e.target.files?.[0])} />
          <button className="btn small primary" type="button" disabled={busy} onClick={() => file.current?.click()}>{busy ? 'Uploading…' : 'Upload recording'}</button>
          <a className="btn small" href="/app/demo-brooks/follow-ups?film=1" target="_blank" rel="noreferrer">Open the filming page</a>
          <span className="muted" style={{ fontSize: 12 }}>Reset demo follow-ups on the Studio home first, record on your phone, then upload it here.</span>
        </div>
      ) : tool === 'flow' || tool === 'veo' ? (
        <div className="grid" style={{ gap: 6 }}>
          {edit ? <textarea className="input" rows={5} value={text} onChange={(e) => setText(e.target.value)} aria-label="Prompt for this take" /> : null}
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button className="btn small primary" type="button" disabled={busy || text.trim().length < 10} onClick={generate}>{busy ? 'Starting…' : `Generate take · ${costLabel}`}</button>
            <button className="btn small ghost" type="button" onClick={() => setEdit(!edit)}>{edit ? 'Hide prompt' : 'Edit prompt'}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function CastSheets({ seriesId, character, prompt, refs, costLabel }: { seriesId: string; character: string; prompt: string; refs: Ref[]; costLabel: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const generate = async () => {
    setBusy(true);
    ok(`Drawing ${character}’s sheet… about 20–40 seconds.`);
    const r = await fetch('/api/studio/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'ref', series: seriesId, character, prompt }) }).then(async (x) => ({ okay: x.ok, j: await x.json().catch(() => ({})) }));
    setBusy(false);
    if (r.okay) ok(`${character}’s sheet is ready.`); else err(r.j.error ?? 'Could not generate.');
    router.refresh();
  };
  return (
    <div className="grid" style={{ gap: 8 }}>
      {refs.length ? (
        <div className="take-strip">
          {refs.map((r) => (
            <figure key={r.id} className={'take sheet' + (r.canonical ? ' chosen' : '')}>
              {r.status === 'ready' ? <a href={`/api/studio/media/ref/${r.id}`} target="_blank" rel="noreferrer"><img src={`/api/studio/media/ref/${r.id}`} alt={`${character} reference sheet`} /></a> : <div className="take-wait">{r.status === 'failed' ? <span>✕ {r.error ?? 'Failed'}</span> : <><span className="take-spin" />Drawing…</>}</div>}
              <figcaption>
                {r.status === 'ready' ? (r.canonical ? <b className="take-chosen">✓ Reference</b> : (
                  <button className="btn small" type="button" onClick={async () => { const f = new FormData(); f.set('id', r.id); toast(await studioSetCanonical(null, f)); router.refresh(); }}>Make reference</button>
                )) : null}
              </figcaption>
            </figure>
          ))}
        </div>
      ) : null}
      <button className="btn small primary" type="button" disabled={busy} onClick={generate} style={{ justifySelf: 'start' }}>{busy ? 'Drawing…' : `${refs.length ? 'New sheet' : 'Generate sheet'} · ${costLabel}`}</button>
    </div>
  );
}

export function FinalUpload({ episodeId, hasFinal }: { episodeId: string; hasFinal: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      setBusy('Fingerprinting…');
      const sha = await sha256(f);
      setBusy('Uploading…');
      const blob = await upload(`studio/finals/${episodeId}/${f.name.replace(/[^A-Za-z0-9._-]+/g, '-')}`, f, { access: 'private', handleUploadUrl: '/api/studio/upload', contentType: f.type || 'video/mp4' });
      toast(await studioRegisterUpload('final', episodeId, blob.pathname, sha));
    } catch (e) { err(e instanceof Error ? e.message : 'Upload failed.'); }
    setBusy('');
    if (file.current) file.current.value = '';
    router.refresh();
  };
  return (
    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
      <input ref={file} type="file" accept="video/mp4,video/quicktime,video/webm" hidden onChange={(e) => onFile(e.target.files?.[0])} />
      <button className="btn small primary" type="button" disabled={!!busy} onClick={() => file.current?.click()}>{busy || (hasFinal ? 'Upload a new cut' : 'Upload the final cut')}</button>
    </div>
  );
}

export type Art = { id: string; status: string; chosen: boolean; error: string | null; created_at: string };

export function Thumbnails({ episodeId, defaultPrompt, art, costLabel }: { episodeId: string; defaultPrompt: string; art: Art[]; costLabel: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState(defaultPrompt);
  const [edit, setEdit] = useState(false);
  const generate = async () => {
    setBusy(true);
    ok('Making key art… about 20–40 seconds.');
    const r = await fetch('/api/studio/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'thumb', episode: episodeId, prompt: text }) }).then(async (x) => ({ okay: x.ok, j: await x.json().catch(() => ({})) }));
    setBusy(false);
    if (r.okay) ok(`Thumbnail ready${r.j.refs ? ` (cast references: ${r.j.refs})` : ''}.`); else err(r.j.error ?? 'Could not generate.');
    router.refresh();
  };
  return (
    <div className="grid" style={{ gap: 10 }}>
      {art.length ? (
        <div className="take-strip">
          {art.map((a) => (
            <figure key={a.id} className={'take poster' + (a.chosen ? ' chosen' : '')}>
              {a.status === 'ready' ? <a href={`/api/studio/thumb/${a.id}`} target="_blank" rel="noreferrer"><img src={`/api/studio/thumb/${a.id}`} alt="Thumbnail" loading="lazy" /></a> : <div className="take-wait">{a.status === 'failed' ? <span>✕ {a.error ?? 'Failed'}</span> : <><span className="take-spin" />Drawing…</>}</div>}
              {a.status === 'ready' ? (
                <figcaption>
                  {a.chosen ? <b className="take-chosen">✓ Episode thumbnail</b> : (
                    <button className="btn small" type="button" onClick={async () => { const f = new FormData(); f.set('id', a.id); toast(await studioChooseArt(null, f)); router.refresh(); }}>Use for posts</button>
                  )}
                  <span className="row" style={{ gap: 4 }}>
                    <a className="btn small ghost" href={`/api/studio/thumb/${a.id}?download=1`}>9:16</a>
                    <a className="btn small ghost" href={`/api/studio/thumb/${a.id}?size=1x1&download=1`}>1:1</a>
                  </span>
                </figcaption>
              ) : null}
            </figure>
          ))}
        </div>
      ) : null}
      {edit ? <textarea className="input" rows={4} value={text} onChange={(e) => setText(e.target.value)} aria-label="Thumbnail prompt" /> : null}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button className="btn small primary" type="button" disabled={busy || text.trim().length < 10} onClick={generate}>{busy ? 'Drawing…' : `Generate thumbnail · ${costLabel}`}</button>
        <button className="btn small ghost" type="button" onClick={() => setEdit(!edit)}>{edit ? 'Hide prompt' : 'Edit prompt'}</button>
      </div>
    </div>
  );
}

/** Upload a creator's written permission (PDF or screenshot) for a licensed source. */
export function LicenseUpload({ sourceId }: { sourceId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const blob = await upload(`studio/rights/${sourceId}/${f.name.replace(/[^A-Za-z0-9._-]+/g, '-')}`, f, { access: 'private', handleUploadUrl: '/api/studio/upload', contentType: f.type || 'application/pdf' });
      toast(await studioRegisterLicense(sourceId, blob.pathname));
    } catch (e) { err(e instanceof Error ? e.message : 'Upload failed.'); }
    setBusy(false);
    if (file.current) file.current.value = '';
    router.refresh();
  };
  return (
    <>
      <input ref={file} type="file" accept="application/pdf,image/png,image/jpeg" hidden onChange={(e) => onFile(e.target.files?.[0])} />
      <button className="btn small" type="button" disabled={busy} onClick={() => file.current?.click()}>{busy ? 'Uploading…' : 'Upload their written permission'}</button>
    </>
  );
}

export type SlotRef = { id: string; status: string; approved: boolean; error: string | null; asset_code: string | null; version: number | null };

/** One identity slot: its versions, generate, approve. Locked until the character's front portrait is approved. */
export function IdentitySlot({ target, label, slot, refs, locked, costLabel }: { target: { character?: string; series?: string }; label: string; slot: string; refs: SlotRef[]; locked?: string; costLabel: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const approvedRef = refs.find((r) => r.approved && r.status === 'ready');
  const generate = async () => {
    setBusy(true);
    ok(`Generating ${label}… about 20–40 seconds.`);
    const r = await fetch('/api/studio/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'identity', slot, ...target }) }).then(async (x) => ({ okay: x.ok, j: await x.json().catch(() => ({})) }));
    setBusy(false);
    if (r.okay) ok(`${label} ready. Approve it if it matches the bible.`); else err(r.j.error ?? 'Could not generate.');
    router.refresh();
  };
  const approve = async (id: string) => { const f = new FormData(); f.set('id', id); toast(await studioApproveRef(null, f)); router.refresh(); };
  return (
    <div className={'id-slot' + (approvedRef ? ' done' : '')}>
      <div className="spread" style={{ gap: 6 }}>
        <b style={{ fontSize: 13 }}>{label}</b>
        {approvedRef ? <span className="take-chosen">✓ {approvedRef.asset_code}</span> : <span className="muted" style={{ fontSize: 11 }}>{slot}</span>}
      </div>
      {refs.length ? (
        <div className="id-versions">
          {refs.map((r) => (
            <figure key={r.id} className={'id-ver' + (r.approved ? ' chosen' : '')}>
              {r.status === 'ready' ? <a href={`/api/studio/media/ref/${r.id}`} target="_blank" rel="noreferrer"><img src={`/api/studio/media/ref/${r.id}`} alt={r.asset_code ?? label} loading="lazy" /></a>
                : <div className="take-wait">{r.status === 'failed' ? <span>✕ {r.error ?? 'Failed'}</span> : <><span className="take-spin" />Drawing…</>}</div>}
              <figcaption>
                <span className="muted">v{String(r.version ?? 1).padStart(2, '0')}</span>
                {r.status === 'ready' && !r.approved ? <button className="btn small" type="button" onClick={() => approve(r.id)}>Approve</button> : null}
              </figcaption>
            </figure>
          ))}
        </div>
      ) : null}
      {locked ? <span className="muted" style={{ fontSize: 11 }}>{locked}</span> : (
        <button className="btn small primary" type="button" disabled={busy} onClick={generate}>{busy ? 'Drawing…' : `${refs.length ? 'New version' : 'Generate'} · ${costLabel}`}</button>
      )}
    </div>
  );
}
