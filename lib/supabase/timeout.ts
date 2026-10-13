// Every Supabase request gets a time limit, so a stalled connection fails fast (and shows up as an error the Studio
// monitor can report) instead of hanging a page or a production step indefinitely.
export const DB_TIMEOUT_MS = 20_000;
export const timedFetch: typeof fetch = (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(DB_TIMEOUT_MS)]) : AbortSignal.timeout(DB_TIMEOUT_MS) });
