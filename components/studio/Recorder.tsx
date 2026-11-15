'use client';
// The Record tab: record a take in the browser and send it straight into Unedit.
//   camera   your camera, a teleprompter scrolling over the top third (speed and size adjustable), a 3-2-1 count-in
//   screen   your screen (any tab, window or display) with your camera in a round bubble, composited on a 1920x1080
//            canvas and recorded with your mic; the talking points stay beside it, off the recording
// A mic meter, a running clock, a screen wake lock while recording, then a preview: use this take or record again.
// Recording against a Newsroom package hands its sources sheet to the new recording.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { uploadRecording } from '@/components/studio/upload-recording';

export type Script = { id: string; title: string; angle: string; text: string; points: string[] };
type Mode = 'camera' | 'screen';
type Phase = 'setup' | 'count' | 'rec' | 'review' | 'upload';

const toast = (r: { ok?: string; err?: string }) => window.dispatchEvent(new CustomEvent('genovus:toast', { detail: { ...r, at: Date.now() } }));
const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const MIMES = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
const pickMime = () => (typeof MediaRecorder === 'undefined' ? '' : MIMES.find((m) => MediaRecorder.isTypeSupported(m)) ?? '');

export function Recorder({ scripts, initial }: { scripts: Script[]; initial: string | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('camera');
  const [scriptId, setScriptId] = useState<string | null>(initial);
  const [phase, setPhase] = useState<Phase>('setup');
  const [count, setCount] = useState(3);
  const [secs, setSecs] = useState(0);
  const [level, setLevel] = useState(0);
  const [wpm, setWpm] = useState(150);
  const [size, setSize] = useState(34);
  const [rolling, setRolling] = useState(true);
  const [take, setTake] = useState<{ url: string; file: File } | null>(null);
  const [pct, setPct] = useState(0);
  const [note, setNote] = useState('');
  const [canScreen, setCanScreen] = useState(false);
  const [error, setError] = useState('');
  const script = scripts.find((s) => s.id === scriptId) ?? null;

  const camVideo = useRef<HTMLVideoElement>(null);
  const screenVideo = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const prompter = useRef<HTMLDivElement>(null);
  const cam = useRef<MediaStream | null>(null);
  const scr = useRef<MediaStream | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const raf = useRef<number>(0);
  const wake = useRef<{ release: () => Promise<void> } | null>(null);
  const audio = useRef<AudioContext | null>(null);

  useEffect(() => { setCanScreen(Boolean(navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices) && !/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)); }, []);

  const stopAll = useCallback(() => {
    cancelAnimationFrame(raf.current);
    for (const s of [cam.current, scr.current]) s?.getTracks().forEach((t) => t.stop());
    cam.current = null; scr.current = null;
    audio.current?.close().catch(() => {}); audio.current = null;
  }, []);
  useEffect(() => () => stopAll(), [stopAll]);

  // The camera (and mic) for both modes; the mic meter from the same stream.
  const startCamera = useCallback(async () => {
    setError('');
    try {
      const portrait = window.innerHeight > window.innerWidth;
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: portrait ? 2160 : 3840 }, height: { ideal: portrait ? 3840 : 2160 }, frameRate: { ideal: 30 } }, // the camera's best, up to 4K
        audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true },
      });
      cam.current = s;
      if (camVideo.current) { camVideo.current.srcObject = s; await camVideo.current.play().catch(() => {}); }
      const ctx = new AudioContext();
      const an = ctx.createAnalyser(); an.fftSize = 512;
      ctx.createMediaStreamSource(s).connect(an);
      audio.current = ctx;
      const buf = new Uint8Array(an.fftSize);
      const tick = () => { an.getByteTimeDomainData(buf); let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v - 128)); setLevel(m / 128); raf.current = requestAnimationFrame(tick); };
      tick();
    } catch (e) {
      setError(e instanceof Error && /denied|NotAllowed/i.test(e.message + e.name) ? 'Allow the camera and microphone for genovus.io, then try again.' : 'The camera didn’t start. Check that no other app is using it.');
    }
  }, []);
  useEffect(() => { if (phase === 'setup' && !cam.current) startCamera(); }, [phase, startCamera]);

  const startScreen = async () => {
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
      scr.current = s;
      if (screenVideo.current) { screenVideo.current.srcObject = s; await screenVideo.current.play().catch(() => {}); }
      s.getVideoTracks()[0].addEventListener('ended', () => { if (rec.current?.state === 'recording') stop(); });
      return true;
    } catch { toast({ err: 'Pick a screen, window or tab to share.' }); return false; }
  };

  // Screen mode: draw the shared screen (fitted) and the camera bubble on a 1920x1080 canvas, every frame.
  const drawLoop = () => {
    const c = canvas.current, sv = screenVideo.current, cv = camVideo.current;
    if (!c || !sv || !cv) return;
    const g = c.getContext('2d')!;
    const W = c.width, H = c.height;
    const draw = () => {
      g.fillStyle = '#0b0c10'; g.fillRect(0, 0, W, H);
      if (sv.videoWidth) { const k = Math.min(W / sv.videoWidth, H / sv.videoHeight); const w = sv.videoWidth * k, h = sv.videoHeight * k; g.drawImage(sv, (W - w) / 2, (H - h) / 2, w, h); }
      if (cv.videoWidth) {
        const d = 300, x = W - d - 48, y = H - d - 48, side = Math.min(cv.videoWidth, cv.videoHeight);
        g.save(); g.beginPath(); g.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2); g.closePath(); g.clip();
        g.translate(x + d, y); g.scale(-1, 1); // mirrored, like a selfie
        g.drawImage(cv, (cv.videoWidth - side) / 2, (cv.videoHeight - side) / 2, side, side, 0, 0, d, d); g.restore();
        g.lineWidth = 8; g.strokeStyle = '#ff6a2b'; g.beginPath(); g.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2); g.stroke();
      }
      raf.current = requestAnimationFrame(draw);
    };
    draw();
  };

  const begin = async () => {
    if (!cam.current) { await startCamera(); if (!cam.current) return; }
    if (mode === 'screen' && !(await startScreen())) return;
    setPhase('count');
    for (let i = 3; i >= 1; i--) { setCount(i); await new Promise((r) => setTimeout(r, 900)); }
    const mime = pickMime();
    let stream: MediaStream = cam.current!;
    if (mode === 'screen') {
      cancelAnimationFrame(raf.current); drawLoop();
      const out = canvas.current!.captureStream(30);
      cam.current!.getAudioTracks().forEach((t) => out.addTrack(t));
      stream = out;
    }
    chunks.current = [];
    const big = Math.max(cam.current!.getVideoTracks()[0]?.getSettings().width ?? 0, cam.current!.getVideoTracks()[0]?.getSettings().height ?? 0) >= 3000 && mode === 'camera';
    const r = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: big ? 35_000_000 : 16_000_000, audioBitsPerSecond: 192_000 });
    r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
    r.onstop = () => {
      const type = r.mimeType || mime || 'video/webm';
      const blob = new Blob(chunks.current, { type });
      const ext = type.includes('mp4') ? 'mp4' : 'webm';
      const name = `${mode === 'screen' ? 'screen' : 'take'}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.${ext}`;
      setTake({ url: URL.createObjectURL(blob), file: new File([blob], name, { type: type.split(';')[0] }) });
      setPhase('review');
      wake.current?.release().catch(() => {}); wake.current = null;
      stopAll();
    };
    rec.current = r;
    r.start(1000);
    setSecs(0); setPhase('rec');
    try { wake.current = await (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen') ?? null; } catch { /* the screen may dim; recording continues */ }
    if (prompter.current) prompter.current.scrollTop = 0;
  };
  const stop = () => { if (rec.current?.state === 'recording') rec.current.stop(); };

  // The clock and the teleprompter scroll while recording.
  useEffect(() => {
    if (phase !== 'rec') return;
    const t0 = Date.now();
    const clock = setInterval(() => setSecs((Date.now() - t0) / 1000), 250);
    let last = performance.now(), frame = 0;
    const scroll = (now: number) => {
      const el = prompter.current;
      if (el && rolling) { const words = (script?.text ?? '').split(/\s+/).length || 1; const pxPerSec = (el.scrollHeight - el.clientHeight) / Math.max(10, (words / wpm) * 60); el.scrollTop += pxPerSec * ((now - last) / 1000); }
      last = now; frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    return () => { clearInterval(clock); cancelAnimationFrame(frame); };
  }, [phase, rolling, wpm, script]);

  const useTake = async () => {
    if (!take) return;
    setPhase('upload');
    try {
      if (script) await fetch('/api/studio/newsroom', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tool: 'next_upload', production: script.id }) });
      const r = await uploadRecording(take.file, (p, n) => { setPct(p); setNote(n); });
      toast({ ok: r.say ?? 'Uploaded. Unedit is on it.' });
      router.push(`/console/studio/unedit/${r.id}`);
    } catch (e) { toast({ err: e instanceof Error ? e.message : 'Upload failed.' }); setPhase('review'); }
  };
  const again = () => { if (take) URL.revokeObjectURL(take.url); setTake(null); setPhase('setup'); };

  const lines = (script?.text ?? '').split(/\n+/).filter(Boolean);
  return (
    <div className="rc">
      <div className="rc-bar">
        <div className="rc-modes" role="tablist" aria-label="What to record">
          <button type="button" role="tab" aria-selected={mode === 'camera'} className={mode === 'camera' ? 'on' : ''} disabled={phase !== 'setup'} onClick={() => setMode('camera')}>Camera + teleprompter</button>
          <button type="button" role="tab" aria-selected={mode === 'screen'} className={mode === 'screen' ? 'on' : ''} disabled={phase !== 'setup' || !canScreen} onClick={() => setMode('screen')} title={canScreen ? undefined : 'Screen recording works on a computer (Chrome, Edge or Firefox).'}>Screen + camera</button>
        </div>
        <label className="rc-field"><span>Script</span>
          <select value={scriptId ?? ''} disabled={phase !== 'setup'} onChange={(e) => setScriptId(e.target.value || null)}>
            <option value="">No script</option>
            {scripts.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        </label>
        {!scripts.length ? <a className="muted nr-small" href="/console/studio/unedit/newsroom">Produce a story in the Newsroom to load its teleprompter.</a> : null}
      </div>

      {error ? <p className="ue-stop" role="alert">{error} <button type="button" className="btn small" onClick={startCamera}>Try again</button></p> : null}

      <div className={`rc-stage ${mode}`}>
        <div className="rc-view">
          {phase === 'review' && take ? (
            <video src={take.url} controls playsInline className="rc-video" />
          ) : (<>
            <video ref={camVideo} muted playsInline className={`rc-video${mode === 'screen' ? ' rc-hidden' : ''}`} />
            <video ref={screenVideo} muted playsInline className="rc-hidden" />
            <canvas ref={canvas} width={1920} height={1080} className={`rc-video${mode === 'screen' && (phase === 'rec' || phase === 'count') ? '' : ' rc-hidden'}`} />
            {mode === 'screen' && phase === 'setup' ? <div className="rc-screen-hint">Press Record, pick the screen, window or tab to share, and your camera joins in a bubble.</div> : null}
            {mode === 'camera' && script ? (
              <div ref={prompter} className="rc-prompter" style={{ fontSize: size }} aria-label="Teleprompter">
                {lines.map((l, i) => <p key={i}>{l}</p>)}
                <p className="rc-end">End of script</p>
              </div>
            ) : null}
            {phase === 'count' ? <div className="rc-count" aria-live="assertive">{count}</div> : null}
            {phase === 'rec' ? <span className="rc-rec"><i />REC {mmss(secs)}</span> : null}
          </>)}
        </div>
        {mode === 'screen' && script?.points.length ? (
          <aside className="rc-points"><span className="nr-label">Talking points (not recorded)</span>{script.points.map((p, i) => <span key={i}>{i + 1}. {p}</span>)}</aside>
        ) : null}
      </div>

      <div className="rc-controls">
        {phase === 'setup' ? <button type="button" className="rc-big" onClick={begin} aria-label="Start recording"><i /></button> : null}
        {phase === 'rec' ? <button type="button" className="rc-big stop" onClick={stop} aria-label="Stop recording"><i /></button> : null}
        {phase === 'review' ? <><button type="button" className="btn primary" onClick={useTake}>Use this take</button><button type="button" className="btn" onClick={again}>Record again</button></> : null}
        {phase === 'upload' ? <span className="rc-up">{note} {pct}%</span> : null}
        <span className="rc-meter" aria-label="Microphone level"><i style={{ width: `${Math.min(100, Math.round(level * 160))}%` }} /></span>
        {mode === 'camera' && script ? (
          <span className="rc-tune">
            <button type="button" className="btn small" onClick={() => setRolling(!rolling)}>{rolling ? 'Pause scroll' : 'Resume scroll'}</button>
            <label><span className="sr-only">Teleprompter speed</span><input type="range" min={110} max={190} step={10} value={wpm} onChange={(e) => setWpm(Number(e.target.value))} /> {wpm} wpm</label>
            <label><span className="sr-only">Text size</span><input type="range" min={24} max={52} step={2} value={size} onChange={(e) => setSize(Number(e.target.value))} /> Aa</label>
          </span>
        ) : null}
      </div>
      <p className="muted nr-small">{script ? `Recording against “${script.title}”: its sources go on screen where you say each fact.` : 'No script: record freely; Unedit still cuts, captions and polishes it.'} Look at the lens, not the text. Keep this page open until the upload finishes.</p>
    </div>
  );
}
