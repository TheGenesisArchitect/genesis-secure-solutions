'use client';
// The Calendar's booking panel (Calendar?book=partner:<id> or lead:<id>): open times Helix suggests from the calendar,
// one tap to fill the form with one, and the form itself (an internal Helix form, so Helix can fill it and, after the
// person's yes, save it). A partner visit moves the partner to "visit booked"; a lead's consult books the lead.
import { useRef } from 'react';
import { ActionForm } from '@/components/ActionForm';
import { bookFromCalendar } from '@/lib/actions';

export type Slot = { day: string; time: string; label: string };

export function BookingPanel({ target, who, kind, slots, done }: { target: string; who: string; kind: 'partner' | 'lead'; slots: Slot[]; done: string | null }) {
  const form = useRef<HTMLDivElement>(null);
  const pick = (s: Slot) => {
    const set = (name: string, v: string) => { const el = form.current?.querySelector<HTMLInputElement>(`input[name="${name}"]`); if (!el) return; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.classList.remove('helix-filled'); void el.offsetWidth; el.classList.add('helix-filled'); };
    set('day', s.day); set('time', s.time);
  };
  const noun = kind === 'partner' ? 'visit' : 'consult';
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {done ? <p style={{ margin: 0 }}><b>Booked:</b> {done}. It’s on the calendar below; pick another time to move it.</p> : null}
      {slots.length ? (
        <div style={{ display: 'grid', gap: 6 }}>
          <span className="muted" style={{ fontSize: 13 }}>Open on your calendar (weekdays 9 to 5, an hour each, nothing else booked then):</span>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {slots.map((s, i) => <button key={`${s.day}${s.time}`} type="button" className={'btn small' + (i === 0 ? ' primary' : '')} data-helix-item={`Open time ${s.label}`} onClick={() => pick(s)}>{i === 0 ? `Soonest: ${s.label}` : s.label}</button>)}
          </div>
        </div>
      ) : <p className="muted" style={{ margin: 0, fontSize: 13 }}>No open hour in the next week: pick a time that works.</p>}
      <div ref={form}>
        <ActionForm action={bookFromCalendar} helix="booking" helixTitle={`Book this ${noun}`} className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'end' }}>
          <input type="hidden" name="target" value={target} />
          <label className="field"><span>Day</span><input className="input" type="date" name="day" required defaultValue={slots[0]?.day} /></label>
          <label className="field" style={{ width: 130 }}><span>Time</span><input className="input" type="time" name="time" required defaultValue={slots[0]?.time} /></label>
          {kind === 'partner'
            ? <>
              <label className="field"><span>Business (kept on your records)</span><input className="input" name="business" maxLength={120} defaultValue={who} autoComplete="off" /></label>
              <label className="field"><span>Who you’ll meet <span className="muted">(optional)</span></span><input className="input" name="contact" maxLength={120} placeholder="Name" autoComplete="off" /></label>
            </>
            : <label className="field"><span>Note <span className="muted">(optional)</span></span><input className="input" name="note" maxLength={300} placeholder="What they want to cover" autoComplete="off" /></label>}
          <button className="btn small primary" type="submit">Book {noun}</button>
        </ActionForm>
      </div>
    </div>
  );
}
