'use client';
// Unedit's front door: one big button. On a phone it opens the camera (record the take), or pick a video already
// shot. The upload (components/studio/upload-recording.ts) goes straight to private storage in parts, with a progress
// ring; the same recording opens the job it already has. Then the card opens and Unedit takes it from there.
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { uploadRecording } from '@/components/studio/upload-recording';

const toast = (r: { ok?: string; err?: string }) => window.dispatchEvent(new CustomEvent('genovus:toast', { detail: { ...r, at: Date.now() } }));

export function UneditUpload() {
  const router = useRouter();
  const cam = useRef<HTMLInputElement>(null);
  const pick = useRef<HTMLInputElement>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [note, setNote] = useState('');

  const go = async (f: File | undefined) => {
    if (!f) return;
    setPct(0);
    try {
      const r = await uploadRecording(f, (p, n) => { setPct(p); setNote(n); });
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
      <input ref={pick} type="file" accept="video/mp4,video/quicktime,video/x-m4v,video/webm,.mov,.mp4,.m4v,.webm" hidden onChange={(e) => go(e.target.files?.[0])} />
      {busy ? (
        <div className="ue-ring" style={{ ['--p' as string]: pct ?? 0 }} role="progressbar" aria-valuenow={pct ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress">
          <div><b className="num">{pct ?? 0}%</b><span>{note}</span></div>
        </div>
      ) : (
        <button type="button" className="ue-rec" onClick={() => cam.current?.click()} aria-label="Record a video with the phone camera"><i /></button>
      )}
      <h3>Upload a take</h3>
      <p className="muted">{busy ? 'Keep this page open until the upload finishes. A dropped part is retried on its own.' : 'Record with your phone’s camera, or pick a video you already shot. For a teleprompter or a screen recording, use Record. Best: 4K at 30 fps.'}</p>
      {!busy ? <button type="button" className="btn ghost" onClick={() => pick.current?.click()}>Choose a video</button> : null}
    </div>
  );
}
