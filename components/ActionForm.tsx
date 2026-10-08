'use client';
// A form that saves in place: the server action returns a result, the page data refreshes without a
// navigation (so the scroll position stays put), and the result shows as a toast. Sticky results
// (like a link shown once) stay until dismissed.
import { useActionState, useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import type { ActionResult } from '@/lib/actions';

type Props = {
  action: (prev: ActionResult, f: FormData) => Promise<ActionResult>;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  resetOnOk?: boolean;
  confirm?: string;
};

export function ActionForm({ action, children, className, style, resetOnOk, confirm }: Props) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  const [toast, setToast] = useState<ActionResult>(null);
  useEffect(() => {
    if (!state) return;
    setToast(state);
    if (state.ok && resetOnOk) ref.current?.reset();
    if (state.sticky || state.err) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [state, resetOnOk]);
  return (
    <>
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
      {toast ? (
        <div className={'toast ' + (toast.err ? 'err' : 'ok')} role={toast.err ? 'alert' : 'status'}>
          <span style={{ userSelect: 'text' }}>{toast.err ?? toast.ok}</span>
          <button type="button" className="toast-x" aria-label="Dismiss" onClick={() => setToast(null)}>×</button>
        </div>
      ) : null}
    </>
  );
}
