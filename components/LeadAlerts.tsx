'use client';
// "Alert me about new leads on this phone": turns on push alerts for this device (one tap, the browser asks once).
// On an iPhone, alerts work once Genovus is on the Home Screen, so it says how. Off again with one tap.
// It never hides silently: where alerts can't work (the Genovus app shell, an in-app browser), it says where they do.
// A device that's on keeps the server's copy in step (re-saved on every visit; re-subscribed if the push key
// changed), and "Send a test" shows the push service's own answer when something is wrong.
import { useEffect, useState } from 'react';

type State = 'loading' | 'unsupported' | 'app' | 'nokey' | 'install' | 'off' | 'on' | 'blocked' | 'busy';
const KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';
const bytes = (b64: string) => { const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };
const device = () => { const u = navigator.userAgent; return /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? 'Android phone' : /Mac/.test(u) ? 'Mac' : /Windows/.test(u) ? 'Windows PC' : 'This device'; };
const sameKey = (sub: PushSubscription) => {
  const k = sub.options?.applicationServerKey;
  if (!k) return true; // the browser doesn't say; assume it matches
  const a = new Uint8Array(k), b = bytes(KEY);
  return a.length === b.length && a.every((x, i) => x === b[i]);
};
const save = (sub: PushSubscription) => fetch('/api/push', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON(), device: device() }) });

/** `team`: the Genovus console version: new inquiries and website bookings for Genovus itself. */
export function LeadAlerts({ compact, team }: { compact?: boolean; team?: boolean }) {
  const [state, setState] = useState<State>('loading');
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    (async () => {
      const ios = /iPhone|iPad/.test(navigator.userAgent);
      const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
      if ((window as unknown as { Capacitor?: unknown }).Capacitor) return setState('app');
      if (!KEY) return setState('nokey');
      if (!('serviceWorker' in navigator)) return setState('unsupported');
      if (!('PushManager' in window)) return setState(ios && !standalone ? 'install' : 'unsupported');
      if (Notification.permission === 'denied') return setState('blocked');
      const reg = await navigator.serviceWorker.getRegistration('/');
      let sub = await reg?.pushManager.getSubscription();
      // Subscribed under an older push key: alerts would be refused, so drop it and ask again.
      if (sub && !sameKey(sub)) { await sub.unsubscribe().catch(() => {}); sub = null; setNote('Alerts were set up with an older key. Turn them on again.'); }
      // On this device: make sure the server still has it (it drops devices the push service rejected).
      if (sub && Notification.permission === 'granted') {
        const r = await save(sub).catch(() => null);
        if (r && !r.ok) { setState('off'); return; }
      }
      setState(sub && Notification.permission === 'granted' ? 'on' : 'off');
    })().catch(() => setState('unsupported'));
  }, []);
  const turnOn = async () => {
    setState('busy'); setErr(''); setNote('');
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      if ((await Notification.requestPermission()) !== 'granted') return setState('blocked');
      const old = await reg.pushManager.getSubscription();
      if (old && !sameKey(old)) await old.unsubscribe();
      const sub = (old && sameKey(old) ? old : null) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(KEY) });
      const r = await save(sub);
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Couldn’t save it.');
      setState('on');
      setNote('Alerts are on. Tap “Send a test” to see one.');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Couldn’t turn alerts on.'); setState('off'); }
  };
  const turnOff = async () => {
    setState('busy'); setNote('');
    const sub = await (await navigator.serviceWorker.getRegistration('/'))?.pushManager.getSubscription();
    if (sub) { await fetch('/api/push', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }); await sub.unsubscribe(); }
    setState('off');
  };
  const test = async () => {
    setErr(''); setNote('Sending…');
    const sub = await (await navigator.serviceWorker.getRegistration('/'))?.pushManager.getSubscription();
    const r = await fetch('/api/push/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: sub?.endpoint }) }).then((x) => x.json()).catch(() => ({ ok: false, message: 'Couldn’t reach Genovus.' }));
    if (r.ok) setNote(r.message); else { setNote(''); setErr(r.message ?? r.error ?? 'The test didn’t go through.'); }
    if (r.onFile === false) setState('off');
  };
  if (state === 'loading') return null;
  const what = team ? 'inquiry and booking alerts' : 'new-lead alerts';
  return (
    <div className={'lead-alerts' + (compact ? ' compact' : '')} data-tour="lead-alerts" data-alerts={state}>
      {state === 'on' ? <span><b>{team ? 'Inquiry alerts are on' : 'New-lead alerts are on'}</b> for this {device() === 'This device' ? 'device' : device()}. {team ? 'Tap one to reply.' : 'Tap an alert to call.'}</span>
        : state === 'install' ? <span><b>Get {what} on this iPhone:</b> open genovus.io in Safari, tap Share, then <b>Add to Home Screen</b>, and open Genovus from there.</span>
        : state === 'app' ? <span><b>The Genovus app can’t show {what} yet.</b> Open genovus.io in Chrome (Android) or add it to your Home Screen from Safari (iPhone), sign in, and turn alerts on there. They arrive even while you use the app.</span>
        : state === 'unsupported' ? <span><b>This browser can’t receive {what}.</b> Open genovus.io in Chrome, Edge or Safari (on iPhone, from the Home Screen) and turn them on there.</span>
        : state === 'nokey' ? <span><b>Alerts aren’t set up on this server</b> (the push key is missing).</span>
        : state === 'blocked' ? <span><b>Alerts are blocked</b> for genovus.io in this browser’s settings. Allow notifications there to turn them on.</span>
        : team ? <span><b>Know the moment an agency reaches out.</b> New inquiries and website bookings on this device, so you reply in minutes.</span>
        : <span><b>Know the moment a lead comes in.</b> An alert on this device; tap it to call while it’s fresh.</span>}
      {state === 'off' || state === 'busy' ? <button className="btn small primary" type="button" disabled={state === 'busy'} onClick={turnOn}>Alert me on this device</button> : null}
      {state === 'on' ? <span className="row" style={{ gap: 6, flex: '0 0 auto' }}><button className="btn small" type="button" onClick={test}>Send a test</button><button className="btn small ghost" type="button" onClick={turnOff}>Turn off</button></span> : null}
      {note ? <span className="muted" style={{ fontSize: 12, flexBasis: '100%' }}>{note}</span> : null}
      {err ? <span style={{ fontSize: 12, flexBasis: '100%', color: 'var(--bad)' }}>{err}</span> : null}
    </div>
  );
}
