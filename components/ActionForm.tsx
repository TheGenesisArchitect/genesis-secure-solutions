'use client';
// A form that saves in place: the server action returns a result, the page data refreshes without a
// navigation (so the scroll position stays put), and the result shows as a toast. Toasts live in one
// <Toaster/> mounted in the root layout, so a message survives even when the save removes its own form
// (a removed draft, an approved item). Sticky results (like a link shown once) stay until dismissed.
import { useActionState, useEffect, useState, useRef, type ReactNode, type CSSProperties } from 'react';
import type { ActionResult } from '@/lib/actions';

const EVENT = 'genovus:toast';
const emit = (r: ActionResult) => { if (r) window.dispatchEvent(new CustomEvent(EVENT, { detail: r })); };

type Props = {
  action: (prev: ActionResult, f: FormData) => Promise<ActionResult>;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  resetOnOk?: boolean;
  confirm?: string;
};

export function ActionForm({ action, children, className, style, resetOnOk, confirm }: Props) {
  const ref = useRef<HTMLFormElement>(null);
  const [, formAction, pending] = useActionState(async (prev: ActionResult, f: FormData) => {
    const r = await action(prev, f);
    emit(r);
    if (r?.ok && resetOnOk) ref.current?.reset();
    return r;
  }, null);
  return (
    <form
      ref={ref}
      action={formAction}
      className={className}
      style={style}
      aria-busy={pending}
      data-pending={pending ? '' : undefined}
      onSubmit={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}
    >
      {children}
    </form>
  );
}

export function Toaster() {
  const [toast, setToast] = useState<NonNullable<ActionResult> | null>(null);
  useEffect(() => {
    const on = (e: Event) => setToast((e as CustomEvent<NonNullable<ActionResult>>).detail);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  useEffect(() => {
    if (!toast || toast.sticky || toast.err) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast) return null;
  return (
    <div className={'toast ' + (toast.err ? 'err' : 'ok')} role={toast.err ? 'alert' : 'status'}>
      <span style={{ userSelect: 'text' }}>{toast.err ?? toast.ok}</span>
      <button type="button" className="toast-x" aria-label="Dismiss" onClick={() => setToast(null)}>×</button>
    </div>
  );
}
