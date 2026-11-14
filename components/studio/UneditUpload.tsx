'use client';
// Unedit's front door: one big button. On a phone it opens the camera (record the take), or pick a video already
// shot. The file goes straight to private storage in parts (multipart: a failed part is retried), with a progress
// ring. Before uploading, its fingerprint (size + first and last 4 MB) is checked, so the same recording opens the
// job it already has instead of uploading again. Then the card opens and Unedit takes it from there.
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { upload } from '@vercel/blob/client';

const toast = (r: { ok?: string; err?: string }) => window.dispatchEvent(new CustomEvent('genovus:toast', { detail: { ...r, at: Date.now() } }));
const CHUNK = 4 * 1024 * 1024;
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

async function fingerprint(f: File): Promise<string> {
  const head = await crypto.subtle.digest('SHA-256', await f.slice(0, CHUNK).arrayBuffer());
  const tail = await crypto.subtle.digest('SHA-256', await f.slice(Math.max(0, f.size - CHUNK)).arrayBuffer());
  return `${f.size}:${hex(head)}:${hex(tail)}`;
}

async function call(body: Record<string, unknown>) {
  const r = await fetch('/api/studio/unedit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; id?: string; say?: string; error?: string; existing?: boolean };
  if (!r.ok || !j.ok) throw new Error(j.error || 'That didn’t work.');
  return j;
}

export function UneditUpload() {
  const router = useRouter();
  const cam = useRef<HTMLInputElement>(null);
  const pick = useRef<HTMLInputElement>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [note, setNote] = useState('');

  const go = async (f: File | undefined) => {
    if (!f) return;
    if (!/^video\//.test(f.type) && !/\.(mp4|mov|m4v|webm)$/i.test(f.name)) { toast({ err: 'Pick a video file.' }); return; }
    if (f.size > 4096 * 1024 * 1024) { toast({ err: 'Unedit takes recordings up to 4 GB.' }); return; }
    setPct(0);
    try {
      setNote('Checking the file…');
      const fp = await fingerprint(f);
      const seen = await call({ tool: 'lookup', fingerprint: fp });
      if (seen.id) { toast({ ok: 'You already uploaded this recording; here it is.' }); router.push(`/console/studio/unedit/${seen.id}`); return; }
      setNote('Uploading…');
      const ext = (f.name.match(/\.(mp4|mov|m4v|webm)$/i)?.[1] ?? (f.type.includes('quicktime') ? 'mov' : 'mp4')).toLowerCase();
      const base = f.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'recording';
      const blob = await upload(`studio/vlogs/uploads/${base}.${ext}`, f, {
        access: 'private', handleUploadUrl: '/api/studio/upload', multipart: true, contentType: f.type || 'video/mp4',
        onUploadProgress: (e) => setPct(Math.round(e.percentage)),
      });
      setNote('Starting…');
      const r = await call({ tool: 'register', blobPath: blob.pathname, blobUrl: blob.url, bytes: f.size, fingerprint: fp, fileName: f.name });
      toast({ ok: r.say ?? 'Uploaded.' });
      router.push(`/console/studio/unedit/${r.id}`);
    } catch (e) {
      toast({ err: e instanceof Error ? e.message : 'Upload failed.' });
      setPct(null);
      setNote('');
    }
    if (cam.current) cam.current.value = '';
    if (pick.current) pick.current.value = '';
  };

  const busy = pct !== null;
  return (
    <div className="ue-door">
      <input ref={cam} type="file" accept="video/*" capture="user" hidden onChange={(e) => go(e.target.files?.[0])} />
      <input ref={pick} type="file" accept="video/mp4,video/quicktime,video/x-m4v,video/webm,.mov,.mp4,.m4v" hidden onChange={(e) => go(e.target.files?.[0])} />
      {busy ? (
        <div className="ue-ring" style={{ ['--p' as string]: pct ?? 0 }} role="progressbar" aria-valuenow={pct ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress">
          <div><b className="num">{pct ?? 0}%</b><span>{note}</span></div>
        </div>
      ) : (
        <button type="button" className="ue-rec" onClick={() => cam.current?.click()} aria-label="Record a video"><i /></button>
      )}
      <h3>Unedit</h3>
      <p className="muted">{busy ? 'Keep this page open until the upload finishes. A dropped part is retried on its own.' : 'One take, start to finish. Record it here, or pick a video you already shot. Genovus handles everything after you stop. Best: 4K at 30 fps (as sharp as the finished episode, and faster to finish than 8K).'}</p>
      {!busy ? <button type="button" className="btn ghost" onClick={() => pick.current?.click()}>Choose a video</button> : null}
    </div>
  );
}
