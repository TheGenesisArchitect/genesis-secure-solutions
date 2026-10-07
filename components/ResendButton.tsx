'use client';
import { useEffect, useState } from 'react';

/** "Send a new code", unlocked after a short wait so people don't flood their own inbox. */
export function ResendButton({ seconds }: { seconds: number }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return (
    <button className="btn small ghost" type="submit" disabled={left > 0} aria-live="polite">
      {left > 0 ? `Send a new code in ${left}s` : 'Send a new code'}
    </button>
  );
}
