'use client';
// Unedit's front door: one big button. On a phone it opens the camera (record the take), or pick a video already
// shot. The upload (components/studio/upload-recording.ts) goes straight to private storage in parts, with a progress
// ring; the same recording opens the job it already has. Then the card opens and Unedit takes it from there.
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { uploadRecording } from '@/components/studio/upload-recording';

const toast = (r: { ok?: string; err?: string }) => window.dispatchEvent(new CustomEvent('genovus:toast', { detail: { ...r, at: Date.now() } }));

/** The video's frame size, read from its header in the browser (null when the browser can't open it, e.g. HEVC on some
 *  desktops: then the server's probe decides). */
function frameSize(f: File): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    const url = URL.createObjectURL(f);
    const done = (r: { w: number; h: number } | null) => { URL.revokeObjectURL(url); resolve(r); };
    v.preload = 'metadata'; v.muted = true;
    v.onloadedmetadata = () => done(v.videoWidth ? { w: v.videoWidth, h: v.videoHeight } : null);
    v.onerror = () => done(null);
    setTimeout(() => done(null), 6000);
    v.src = url;
  });
}

export function UneditUpload() {
  const router = useRouter();
  const cam = useRef<HTMLInputElement>(null);
  const pick = useRef<HTMLInputElement>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [note, setNote] = useState('');
  // An 8K take: say so before it uploads (it works, but 4K uploads and renders several times faster and looks the same
  // on every platform we post to).
  const [big, setBig] = useState<{ f: File; w: number; h: number } | null>(null);

  const go = async (f: File | undefined, anyway = false) => {
    if (!f) return;
    setBig(null);
    if (!anyway) {
      const d = await frameSize(f);
      if (d && Math.max(d.w, d.h) > 4096) { setBig({ f, ...d }); return; }
    }
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
      {big ? (
        <div className="ue-big" role="alert">
          <b>This take is 8K ({big.w}×{big.h}).</b>
          <span>Unedit can cut it, but 8K uploads about 4× more data and renders several times slower, and every platform we post to shows 1080p or 4K. Next time set the camera to <b>4K (UHD) at 30 fps</b> and turn <b>HDR video off</b> (we convert HDR to standard anyway, which adds time). On Android: Camera app → video mode → the resolution setting (or Settings → Video size) → <b>4K / UHD 30</b>, and switch off <b>10-bit HDR</b> / <b>HDR10+ video</b>. On an iPhone: Settings → Camera → Record Video → <b>4K at 30 fps</b>, and turn off <b>HDR Video</b>.</span>
          <span className="ue-big-row"><button type="button" className="btn primary" onClick={() => go(big.f, true)}>Upload this 8K take anyway</button><button type="button" className="btn ghost" onClick={() => { setBig(null); if (cam.current) cam.current.value = ''; if (pick.current) pick.current.value = ''; }}>Cancel</button></span>
        </div>
      ) : null}
      <h3>Upload a take</h3>
      <p className="muted">{busy ? 'Keep this page open until the upload finishes. A dropped part is retried on its own.' : 'Record with your phone’s camera, or pick a video you already shot. For a teleprompter or a screen recording, use Record. Best: 4K at 30 fps.'}</p>
      {!busy ? <button type="button" className="btn ghost" onClick={() => pick.current?.click()}>Choose a video</button> : null}
    </div>
  );
}
