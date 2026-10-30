'use client';
// "Alert me about new leads on this phone": turns on push alerts for this device (one tap, the browser asks once).
// On an iPhone, alerts work once Genovus is on the Home Screen, so it says how. Off again with one tap.
import { useEffect, useState } from 'react';

type State = 'loading' | 'unsupported' | 'install' | 'off' | 'on' | 'blocked' | 'busy';
const KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';
const bytes = (b64: string) => { const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };
const device = () => { const u = navigator.userAgent; return /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? 'Android phone' : /Mac/.test(u) ? 'Mac' : /Windows/.test(u) ? 'Windows PC' : 'This device'; };

/** `team`: the Genovus console version: new inquiries and website bookings for Genovus itself. */
export function LeadAlerts({ compact, team }: { compact?: boolean; team?: boolean }) {
  const [state, setState] = useState<State>('loading');
  const [err, setErr] = useState('');
  useEffect(() => {
    (async () => {
      const ios = /iPhone|iPad/.test(navigator.userAgent);
      const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
      if (!KEY || !('serviceWorker' in navigator)) return setState('unsupported');
      if (!('PushManager' in window)) return setState(ios && !standalone ? 'install' : 'unsupported');
      if (Notification.permission === 'denied') return setState('blocked');
      const reg = await navigator.serviceWorker.getRegistration('/');
      const sub = await reg?.pushManager.getSubscription();
      setState(sub ? 'on' : 'off');
    })().catch(() => setState('unsupported'));
  }, []);
  const turnOn = async () => {
    setState('busy'); setErr('');
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      if ((await Notification.requestPermission()) !== 'granted') return setState('blocked');
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(KEY) });
      const r = await fetch('/api/push', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON(), device: device() }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Couldn’t save it.');
      setState('on');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Couldn’t turn alerts on.'); setState('off'); }
  };
  const turnOff = async () => {
    setState('busy');
    const sub = await (await navigator.serviceWorker.getRegistration('/'))?.pushManager.getSubscription();
    if (sub) { await fetch('/api/push', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }); await sub.unsubscribe(); }
    setState('off');
  };
  if (state === 'loading' || state === 'unsupported') return null;
  return (
    <div className={'lead-alerts' + (compact ? ' compact' : '')} data-tour="lead-alerts">
      {state === 'on' ? <span><b>{team ? 'Inquiry alerts are on' : 'New-lead alerts are on'}</b> for this {device().toLowerCase()}. {team ? 'Tap one to reply.' : 'Tap an alert to call.'}</span>
        : state === 'install' ? <span><b>Get new-lead alerts on this iPhone:</b> tap Share, then <b>Add to Home Screen</b>, and open Genovus from there.</span>
        : state === 'blocked' ? <span><b>Alerts are blocked</b> for genovus.io in this browser’s settings. Allow notifications there to turn them on.</span>
        : team ? <span><b>Know the moment an agency reaches out.</b> New inquiries and website bookings on this device, so you reply in minutes.</span>
        : <span><b>Know the moment a lead comes in.</b> An alert on this device; tap it to call while it’s fresh.</span>}
      {state === 'off' || state === 'busy' ? <button className="btn small primary" type="button" disabled={state === 'busy'} onClick={turnOn}>Alert me on this device</button> : null}
      {state === 'on' ? <button className="btn small ghost" type="button" onClick={turnOff}>Turn off</button> : null}
      {err ? <span className="muted" style={{ fontSize: 12 }}>{err}</span> : null}
    </div>
  );
}
