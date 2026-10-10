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

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
