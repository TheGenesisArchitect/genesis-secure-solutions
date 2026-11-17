'use client';
// One way into Unedit for every recording, picked or recorded in the browser: fingerprint it (size + first and last
// 4 MB, so the same take opens the job it already has), upload it straight to private storage in parts, register it.
import { upload } from '@vercel/blob/client';

const CHUNK = 4 * 1024 * 1024;
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

async function fingerprint(f: Blob): Promise<string> {
  const head = await crypto.subtle.digest('SHA-256', await f.slice(0, CHUNK).arrayBuffer());
  const tail = await crypto.subtle.digest('SHA-256', await f.slice(Math.max(0, f.size - CHUNK)).arrayBuffer());
  return `${f.size}:${hex(head)}:${hex(tail)}`;
}

export async function unedit(body: Record<string, unknown>) {
  const r = await fetch('/api/studio/unedit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, desk: typeof location !== 'undefined' ? new URLSearchParams(location.search).get('desk') ?? undefined : undefined }) });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; id?: string; say?: string; error?: string; existing?: boolean };
  if (!r.ok || !j.ok) throw new Error(j.error || 'That didn’t work.');
  return j;
}

/** Upload and register a recording. Returns the recording's id (an earlier upload of the same file: that one). */
export async function uploadRecording(f: File, onProgress: (pct: number, note: string) => void): Promise<{ id: string; existing: boolean; say?: string }> {
  if (!/^video\//.test(f.type) && !/\.(mp4|mov|m4v|webm|3gp)$/i.test(f.name)) throw new Error('Pick a video file.');
  if (f.size > 4096 * 1024 * 1024) throw new Error('Unedit takes recordings up to 4 GB.');
  onProgress(0, 'Checking the file…');
  const fp = await fingerprint(f);
  const seen = await unedit({ tool: 'lookup', fingerprint: fp });
  if (seen.id) return { id: seen.id, existing: true, say: 'You already uploaded this recording; here it is.' };
  onProgress(0, 'Uploading…');
  const ext = (f.name.match(/\.(mp4|mov|m4v|webm)$/i)?.[1] ?? (f.type.includes('quicktime') ? 'mov' : f.type.includes('webm') ? 'webm' : 'mp4')).toLowerCase();
  // Storage accepts exactly these types. A browser recording is labelled with its codecs ("video/mp4;codecs=avc1…"),
  // and some phones label takes oddly (video/3gpp, empty): either one was refused as "Content type mismatch"
  // (2026-11-15), so the label comes from the extension unless it is already one of the four.
  const plain = (f.type || '').split(';')[0].trim().toLowerCase();
  const contentType = ['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/webm'].includes(plain) ? plain : ({ mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/x-m4v' } as Record<string, string>)[ext] ?? 'video/mp4';
  const base = f.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'recording';
  const blob = await upload(`studio/vlogs/uploads/${base}.${ext}`, f, {
    access: 'private', handleUploadUrl: '/api/studio/upload', multipart: true, contentType,
    onUploadProgress: (e) => onProgress(Math.round(e.percentage), 'Uploading…'),
  });
  onProgress(100, 'Starting…');
  const r = await unedit({ tool: 'register', blobPath: blob.pathname, blobUrl: blob.url, bytes: f.size, fingerprint: fp, fileName: f.name });
  return { id: r.id!, existing: Boolean(r.existing), say: r.say };
}
