# Genovus by Genesis Secure Solutions: Technical Specification

Oct 5, 2026 · @Anthony

## Overview

Genovus, by Genesis Secure Solutions, is a turnkey growth platform for local agencies: one validated agent record goes in, and a launched, measured and continuously improved local-growth program comes out. Insurance agents are the first market. Mendez Hollis (JAVA Agency, LLC, Columbus GA) is the live proof client.

The platform has three faces that share one data model and one agentic layer:

- **The enterprise console** is where the Genesis team sells, builds, approves and runs every client.
- **The client back office** is each agent's own private workspace: profile, setup, approvals, performance, leads and billing.
- **The public surfaces** are the client websites, the Genesis funnel with its live demo, and each client's welcome package.

**Goals for v1**

1. Take a paid client from deposit to launch on the engine, measured in calendar days and hands-on hours, starting with agent number two.
2. Give every client a back office that shows their progress, their results and what needs their approval, without a call.
3. Run content, social and reporting for 100+ agents with one team, because AI drafts and people approve.

**Design principles**

- **One record drives everything.** Site, emails, invoices, posts, reports and upsell signals all read the agent record.
- **People approve anything that leaves the building.** Publishing, sending, posting and invoicing always pass a human approval lane.
- **Compliance is built in, not bolted on.** Carrier approval, consent, photo rights and AI limits are gates in the workflow.
- **Results drive the work.** Every month the KPI engine proposes one improvement with its evidence.
- **The client owns their accounts.** Social, ad and domain accounts belong to the agent; Genesis holds partner access.

**Out of scope for v1:** quoting, underwriting or binding insurance; carrier system integrations; white-labelling for other agencies.

## Users, roles and tenancy

Every client is its own tenant, and no user ever sees another tenant's data. Genesis staff work across tenants through the console; client users see only their own back office.

| Role | Who | Can do | Cannot do |
| --- | --- | --- | --- |
| Platform admin | Genesis leadership | Everything, including billing settings, roles and tenant creation | Change the audit log |
| Account lead | Genesis team member who owns the client | Run intake, approve proposals and launches, manage the client's plan | Change platform settings |
| Content and ads operator | Genesis team | Review AI drafts, schedule posts, manage ad campaigns | Approve invoices or launches |
| Reviewer | Genesis compliance or QA | Approve or reject anything in the required lane | Edit billing |
| Agent owner | The insurance agent (e.g. Mendez) | See and edit their profile, approve their content, see performance, pay invoices, add office staff | See any other client |
| Office staff | People the agent invites | Log lead outcomes, answer leads, view performance | Approve publishing or billing unless the owner grants it |
| Partner (later) | Agency networks that refer agents | See referral status for their own referrals | See client data |

**Tenancy model.** A tenant row owns everything under it: agent record, site, accounts, leads, posts, campaigns, KPIs, invoices and documents. Every table carries `tenant_id`, and database row-level security enforces it, so a missed check in application code still cannot leak data.

**Sign-in.** Client users sign in with a magic link or passkey. Staff sign in with single sign-on once the team grows past a handful of people. The welcome-package link stays a separate, scoped token: it opens one client's setup guide and nothing else.

## System architecture

The platform is one Next.js application on Vercel with three faces, a shared Postgres database with row-level security, an agent orchestration service, and a small set of external integrations. Media and private files live in Vercel Blob. Long renders (films) run on a dedicated worker, not in serverless functions.

&#91;embedded content: platform architecture · 3 faces, 4 services, 2 data stores\]

People reach the platform through three faces; agents propose, the approval queue releases, and only approved actions reach external services.

| Component | Responsibility | Built on |
| --- | --- | --- |
| Platform app | Console, back office, public funnel, welcome packages, API routes | Next.js 16 on Vercel |
| Client site engine | Serves every client website from its agent record, by domain | Next.js multi-tenant routing on Vercel |
| Database | Tenants, agent records, gates, leads, posts, campaigns, KPIs, invoices, approvals, audit log | Postgres with row-level security (Supabase proposed) |
| File storage | Portraits, photos, films, documents, progress snapshots | Vercel Blob, private by default |
| Agent orchestrator | Runs build, QA, content, ads, analyst and concierge agents; writes every proposal to the approval queue | Server functions + background jobs calling Claude |
| Approval queue | Holds every outward action until its lane allows it | Database tables + console UI |
| Render worker | Captures films frame by frame and encodes them; renders post graphics | Headless Chrome + ffmpeg on a worker machine |
| Scheduler | Monthly reports, reminders, KPI snapshots, token refresh | Vercel Cron |

## Data model

The agent record is the root of every tenant: it is validated at intake and versioned, and every other entity hangs off it. Today it exists as a config file (`site.config.ts` for Mendez's site) and a JSON record (`data/clients/mendez-hollis.json` for his welcome package); v1 moves both into the database.

| Entity | Key fields | Notes |
| --- | --- | --- |
| Tenant | id, name, status, created\_at | One per client agency |
| Agent record | agent and agency names, office address, phone, licensed states, languages, carrier, carrier links, tier, care plan, enabled features, domain, social URLs, brand assets | Versioned; edits by the client go through approval |
| Gate | kind (photo rights, carrier approval, carrier-rules attestation, Meta access, domain, privacy notice, kickoff), status, evidence, cleared\_by, cleared\_at | Nothing builds or publishes until its gates clear |
| Asset | kind (portrait, photo, film, logo, document), blob key, rights status, source | Rights status is required before use |
| Lead | source tags (utm, fbclid, referrer, landing), contact fields, topic, consent record, received\_at, first\_response\_at, owner, outcome | Outcomes (quoted, policy) are staff-reported |
| Content item | channel, copy, media, status (draft, in review, approved, scheduled, published), scheduled\_for, compliance checks | One item can target Facebook and Instagram |
| Campaign | platform, objective, budget, spend, leads, cost per lead, status | Client-owned ad account; spend paid by the client |
| KPI snapshot | period, reach, engagement, calls, callbacks, bookings, response time, quotes, policies, cost per policy | Monthly and weekly rollups |
| Invoice | kind (deposit, balance, care, upgrade), amount, credit applied, status, Stripe ids | Upgrade credit = amount paid to date |
| Approval | subject (any of the above), lane, requested\_by, decided\_by, decision, decided\_at | Every outward action has one |
| Audit event | actor, action, subject, before, after, at | Append-only, hash-chained |
| Setup progress | five steps, domain choice, kickoff times, updated\_at | Live today in Vercel Blob; moves to the database in v1 |

**Rule:** a client may edit their own profile, but changes that reach a public surface (site copy, photos, office details) become a draft that passes review before publishing.

## Agentic layer

AI agents draft, test and analyse; people approve. Every agent writes its output as a proposal into the approval queue, and the proposal's lane decides whether it runs on its own, waits for team review, or needs a named person to approve it.

| Agent | Reads | Produces | Lane for its output |
| --- | --- | --- | --- |
| Build agent | Agent record, approved templates, brand kit | Site pages and copy, profile bios, welcome package | Queued (team review), then Required to publish |
| QA agent | Built site and assets | Checks: build, forms, links, mobile fit, preview card, accessibility, photo rights on every image | Auto |
| Content agent | Agent record, local calendar, approved content library, last month's KPIs | Monthly content calendar, post copy, graphic briefs | Queued, then client approval, then Required to post |
| Ads agent | Top organic posts, KPIs, budget rules | Campaign drafts, budget changes, pause recommendations | Required |
| Analyst agent | KPI snapshots, leads, outcomes | Monthly report, the one improvement, health score, upsell signals | Queued |
| Concierge (Premium) | Approved FAQ and office details only | Answers to site visitors, handoff to staff | Auto within approved answers; anything else hands off |

**Approval lanes**

- **Auto:** internal, reversible work, such as drafts, QA checks and reminders.
- **Queued:** the team reviews before it moves on, such as copy and content.
- **Required:** a named person approves each time, covering publishing, sending, posting, ad spend and invoicing.

**Guardrails**

- No agent quotes, underwrites or binds coverage, or gives advice about a specific policy.
- Agents see one tenant at a time. Portfolio learning uses aggregated patterns, never another client's records.
- Every prompt, output and decision is logged against the client and the approval that released it.
- Model choice is per agent: a strong model for drafting and analysis, a fast model for checks and classification. Narration uses Gemini text-to-speech today.

## Client lifecycle

Every client moves through eight stages, and each stage change is an event that triggers messages, invoices and agent work. Two loops close the system: care feeds upgrades, and launched clients feed the agent lead engine.

&#91;embedded content: client lifecycle · 8 stages, 2 loops\]

Stages 1 to 4 sell the work and stages 5 to 8 deliver it from one record; the two loops are where the business compounds.

| Stage | Entered when | Owner | Exit check | Fires |
| --- | --- | --- | --- | --- |
| Attract | Audit request, live demo or referral | Platform | Consult booked | Confirmation email |
| Consult | Call held | Account lead | Tier recommended | Recap and proposal |
| Propose | Proposal sent | Account lead | Proposal signed | Deposit invoice |
| Deposit | Invoice issued | Platform | Deposit paid | Welcome package (film + setup guide) |
| Intake | Deposit paid | Client, account lead | All gates clear | Reminders after 48 hours |
| Build | Gates clear | Build and QA agents, reviewer | Draft approved by the team | Review email to the client |
| Review and launch | Draft ready | Client, carrier, reviewer | Client and carrier approve; balance paid | Launch notice, balance invoice, care subscription |
| Care | Launch | Operators, analyst agent | Ongoing | Monthly report, upgrade signals |

Today these stages run by hand for Mendez, who is in Intake. v1 records each transition in the database and drives the messages from it.

## Client sites and the Genesis funnel

One site engine serves every client website: it looks up the agent record by the domain a visitor arrives on and renders that agent's pages, so a new client is a record and a domain, not a new codebase. Tiers are feature flags on the record, not separate builds.

| Module | Launch | Growth | Premium |
| --- | --- | --- | --- |
| Public pages | 1 | Up to 5 | Up to 8 |
| Callback form with source tracking and consent record | Yes | Yes | Yes |
| Coverage pages and Meet the agent page | Add-on | Yes | Yes |
| Guided intake and booking | Add-on | Yes | Yes |
| FAQ, Moving and Drivers campaign pages | Add-on | Add-on | Yes |
| AI concierge | Add-on | Add-on | Yes |

**Per-site behaviour**

- Metadata, structured data (InsuranceAgency) and the link-preview image are generated per agent.
- Search indexing, analytics IDs and the Meta pixel are per-agent fields, so launching one client never changes another.
- Every callback is stored as a lead with its source tags and consent, then emailed to the office through a verified sending domain.
- Domains: a Genovus subdomain or the agent's own domain, attached through the Vercel domains API and managed from the back office and the console (see Domains and tracked links).

**The Genesis funnel.** The public site opens with the commercial and hands the visitor the live demo: they type a name and office and get a private preview of their own site plus a presence score. Previews are marked as concepts, never published or indexed, carry no carrier logo, and use only what the visitor typed.

**Welcome packages.** When a deposit clears, the client receives a personal film and a private setup guide at `/welcome/<token>`. This is live today for Mendez on genesis-secure-solutions.vercel.app, rendered server-side from his record, with progress saved to private storage.

## Content, social and ads engine

The agent owns their Facebook Page, Instagram professional account, Meta ad account and Google Business Profile; Genesis manages them through partner access. Meta does not let a vendor create Pages for a client through its API, so accounts are created or claimed on a guided call at intake.

**The monthly loop**

1. **Know:** the client profile holds office facts, audience, languages, voice, a local calendar and what has worked.
2. **Plan:** the content agent drafts a calendar from the approved library, the local calendar and last month's results.
3. **Create:** it writes copy variations; the render worker fills brand templates into images and short videos.
4. **Approve:** compliance rules run first (no rate promises, no guarantees, required disclaimers), then the team, then the client in one click. Carrier approval is added where required.
5. **Publish and promote:** posts are scheduled; the best organic posts become ads on the client's own ad account.
6. **Measure:** results update the profile and the next plan.

|  | Organic content | Paid ads |
| --- | --- | --- |
| Volume | 4 posts a month, adapted for Facebook and Instagram | Campaigns sized to the client's budget |
| Who pays | Included in care | Client pays spend directly; management fee is a team decision |
| Judged on | Engagement that turns into calls and callbacks | Cost per qualified lead, then cost per policy |
| Publishing path | Meta Business Suite by hand first; Graph API after app review | Marketing API after app review; manual until then |

**Compliance content library.** Carrier-approved post templates and page copy, each with its approval record. One approved template is reused across agents, which is what lets one team serve 100+ clients.

**Constraints to confirm before the first paid campaign:** insurance ads likely fall under Meta's special ad category for financial products, which limits age, gender and ZIP targeting. Meta app review and business verification take weeks, so the application starts early.

## KPI engine and reporting

Every client is measured on one metric chain, and each month the analyst agent finds the weakest link and proposes one improvement with the evidence behind it. A person approves the improvement before anything changes.

| Link in the chain | Metrics | Source |
| --- | --- | --- |
| Reach | Site visits by source; social reach | Site analytics, Meta insights |
| Engagement | Post engagement; profile actions | Meta insights, Google Business Profile |
| Actions | Calls, quote handoffs, callbacks, bookings | Site events, lead table |
| Response | Time to first response; leads with an owner | Lead table |
| Outcomes | Quotes and policies | Office staff log them in the back office |
| Efficiency | Cost per lead; cost per policy | Ad spend over leads and logged policies |

A quote click is a handoff to the carrier, not a quote. No carrier data feed is assumed, so outcomes count only what staff log.

**Client health score.** A 0 to 100 score from response time, action rate, outcome logging, approvals turned around and content cadence. It flags upsell moments (booking demand points to Growth, lead volume to Premium) and churn risk (slow responses, falling engagement). The weights are set after agent number two's first 90 days.

**Monthly report.** Generated on the first business day, reviewed by an operator, then sent: the chain's numbers, leads by source, posts published, the one improvement and next month's plan. It also lives in the client's back office.

**Portfolio learning.** Patterns across clients (which post types, times and campaign themes drive callbacks) feed every plan as aggregates only. No client's records are shown to, or used in prompts for, another client.

## Client back office

Every client gets an independent, private back office: their profile, their progress, what needs their approval, and how their program is performing, all in one place they can open from a phone. It replaces status calls, and it is where the value of the monthly fee becomes visible.

&#91;embedded content: back office home · mock-up, sample data\]

Home leads with what needs the agent (approvals and next actions), then shows the month on the same metric chain the team manages. Numbers in the mock-up are samples.

| Area | What the agent sees and does | Tiers |
| --- | --- | --- |
| Home | Health score, next three actions, this month's improvement, anything waiting on them | All |
| My profile | Office details, photos, licensed states, languages, links, carrier rules checklist; edits become drafts that pass review before they go public | All |
| Setup | The five intake gates and their status; replaces the welcome guide after sign-in | All |
| Approvals | Site changes, posts and ads waiting for them: approve, or request changes with a comment | All |
| Performance | The metric chain for the month and trend, leads by source, response time, policies logged | All |
| Leads | Every callback with its source; set an owner, log first response, log quote and policy outcomes | All |
| Content | The month's calendar, published posts and their results | All |
| Bookings | Upcoming appointments and intake answers | Growth, Premium |
| Ads | Campaigns, spend, leads and cost per lead; pause or approve budget changes | With ads management |
| Concierge | Questions the AI answered and the ones handed to staff | Premium |
| Billing | Plan, invoices, payment method, upgrade price with credit for what was paid | All |
| Documents | Agreement, approvals record, brand kit, monthly reports | All |
| Domains | Connect their own domain or use a Genovus subdomain; see each domain's status and SSL; see every tracked link to outside resources and its clicks | All |
| Team | Invite office staff and set what they can do | All |
| Support | Requests to the Genesis team and their status | All |

**Access.** The agent owner signs in with a magic link or passkey and can invite office staff. Office staff log outcomes and answer leads; only the owner approves publishing, ad spend and payments unless they delegate it.

**Independence.** Each back office shows only that tenant's data, enforced in the database. An agent who leaves can export their leads, reports and documents, and keeps every account they own.

## Enterprise operations console

The console is the Genesis team's cockpit: every client, every queue and every number in one place, organised around what needs a person next.

| Area | Purpose |
| --- | --- |
| Pipeline | Every client by lifecycle stage, with days in stage and the next action |
| Approval queue | Everything waiting in the Queued and Required lanes, filtered by role, oldest first |
| Clients | One page per tenant: agent record, gates, site, accounts, leads, content, campaigns, invoices, audit trail |
| Content desk | All clients' calendars in one view; review and schedule drafts in bulk |
| Ads desk | Campaigns across clients, spend pacing, cost per lead, pause alerts |
| Portfolio KPIs | Time to launch, hands-on hours per launch, monthly recurring revenue, upsell rate, care churn, leads per client |
| Health watch | Clients ranked by health score, with the reason and the suggested action |
| Billing | Invoices, payments, failed charges, upgrade credits |
| Domains | Every client's domains and SSL status, tracked links and their clicks, and domains waiting on DNS |
| Library | Approved templates, content and brand kits, each with its approval record |
| Settings | Roles, approval lanes, integrations, audit log export |

**Staffing model.** At 100 clients, care means about 800 posts a month to approve. The console is designed so one operator clears a client's month in minutes: drafts arrive pre-checked, grouped by client, with approve-all for items that passed every rule.

## Look and feel

The Genesis surfaces share the cinematic look of the commercial: deep navy ground, one warm accent, confident type and purposeful motion. Client websites do not: each carries its own agent's brand, so the platform look never competes with the client's.

| Token | Value | Use |
| --- | --- | --- |
| Ground | #050B17 navy | Page background on Genesis surfaces |
| Surface | #0B1527 | Cards and panels |
| Ink | #EEF3FB | Primary text |
| Muted | #93A3BD | Secondary text |
| Teal | #19C3AE | Success, done, primary data |
| Amber | #F2A93B | The one call to action, numbered steps, attention |
| Violet | #8B6CF0 | AI agents |
| Blue | #4C8DFF | The client |
| Display type | Sora 700 to 800 | Headlines, numbers |
| Body type | Inter 400 to 600 | Everything else |

**Motion.** Words reveal with a short rise and blur-in; numbers count up; progress bars fill. One orchestrated moment per screen, never ambient animation, and everything respects reduced-motion settings.

**Film language.** Welcome films and the commercial are rendered from a deterministic timeline, so the same record always produces the same film. Kinetic type carries the story; a natural narrator voice carries it for people who are watching, not reading.

**Components.** Panel, KPI tile, metric-chain bar, step card with status, approval card (preview, approve, request changes), lead row, calendar cell, film player, progress bar. The console uses the same tokens in a denser, light-and-dark layout built for long working sessions.

**Accessibility.** WCAG 2.2 AA contrast, full keyboard use, visible focus, captions on every film.

## Billing and payments

Stripe handles every charge: a 70% deposit to start, the 30% balance at launch, a monthly care subscription from launch, and upgrade invoices that charge only the difference. The invoice and approval records live with the client, so the back office shows exactly what was paid and what is next.

| Plan | Setup | Monthly care | Upgrade from Launch |
| --- | --- | --- | --- |
| Launch | $1,500 | $249 | — |
| Growth | $2,500 | $399 | $1,000 |
| Premium | $5,000 | $799 | $3,500 |

**Rules**

- **Upgrade credit** is the amount the client has actually paid to date, never the list price. Mendez paid a $375 deposit against a $1,000 VIP price, so Growth costs him $2,125 now, or $1,500 once his $625 balance is paid.
- **Care** starts at launch, month to month, with 30 days' notice. Unused monthly work does not roll over. Care moves to the new tier's rate from the next cycle after an upgrade.
- **Pass-through costs** (domain, hosting, software, ad spend) are billed separately; ad spend goes on the client's own card.
- **Invoices** are a Required-lane action: an account lead approves each one before it sends.

**Stripe events the platform listens for:** invoice paid (advances the lifecycle; a paid deposit sends the welcome package), payment failed (alerts the account lead, pauses new work after a grace period), subscription cancelled (starts the 30-day wind-down).

## Security, privacy and compliance

The platform holds insurance prospects' contact details and acts on public accounts under a carrier's brand, so security and compliance are part of the workflow, not a later audit.

| Area | Control |
| --- | --- |
| Tenant isolation | `tenant_id` on every row, enforced by database row-level security; tested on every release |
| Access | Role-based permissions (see Users, roles and tenancy); least privilege by default; staff single sign-on |
| Secrets | API keys and tokens only on the server; never in browser code or the repository |
| Client links | Welcome links use 128-bit random tokens, compared in constant time, never listed anywhere, noindexed; ticking steps requires sign-in once the back office ships |
| Audit | Every outward action, approval and data change is written to an append-only, hash-chained audit log |
| Lead data | Minimum fields only; session replay masks all text and inputs; no Social Security numbers, payment or policy documents accepted; retention policy set per client |
| Consent | Every callback stores its consent; text messages require separate, recorded consent before any send |
| Carrier rules | The agency owner approves the carrier rules checklist in their marketing profile; copy and brand use are approved in writing and stored with the content they cover |
| Photo rights | Rights status required on every asset before use; intake gate |
| Customer data | In a captive book the carrier owns the customers; use stays within carrier rules |
| AI limits | No quoting, underwriting, binding or policy advice; one tenant per agent run; prompts and outputs logged |
| Search exposure | Nothing is indexed until the client and carrier approve the live site |

**Path to SOC 2.** Controls are designed to SOC 2 from v1 (access reviews, change management through git and preview deploys, logging, vendor list), with a formal audit once enterprise or network partners require it.

## Integrations

Each integration has one owner module and one set of server-side credentials, and every write it makes to the outside world passes the approval queue first.

| Integration | Used for | Status |
| --- | --- | --- |
| Vercel (Pro) | Hosting, deploys, domains API, cron, Blob storage | Live; upgrade to Pro before client launches |
| Vercel Blob | Private files and setup progress | Live (private store connected to the platform) |
| Supabase | System of record: Postgres with row-level security, plus auth | Decided; project to create |
| GoHighLevel Agency Pro | Per-agent calendars, booking, pipelines, texting and email workflows, white-labeled as Genovus | Decided; account and A2P 10DLC registration to set up |
| Calendly | Booking for agents who already use it | Supported as bring-your-own |
| Dub | Tracked, branded links to third-party resources on client domains | Decided; account to set up |
| Entri Connect | One-click DNS setup for clients | Later, once signups are self-serve |
| Stripe | Deposits (70/30), balances, care subscriptions, upgrade invoices | Not built |
| Resend | Callback and lifecycle emails from one verified sending domain | Code ready; sending domain not set up |
| Meta Graph API | Page and Instagram publishing, comments and messages, insights | Needs Meta app review and business verification |
| Meta Marketing API | Lead ads, campaigns, spend and results | Needs app review |
| Google Business Profile API | Profile updates, posts, review requests | Needs access approval |
| Claude | Build, content, analyst and concierge agents | To wire into the orchestrator |
| Gemini text-to-speech | Film narration | Live in the film pipeline |
| Sentry | Errors, performance, uptime and cron monitoring | Decided; Team plan to start |
| Analytics (Vercel Analytics, GA4, Meta Pixel) | Site traffic and conversion events | Code ready; IDs set per client at launch |

## Infrastructure and delivery

Everything ships through git and Vercel: every change gets a protected preview deployment, and production moves only on an approved merge.

| Environment | Purpose | Data |
| --- | --- | --- |
| Local | Development | Seed data only |
| Preview | Every branch, behind Vercel login | Separate database branch and Blob store |
| Production | Clients and the public funnel | Live data, backups daily |

**Delivery rules**

- One repository for the platform (`genesis-secure-solutions`), commits on every change, preview before production.
- A new Vercel project's first deploy goes straight to production with a public address, so new projects are planned with that in mind.
- Client-facing pages are noindexed until launch approval; search exposure is a per-client switch.
- Films render on a worker machine with a resumable, multi-worker capture (frames saved as they finish), because a single serverless or background run can hit a time limit before a long render ends.

**Observability.** Request logs and function errors from Vercel; Sentry for errors, performance, uptime and cron checks; an uptime check on the funnel, every client site and the progress API; alerts to the account lead for failed sends, failed charges and gates stuck over 48 hours.

**Hosting plan.** Vercel Pro (decided), because this is commercial client hosting.

## Roadmap

The platform is built in five phases ordered by dependency, and the proof that it works is agent number two going from finished intake to launch on the engine, measured in days and hands-on hours.

&#91;embedded content: roadmap · 5 phases, 4 gates, not to scale\]

Phases are ordered by dependency, not dated; each ends at its gate, and dates are set from the decisions below.

**Built so far**

| Date | Item | Detail |
| --- | --- | --- |
| Oct 5, 2026 | Platform site on Vercel | Commercial at `/`, client welcome packages at `/welcome/<token>`, progress API on private Blob storage |
| Oct 5, 2026 | Mendez welcome package | Narrated 60-second film and five-step setup guide |
| Oct 5, 2026 | Narrated commercial | 75 seconds, Gemini voice, embedded as the pitch deck's opening slide |
| Oct 4, 2026 | Pitch deck and pricing | 45-slide internal deck; client decks updated to Launch, Growth and Premium pricing |
| Oct 3, 2026 | Mendez Launch site | Config-driven Next.js site on Vercel with source tracking, noindexed |

**Back office in the phases.** v1 of the back office (Home, My profile, Setup, Approvals, Leads, Billing) ships in Phase 1 so agent number two signs in from day one. Performance, Content and Bookings follow in Phase 2; Ads and Concierge in Phase 3.

## Decisions

Every open choice is now made except pricing for the new modules. The spec is final for the build as of Oct 5, 2026.

| Decision | Choice | What it means for the build |
| --- | --- | --- |
| Database and auth | Supabase | Postgres with row-level security and Supabase Auth; the system of record for every tenant |
| Product name | Genovus, by Genesis Secure Solutions | Preliminary trademark screen clear on Oct 5, 2026: no live US mark for GENOVUS. Attorney clearance next, then rename the site, films and deck |
| Client domains | Custom domains and Genovus subdomains, managed from the back office and the console | Vercel domains API for sites, Dub for tracked links to third-party resources, Entri when self-serve volume justifies it |
| Vercel plan | Pro | Upgrade in the Vercel dashboard before client launches |
| Booking (Growth) | GoHighLevel calendars; Calendly supported for agents who already use it | One sub-account per agent, set up inside the CRM |
| CRM (Premium) | GoHighLevel Agency Pro, white-labeled as Genovus | Messaging and workflow layer only; Supabase stays the record |
| Error tracking | Sentry | Errors, performance, uptime and cron checks; masked session replay |
| Standard deposit split | 70/30 | 70% deposit to start, 30% balance at launch; Mendez keeps his existing terms |
| Support response times | Per plan | Times below |
| Ads management fee, annual prepay, launch kit | Built for flexibility and upside | Pricing below |
| Pricing and tiers for new modules | Still open | Team to set |
| Carrier rules | The agency owner approves the rules that apply to their business | A checklist in the marketing profile, approved before Phase 1 marketing; stored as an intake gate |
| Welcome-link writes | Sign-in required once the back office ships | Until then, anyone with the link can tick steps |

## Domains and tracked links

Three services together let any client run their own domain and still track every third-party resource from one platform: Vercel serves the sites, Dub turns every outside link into a tracked link on the client's own domain, and Entri automates the DNS setup once client volume justifies it.

| Need | Service | Why it fits |
| --- | --- | --- |
| Client websites on a custom domain or a Genovus subdomain | Vercel domains API (Pro) | Unlimited custom domains per project on Pro, with a soft limit of 100,000; SSL issued automatically for every verified domain |
| Tracked links to third-party resources (carrier quote pages, booking pages, outside landing pages, social bios) | Dub | Branded short links on the client's own domain, click and conversion tracking, and a REST API to create links in bulk |
| One-click DNS setup for clients | Entri Connect (later) | Applies the records for the site, the CRM, the link subdomain and email in one client consent, across 70+ DNS providers |
| Buying a domain inside Genovus | Vercel or Entri Sell | Decided when self-serve signup ships |

**How it works for a client.** The back office gets a Domains area: connect a domain the agent owns, or use a Genovus subdomain; see each domain's status and SSL; and see every tracked link with its clicks. The console gets the same view across all clients. A carrier quote link becomes a branded short link (for example go.agencyname.com/quote) that records the click before forwarding.

**Constraints.** Wildcard subdomains need the Genovus domain on Vercel's nameservers or delegated certificate validation, so the Genovus domain is chosen first: getgenovus.com and genovus.io are open, and genovus.com is registered but unused. Vercel limits domain additions to 100 an hour and verifications to 50 an hour per team, which shapes bulk onboarding. Dub's Business plan ($90 a month: 100 custom domains, 250,000 tracked events) covers the first 100 clients; the Advanced plan ($300 a month, 250 domains) is the next step. Entri Startup is $249 a month for 600 connections a year, so it waits until signups are self-serve.

## Booking and CRM

GoHighLevel Agency Pro is the recommended engine for both booking and CRM: one $497-a-month agency account gives unlimited sub-accounts, so every agent gets their own calendars, pipelines, texting and email workflows under the Genovus brand, and the cost does not grow with each client.

| Option | Fit for Genovus | Cost |
| --- | --- | --- |
| **GoHighLevel Agency Pro (recommended)** | Unlimited sub-accounts, SaaS mode for white-label reselling and automatic sub-account creation, advanced API, built-in calendars and booking | $497 a month for the agency |
| GoHighLevel Unlimited | Same sub-accounts and calendars, basic API, no SaaS mode | $297 a month |
| Calendly (bring your own) | Familiar to agents; SMS reminders and routing forms on Standard; API, webhooks, round robin and branding removal on Teams | From $10 per seat a month (Standard), $16 (Teams) |
| Cal.com | API-first scheduling that can live natively inside Genovus's own interface later | Teams $12 per user a month; platform pricing by quote |

**How it sits behind Genovus**

- **Supabase stays the system of record.** Leads land in Genovus first with their consent record, then sync one way to the agent's GoHighLevel sub-account for follow-up. Outcomes sync back.
- **Tiers map to sub-account features.** Growth turns on calendars, booking reminders and intake forms; Premium adds pipelines and follow-up workflows.
- **Texting needs A2P 10DLC registration** for each agent's sub-account before any business text is sent, and only to people who consented.
- **Calendly stays supported.** An agent who already uses it connects their booking link, and Genovus wraps it in a tracked Dub link.
- **Insurance-native CRMs** such as AgencyZoom suit independent agencies with fewer than 25 producers; captive agents get less from them, because much of their value is multi-carrier workflow. They connect as an integration rather than replacing the Genovus record.

**Test on Mendez:** set up his sub-account, a 20-minute consultation calendar and booking reminders, then compare against Calendly on time to book and no-show rate.

## Error tracking and monitoring

Sentry is the recommended tracker: it covers errors, performance, session replay, uptime and scheduled-job checks in one place, and it integrates with Next.js and Vercel, which is everything the console, back office and client sites run on.

| Plan | Price (billed annually) | Errors a month | Users | Data lookback |
| --- | --- | --- | --- | --- |
| Developer | $0 | 5,000 | 1 | 30 days |
| **Team (recommended to start)** | $26 a month | 50,000 | Unlimited | Up to 90 days |
| Business | $80 a month | 50,000 | Unlimited | Up to 90 days, plus sampled retention |

Each paid plan includes one uptime monitor and one cron monitor; more cost $1.00 and $0.78 each.

**What it watches**

- **Errors and slow pages** on the console, the back office, the funnel and every client site, tagged by tenant so an account lead sees which client is affected.
- **Uptime monitors** on the funnel, each client site, the progress API and the lead-capture route.
- **Cron monitors** on the monthly report, reminders and KPI snapshots, so a job that silently stops is caught.
- **Session replay** on the console and back office only, with all text and form inputs masked, because those screens show prospects' names and phone numbers.

Product analytics (which back-office features agents use, where the funnel drops) is a separate need; PostHog is an option to add once there is enough traffic to study.

## Pricing for new offers

Each offer gives the client a choice they control and gives Genesis revenue that grows as the client grows. Approved Oct 5, 2026.

**Deposit split, 70/30 (decided)**

| Plan | Setup | Deposit (70%) | Balance at launch (30%) |
| --- | --- | --- | --- |
| Launch | $1,500 | $1,050 | $450 |
| Growth | $2,500 | $1,750 | $750 |
| Premium | $5,000 | $3,500 | $1,500 |

Mendez keeps the terms he signed: $1,000 VIP price, $375 paid, $625 due at launch.

**Ads management.** The greater of $300 a month or 15% of that month's ad spend, plus a one-time $350 setup for the pixel, lead forms and first campaign. The client pays ad spend directly on their own card and can change budget or cancel month to month. At $1,000 of spend the fee is $300; at $4,000 it is $600. Agency fees of 10% to 20% of spend, with flat minimums for small accounts, are typical, per WebFX pricing data cited in one vendor's guide, so treat that range as indicative. Upside is tied to spend, never to policies sold: a fee contingent on insurance sales, paid to an unlicensed company, can run into commission-sharing and rebating rules. Have counsel confirm before any outcome-based fee.

**Annual prepay for care.** Twelve months for the price of ten.

| Care plan | Monthly | 12 months monthly | Prepaid year |
| --- | --- | --- | --- |
| Essential (Launch) | $249 | $2,988 | $2,490 |
| Growth Care | $399 | $4,788 | $3,990 |
| Optimization (Premium) | $799 | $9,588 | $7,990 |

On an upgrade, unused prepaid months are credited toward the new plan at the rate paid. After the first 30 days, prepaid care is credited, not refunded.

**Launch kit for captives going independent.** $3,500 one time, 70/30. Scope: the Growth build (up to five pages, guided intake, booking), a brand identity (logo, colours, type), a new domain and business email setup, Facebook, Instagram and Google Business Profile created, eight launch posts, and the first month of Growth Care included. Growth Care at $399 a month starts in month two, and the kit is credited in full toward Premium.

## Support response times

Response time scales with the care plan, and a site outage gets the same fast response on every plan. Times are first human response in business hours, Monday to Friday.

| Request | Essential (Launch) | Growth Care | Optimization (Premium) |
| --- | --- | --- | --- |
| Site down or lead form not delivering | 2 business hours | 2 business hours | 2 business hours |
| Change request or question | 2 business days | 1 business day | 4 business hours |
| Content approval turnaround by our team | 3 business days | 2 business days | 1 business day |
| Strategy call | Monthly, 20 minutes | Monthly, 30 minutes | Twice monthly, 30 minutes |

Requests come in through the back office's Support area, and the console times every one against these targets.

## Carrier rules checklist

The agency owner is responsible for their carrier's rules, so they review and approve a checklist of generic carrier prompts while setting up their marketing profile, before any Phase 1 marketing. Their answers configure what Genovus does for them; it is their attestation, not a legal determination by Genesis.

| Prompt the owner answers | What it controls in Genovus |
| --- | --- |
| Does my carrier require approval of my website, social posts or ads before they go live? Who approves them? | Adds a carrier approval step to the Required lane, routed to the named approver |
| May I use my carrier's name, logo or trademarks, and under what rules? | Whether brand assets appear on the site and in posts |
| May my website and posts link to my carrier's quote page, and may those links be tracked? | Whether quote links become tracked Dub links |
| May my leads be stored in a third-party CRM? | Whether leads sync to the agent's GoHighLevel sub-account |
| May my office send marketing text messages, and to whom? | Whether texting and SMS reminders are switched on |
| May my site show a “site by” credit or a referral link for a vendor? | Whether the Genovus credit appears on the site |
| Are there required disclaimers, licence numbers or wording? | Adds them to the site footer, posts and ads automatically |
| Are there products, states or claims I must not advertise? | Adds them to the compliance rules every draft is checked against |

**How it is stored.** Each answer is saved with who approved it, when, and the checklist version, as the carrier-rules attestation gate on the agent record. When the checklist changes, owners re-confirm only the new items. The console shows any client whose attestation is missing or out of date, and nothing publishes for them until it is current.

## Sources

Vendor prices and limits were checked on these pages as of Oct 5, 2026; they change, so re-check before signing.

- [GoHighLevel pricing](https://www.gohighlevel.com/pricing)
- [Calendly pricing](https://calendly.com/pricing)
- [Cal.com pricing](https://cal.com/pricing)
- [Sentry pricing](https://sentry.io/pricing/)
- [Vercel multi-tenant limits](https://vercel.com/docs/multi-tenant/limits)
- [Entri pricing](https://entri.com/pricing)
- [Dub pricing](https://dub.co/pricing)
- [Meta ads management cost guide (a vendor's guide citing WebFX data; indicative only)](https://superscale.ai/learn/meta-ads-management-cost/)
- [Best CRM for insurance agencies, 2026 (third-party roundup, for the AgencyZoom positioning)](https://www.appliedaijax.com/ai-insurance-news/best-crm-for-insurance-agencies/)
- [Trademarkia search for GENOVUS](https://www.trademarkia.com/search/trademarks?query=genovus) (preliminary screen, not legal clearance)

## Decision log, as answered

The team's answers as typed on Oct 5, 2026, kept for the record. The Decisions section above is the version to build to.

| Decision | Options | Proposed |
| --- | --- | --- |
| Database and auth | Supabase, or another Postgres with a separate auth provider | Supabase: row-level security and auth in one, already in the stack : Let's Use Supabase |
| Product name and domain | Working title “Business in a Box” under Genesis Secure Solutions | Team to choose - IGNYT is the Name (changed to Genovus on Oct 5, 2026, after the trademark screen) |
| Client domains | Agent-owned domain, or a subdomain on ours | Subdomain first, custom domain as an option - We need custom domain options built into the client and enterprise side so that any third party resources can still be launched and tracked from one platform.  let's choose the best services for this |
| Vercel plan | Hobby or Pro | Pro, since this is commercial hosting - Pro |
| Booking tool (Growth) | Any tool with one account per agent | Shortlist two, test on Mendez - I need best suggestion for the booking service.  Calendy and maybe something more comprehensive for agents.&#32; |
| CRM (Premium) | Agency CRM with sub-accounts per agent | Shortlist two - Scan for the best tools that match our Enterprise objectives.&#32; |
| Error tracker | Any hosted tracker | Team to choose - Need the suggestion from you here based on our Dashboard features and Enterprise objectives.&#32; |
| Standard deposit split | 50/50, or another split | Team to set - 70/30 will be the splits moving forward |
| Support response times | Per care plan | Team to set - Per Plan |
| Ads management fee, annual prepay discount, launch kit price | Pricing for new offers | Team to set - Let's set what give Genesis and the Client Flexibility and upside.&#32; |
| Pricing and tiers for new modules | Speed-to-lead, reviews, profile care, Spanish, portal | Team to set |
| Carrier rules | Vendor credits on client sites, outreach to carrier agents | Ask the client, Agency Owner as they are responsible for this information.  They will approve the carrier rules that apply to their business. before Phase 1 marketing.  In setting up their marketing profile we can have a set of generic carrier prompts they can check and approve&#32; |
| Welcome-link writes | Anyone with the link can tick steps (today), or sign-in required | Sign-in required once the back office ships |
