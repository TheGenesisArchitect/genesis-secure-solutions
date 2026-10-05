# Genovus (by Genesis Secure Solutions)

Build to `docs/TECH_SPEC.md`, the final spec as of 2026-10-05. The live, editable copy with diagrams:
https://claude.ai/code/artifact/c02ccb41-0342-4b1e-8013-488c892ba02a

## Rules that never bend
- Tenant isolation: every table carries `tenant_id`; Supabase row-level security enforces it.
- People approve anything outward (publish, send, post, ad spend, invoice) through the approval lanes.
- Agents never quote, underwrite, bind or give policy advice; one tenant per agent run.
- Secrets, client tokens and prices stay server-side; never import `lib/clients.ts` into client code.
- Nothing is indexed until the client and carrier approve the live site.
- Leads keep their consent record; texting only with recorded consent and A2P 10DLC registration.
- Supabase is the system of record; GoHighLevel is the messaging and workflow layer only.

## Stack
Next.js 16 on Vercel Pro, Supabase (Postgres + auth), Vercel Blob (private), GoHighLevel Agency Pro,
Dub, Stripe (70/30 deposit split), Resend, Sentry, Meta and Google Business Profile APIs, Claude.
Commit every change; preview before production.
