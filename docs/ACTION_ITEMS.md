# Action items

Pinned items to finish before or soon after the platform release. Newest first.

## Finalize sign-in (pinned 2026-10-07)

Principle: secure but effortless. Customers verify once per device, then stay signed in; easy, seamless UX is a core Genovus feature.

In code (`app/signin`, `app/auth/confirm`):
- [ ] One email carries a button and a 6-digit code; `/signin` gets a code-entry step (`verifyOtp` type `email`) for when the email is on another device or behind an office firewall.
- [ ] Remember the email on the device; one-tap "Open Gmail" and "Open Outlook" after sending; resend with a short cooldown.
- [ ] Confirm invites land the person signed in on their own dashboard.

In the Supabase dashboard (operator, via Vercel single sign-on), for both `genovus-db` and `genovus-db-preview`:
- [ ] Magic link email template: add `{{ .Token }}` beside the button.
- [ ] Turn off public sign-ups (invites keep working).
- [ ] Site URL and redirect allow-list: `https://genovus.io`, the Vercel production URL, preview URLs, `http://localhost:3913`.

Later: one-tap Google or Microsoft sign-in, and passkeys.

## Launch Mendez Hollis's landing page today (added 2026-10-07)

- [ ] Replace the unlicensed riverfront hero: a licensed or self-made Chattahoochee riverfront image (or a recreation), then clear the photo-rights gate.
- [ ] A domain for JAVA Agency (operator picks and buys; we connect it to the `java-agency` Vercel project).
- [ ] Call-notes copy: "GEICO Exclusive Agency" wording (never "agent"), service area, lines written, quote button to his GEICO page (done).
- [ ] Remove noindex at launch once the client and carrier approve.
