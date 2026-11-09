# Genovus Lead Engine: Technical Specification (v1, 2026-11-03)

This is the build spec for the upgrades the Lead Engine R&D recommends. The research and the decisions waiting on Anthony
are at https://claude.ai/artifact/9W1RSCUZK9AZBZeGhbPYZU. This spec extends `docs/TECH_SPEC.md` and never overrides it.
The rules in CLAUDE.md apply to every line here:
- tenant RLS
- people approve anything outward
- no texting before A2P 10DLC
- leads keep their consent record

**Status:** spec only.
- P0 shipped 2026-11-03. Turnstile stays off until its keys are set.
- P1 built 2026-11-09 in five slices (migrations 0094–0097 and the scoreboard); see §4.10 for what differs from this plan. It ships once its verify scripts pass on preview.
- P2 waits on decisions 4 and 7 on the R&D page.
- P3 waits on GEICO's written lead and marketing rules.

## 1. Goal and the one flow

Every paying agency gets a steady flow of leads inside its own lines and market. Each lead:
- names that agency in its consent
- is checked and scored
- reaches the right person within 5 minutes
- is followed to quoted, bound and premium

The measured results become Genovus's proof.

```
market playbook -> capture -> consent ledger -> verify -> score -> route + 5-min timer -> cadence -> outcome -> learn
      (P2)          (P0/P1)       (P1)          (P1)      (P1)          (P1)              (P1)       (P1)     (P3)
```

**Inputs per agency:** these already live in `agency_profiles`:
- market: lat/lng and `service_radius_mi`
- `licensed_states`
- `lines`
- `carrier`
- `timezone`

The vertical comes from the tenant (`kind`). Nothing new is asked of the agency to start.

## 2. Autonomy model

Every engine action carries one of four lanes, stored as `lead_rules.lane` and checked in one function, `engineMay(tenant, action)`.

| Lane | Who decides | Examples |
|---|---|---|
| `auto` | Runs on its own | capture, verify, dedupe, DNC scrub, score, route, timers, alerts, Helix drafts, copy check, reports, conversion uploads, pausing ads when a pause rule trips |
| `standing` | The owner approves the rule once, with a limit; each run is logged and can be undone | first-touch email within 5 min from an approved template; budget shift ±X% inside the cap; GBP posts from an approved queue; AI receptionist answering inbound calls with an approved script; creative rotation from an approved pool |
| `tap` | One approval card each time | new campaign, copy or audience; raising a cap; any outbound or AI call; review replies; partner rewards; a new line or market |
| `never` | Hard block in code, no override | SMS before A2P 10DLC; a call with no written consent or to a DNC number; "guarantee"; a line not in `agency_profiles.lines`; scraping; bought renewal dates or DMV lists |

**How standing rules are stored and enforced:**
- They live in `lead_rules`, with these columns:
  - `tenant_id`
  - `action`
  - `limit` (jsonb)
  - `approved_by`
  - `approved_at`
  - `expires_at` (default 90 days)
  - `paused_at`
- Approval goes through a new `approvals.subject_kind = 'rule'`, added to the check in 0001.
- If no rule exists, or it is paused or expired, the action drops to `tap`.

**Kill switches:**
- per tenant: `lead_rules` row `action='*'`, `paused_at`
- per channel
- global: env `LEAD_ENGINE_OFF=1`

The engine reads all three before every outward step.

## 3. P0: fixes to live code (this week)

| # | Defect | Fix | Verify |
|---|---|---|---|
| 0.1 | Command Brief day window and Studio post time hardcoded `-04:00`, an hour off after daylight saving ended | **Shipped:** `easternAt()` in `lib/billing.ts`, used in `lib/command-brief.ts` and `lib/actions.ts` `studioSavePost` | `verify-command-brief.mjs` fixture is now DST-aware; unit cases across both changes |
| 0.2 | Anyone could fake partner credit with `utm_source=partner&utm_campaign=<ref_code>` (0039 `link_partner_lead`) | **Shipped:** partner links carry `utm_campaign=<ref_code>.<sig>`, where sig is the first 10 hex of HMAC-SHA256(`PARTNER_LINK_SECRET` or `CRON_SECRET`, `partner:<tenant>:<ref>`) (`lib/partner-link.ts`). Both capture paths verify it (`lib/attribution.ts` `tagLead`) and pass the bare ref code only when it's valid; otherwise the source becomes `partner-unverified` and no partner is credited. The signature rides in utm_campaign because every path, JAVA's own site included, already keeps that field. No secret means no links and no credit. The `leads.partner_id` FK is deferred to the P1 migration. | `verify-lead-p0.mjs`: forged and bare codes credit no one; a signed one links once and moves the partner to referring |
| 0.3 | Hosted sites (`/s/[slug]`) dropped UTM, gclid and fbclid | **Shipped:** `components/site/SiteAttribution.tsx` keeps the visit's first-touch tags in sessionStorage per site; the contact form sends them; the site route stores them in `attribution` and derives source and campaign with the same `tagLead` as the lead API. Untagged visits stay `website`; preview sites stay `website-preview`; `medium` keeps callback/booking. | A hosted lead keeps utm_source, fbclid and campaign |
| 0.4 | `/api/leads/ingest` had no limit; the site route limited by phone/email only, through a PostgREST `.or()` string built from raw input | **Shipped:** the lead API looks up the key's agency first and allows 30 leads a minute and 500 a day **per agency** (429 with retry-after). The site route counts phone and email with separate `.eq()` queries, and allows 5 requests an hour per connection (`attribution.ip_hash`, a salted hash, never the address). No migration. | The 31st call in a minute gets 429; a phone with filter characters can't widen the check; the 6th request from one connection gets 429 |
| 0.5 | No bot check on any form | **Shipped, switched off:** Cloudflare Turnstile on the hosted-site form and `/book`'s intake (`components/Turnstile.tsx`, `lib/turnstile.ts`), with the CSP opened for `challenges.cloudflare.com`. It turns on only when both `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are set; then a missing or bad token is refused, and if Cloudflare can't be reached the form goes through (logged). The JAVA site's callback is deferred: it is a client's live site and has no keys yet. | With the test keys: no token gets 400; the test token goes through |

## 4. P1: speed to lead, consent, verify, score (2 weeks, no ad spend)

### 4.1 Consent ledger (migration 0094)
`lead_consents` is append-only: no update or delete grants, and a trigger raises an error on update or delete. Columns:

| Column | Holds |
|---|---|
| `id` | |
| `tenant_id` | |
| `lead_id` | FK |
| `seller_name` | The agency named on the form |
| `text` | The exact text shown |
| `text_version` | sha256 of the text, plus a `consent_texts` lookup |
| `channels` | text[] ⊆ {`call`,`autodial_ai`,`email`,`sms`} |
| `not_condition_of_purchase` | bool |
| `page_url` | |
| `ip_hash` | |
| `user_agent` | |
| `client_at` | |
| `received_at` | |
| `cert_id` | TrustedForm certificate, null until P1.6 |
| `cert_retained_at` | |
| `revoked_at` | |
| `revoked_via` | |

**Forms and routes:**
- Forms render the consent from `consent_texts` by version id and send `consent_version` and channel boxes. The text names the agency, so it is not the fixed sentence built on the server today.
- Call leads (`ingest_call`) write a consent row with `channels='{}'` and text "Inbound call; no marketing consent." They can be called back about their own call only.
- `leads.consent_text` stays for backward compatibility and is filled from the ledger.

**Revocation:**
- Any reply of "stop" or an unsubscribe link sets `revoked_at` and is honoured within 10 business days. We aim for the same day.
- We build for the FCC revoke-all rule (effective 2027-01-31): revoking telemarketing revokes every channel for that seller.

**Engine guard:** `consentAllows(lead, channel)` is the only gate the engine calls before any touch.

### 4.2 Identity and dedupe
- New table `contacts` (tenant_id, `phone_e164`, `email_norm`, `household_key` = normalized street + ZIP, first_seen, last_seen). `leads.contact_id` is an FK.
- Ingest normalizes the phone with libphonenumber-js (already MIT and small) and the email (lowercase, trim; strip `+tag` for gmail).
- A repeat within 30 days for the same tenant attaches to the open lead (`lead_events` kind `repeat`) instead of creating a new lead. The alert says "asked again".
- The JAVA site's random `ext_id` stops creating duplicates, because dedupe moves to the contact.

### 4.3 Verify
- A worker in `/api/cron/leads` (every minute) runs these checks:
  - Twilio Lookup line type, $0.008. Env `TWILIO_*`, already used for voice. The result is stored in `lead_checks` (lead_id, kind, result jsonb, at).
  - Email syntax and MX lookup over DNS, no vendor.
  - Turnstile result from P0.5.
  - Duplicate check from 4.2.
- A lead is `verified` when the phone is valid and not landline-only or invalid (a landline is fine for calls), or the email is deliverable.
- Results feed the score. A failed check never deletes a lead.

### 4.4 Score (`lib/lead-score.ts`, rules first)
The score runs 0–100 and keeps its reasons, like `partnerFit`. It is stored as `leads.score` and `leads.score_reasons text[]`.

| Signal | Points |
|---|---|
| Line asked about is in `agency_profiles.lines` | +30 (out-of-line = 0 and flagged, never delivered as billable) |
| Address or area code inside `licensed_states` and within `service_radius_mi` | +20 |
| Verified phone | +20; verified email +10 |
| Stated renewal date within 60 days | +10 |
| Booked a time | +10 |
| Repeat ask | +5 |

The score never uses protected traits and never decides eligibility or price; it only sets order and routing. Colorado's AI Act from 2027-01-01 is the reason to keep it that way.

### 4.5 Route and the 5-minute timer
- `leads.owner_id` (FK auth.users). Assignment follows `lead_rules` `action='route'`, either round robin among members with `lead_owner=true` or "owner only". The default is all owners, as today.
- `lead_timers` (lead_id, due_at, stage `first_touch`, escalated_at). It is created by `on_lead_new`, with `due_at = now() + 5 min`. Inside office hours (`agency_profiles.timezone` + `office_hours` jsonb, new column) the timer runs. After hours it starts at opening.
- **Escalation:** when no `first_contact_at` exists at due time, push and email the next member, then the owner. At 15 min it appears as a red Today card. This uses the outbox and `pushTo`; no new channel.
- Every time is computed in the agency's own time zone. **Remove every `America/New_York` hardcode in lead paths** (`ingest_call`, `book_lead`, site route, brief) and replace it with the profile time zone. JAVA is also licensed in AL, which is Central time.

### 4.6 The 48-hour cadence (`lead_cadence`)
| Step | When | What | Lane |
|---|---|---|---|
| 1 | 0–5 min | First-touch email: "Got your request, here's when we'll call" | `standing` (template approved once) or `tap` |
| 2 | 0–5 min | Call task, Today "Call now" | `auto` (task only) |
| 3 | +2 h | Second call task if not contacted | `auto` |
| 4 | +24 h | Email from Helix's draft | `tap` |
| 5 | +26 h, +47 h | Call tasks | `auto` |

The cadence stops on contact, booking, lost or revoke. Texting steps exist in the table with `requires='a2p'` and stay off.

### 4.7 Outcomes and renewal dates
- `leads.status` adds `quoted` and `bound` between `contacted` and `won`. `won` stays as an alias for `bound`, for old rows.
- New columns:
  - `quoted_at`
  - `bound_at`
  - `premium_cents`
  - `lines_bound text[]`
  - `lost_reason` (check: price, coverage, carrier_declined, no_response, went_elsewhere, not_eligible, other)
  - `x_date date` (renewal date stated by the prospect)
- The Mark lost card asks for a reason and a renewal date ("When does their current policy renew?").
- **Renewal-date nurture:** `follow_ups` at x_date −45, −30 and −15 days. Each is a call task plus a Helix-drafted email (`tap`).
- **Round-out:** a household (contact) with bound lines ⊂ agency lines gets one Command Brief card per missing line, at most one a month.

### 4.8 Scoreboard
- `/app/[slug]/performance` gains these, by source:
  - median time to first touch
  - contact rate
  - quote rate
  - bound rate
  - premium
  - cost per bound policy, when `source_costs` exists
  - lines per household
- Values with no data show "not enough data yet", never 0. That follows `visibility_pulls`.
- The enterprise console shows the same figures across agencies, with no names below 5 agencies.

### 4.9 P1 verification (`scripts/verify-lead-engine.mjs`, preview DB)
- A form lead writes one consent row with the exact text and version, and an update to that row is rejected.
- A double submit makes one lead plus a "repeat" event.
- An out-of-line topic gets score 0 and is flagged.
- The 5-min timer escalates to the next member when not contacted, using the event time as a fake clock. After hours it waits for opening in the agency's time zone, including a Central-time agency.
- The cadence stops on contact. No SMS row is ever queued.
- Mark lost with a renewal date makes 3 nurture follow-ups.
- Scoreboard numbers match seeded rows.
- **Regression:** verify-command-brief, verify-public-booking, verify-consult, verify-turnkey, verify-welcome-kickoff.

### 4.10 As built (2026-11-09)
| Slice | Migration / files | Verify |
|---|---|---|
| 1. Consent ledger, contacts, asking again | 0094, `lib/lead-consent.ts` | `verify-lead-engine.mjs` |
| 2. Checks and score | 0095, `lib/lead-checks.ts`, `lib/lead-score.ts`, `lib/area-codes.ts`, `/api/cron/leads` | `verify-lead-score.mjs` |
| 3. Owner, 5-minute timer, time zones | 0096 | `verify-lead-timer.mjs` |
| 4. Cadence and outcomes | 0097 | `verify-lead-cadence.mjs` |
| 5. Scoreboard | `lib/lead-scoreboard.ts`, Performance | `verify-lead-scoreboard.mjs` |

**Where it differs from §4.1–4.9:**
- **Normalizing** happens in SQL (`norm_phone`, `norm_email`), not libphonenumber, so call leads (`ingest_call`, pure SQL) match too. All tenants are US.
- **Consent rows** are append-only except a revocation and the TrustedForm certificate, each added once. A row is deleted only with its lead. A stop covers every channel and every earlier lead until the person gives consent again (asks again). The site form and the lead API record `call` and `email` (the API can narrow it, never add AI calls or texts). Existing leads were backfilled the same way; calls record no marketing consent.
- **Any other insert** (seeds, tests) still gets its contact (before insert) and its consent row (at commit).
- **Status:** `quoted` is added; `won` stays the stored value and is shown as **Bound**, because the review ask, Helix and reports read `won`.
- **Twilio Lookup** is off unless `LEAD_LOOKUP_ON=1` (at most 20 a run). Without it a well-formed phone scores +10, not +20.
- **Area:** the area code's state (GA, AL, FL in `lib/area-codes.ts`). Radius needs an address, which forms don't collect yet. An unknown area code never counts against a lead.
- **Routing:** round robin among owners. `lead_rules` and the route rule wait for the first standing rule (P2 review asks). With no rules, every outward step is a tap.
- **Cadence** steps become priority tasks on Today, including the email steps (a person sends, with Helix's draft). There are no texting rows at all, rather than disabled ones.
- **Round-out cards**, the enterprise scoreboard and the PII trim of `outbox.data` move to P2.
- **The agency calendar** (open times, the site's booking) is still Eastern. Every current client is Eastern; it moves with the calendar.

## 5. P2: owned demand (2 weeks)

### 5.1 Review velocity
- `request_review` moves into the approval lane as a standing rule: "ask every bound customer 2 days after bind".
- Target: 20+ reviews, with a new one every 2 weeks.
- Visibility shows review count, rating and days since the last review, from Metricool GBP metrics once the listing is connected. No incentives and no filtering by sentiment, under the FTC rule.

### 5.2 Partner program
- Signed partner links from P0.2.
- A QR card PDF per partner (reuse the review card generator).
- A partner landing page `/s/[slug]/p/[ref]` that is noindex and canonical to the home page.
- `partner_events` adds `lead_bound`.
- Rewards are `tap`, flat, never tied to a sale, and capped per state from `lib/partner-rules.ts`: GA $100/customer/year (§33-9-36) and AL $100 non-cash (Reg. 482-1-088). **Turned off until counsel confirms.**

### 5.3 Market playbook (`lib/market-playbook.ts`, `/app/[slug]/market`)
**Inputs:** profile and lines.

**Data:**

| Data | Source |
|---|---|
| Households | ACS 5-year B25003 |
| Vehicles | ACS 5-year B25044 |
| Movers | ACS 5-year B07003 |
| Language | ACS 5-year C16001 |
| Armed Forces | ACS 5-year B23025 |
| Permits | FRED `BPPRIV{fips}` |
| Boats | USCG Table 38 ÷ state households |
| RVs | RVIA rate |
| Motorcycles | State registrations |
| Competitors | The existing Places radar |

ACS comes from the Census API with `CENSUS_API_KEY`, which is free.

**Cache and refresh:**
- Stored in `market_snapshots` (tenant_id, fips[], data jsonb, sources jsonb, built_at).
- Refreshed yearly, plus on profile change.
- Places-derived fields keep place_id only, per Google's terms.

**Outputs:**
- demand per line, each with its formula and source
- a seasonality calendar from `lib/lines.ts` moments
- the top partner categories with counts
- the review gap
- a military module when an installation is within the radius. It includes the solicitation-rule note and the alias list (Fort Benning / Fort Moore).

**Language:** the playbook lists language opportunity as data only. It never adds a language the agency has turned off. Mendez dropped Spanish.

**Helix** reads the playbook to suggest the month's moves as Command Brief cards.

### 5.4 Line and city pages (gated)
- City × line pages are made only where all of these hold:
  - the line is in the agency's lines
  - the city is inside the radius
  - the page has a real local proof item: a review that mentions the city or line, a real photo, or a partner
- InsuranceAgency + FAQ schema.
- Built from `lib/lines.ts`.
- `approved:false` (noindex) until the carrier approves in writing, as with the JAVA line pages.
- At most 3 city pages per line. That respects Google's doorway and scaled-content rules.

## 6. P3: paid pilot (after GEICO's written rules)

### 6.1 Meta Lead Ads
- Complete `app/api/meta/webhooks`: on a `leadgen` event, fetch the lead (`leads_retrieval`, Graph v26) and ingest it with `channel='meta'`.
- The consent comes from the form's custom disclaimer, which names the agency, and is stored in the ledger with the form id as the version.
- The `special_ad_categories=['FINANCIAL_PRODUCTS_SERVICES']` setting is hard-coded on every campaign create:
  - geo: city plus a radius of at least 15 mi
  - no ZIP codes, exclusions or lookalikes
- Conversions API for CRM sends `Lead → Qualified → Quoted → Bound`, keyed by `lead_id`. This is `auto` because it sends data back, not to a consumer.
- Tables `ad_accounts`, `ad_campaigns` and `ad_spend_daily`, each with `tenant_id` and RLS. The house `campaigns` table stays house-only.

### 6.2 Google Ads
- Basic developer token (15,000 operations a day).
- Search campaigns per line and city.
- Lead form assets.
- Enhanced conversions for leads (hashed email, gclid).
- Offline conversion upload on bound.
- No LSA: insurance agencies are eligible only in CA and FL. Re-check every quarter in `/api/cron/daily`.

### 6.3 Pacing and guardrails
`/api/cron/ads` runs every hour. It pulls platform-reported spend and:
- pauses at 100% of the monthly cap
- warns at 80%
- auto-pauses when cost per lead goes above 2× the 14-day baseline, the spam rate goes above 25%, or a policy disapproval arrives
- alerts the team

Budget shifts happen only inside an approved standing rule. The cap is set and raised only through a `tap` (`subject_kind='ad'`).

**Pilot:** one agency, a $300 cap. It measures cost per qualified lead and cost per bound policy before any price is final.

## 7. P4: lead product and AI receptionist

### 7.1 Per-lead billing
- `lead_offers`: tenant, lines, radius, monthly cap, `price_cents`, status, approved through `tap`.
- `lead_charges`: one per delivered qualified lead. They roll into the monthly invoice as a new kind, `leads`.
- `lead_credits`, with these reasons:
  - bad contact
  - out of area or line
  - duplicate
  - never asked
  - under 18
  - can't reach after the cadence (proposed 7-day window for that reason only, 72 h for the rest)
- Credits auto-decide within 24 h from the checks above. A person reviews the edge cases.
- **What counts as qualified (Anthony's decision 5):** it needs consent, verification, in-line, in-area and not a duplicate. Whether it also needs a confirmed conversation is his call.

### 7.2 AI receptionist (inbound only)
- Retell or Bland, chosen on a 1-week trial, about $0.10–0.31/min, behind `/api/voice/incoming` as a fallback when the office doesn't pick up in N rings.
- Its opening line:
  - "This call may be recorded."
  - "You're speaking with [Agency]'s AI assistant."
  - Florida requires all parties' consent to record, and Valdosta draws Florida callers.
- The script is approved once (`standing`). It answers questions, takes the request, books a time and never quotes or gives coverage advice (CLAUDE.md).
- The transcript goes to the lead. A human callback task is created. **No outbound AI calls** without written consent that includes `autodial_ai`, and each one is still a `tap`.

## 8. Data model summary (new; all `tenant_id`, RLS read for `is_staff() or is_member(tenant_id)`, writes through security-definer RPCs, `log_event` on each)

| Table | Phase |
|---|---|
| `lead_consents`, `consent_texts` | P1 |
| `contacts`, `lead_events`, `lead_checks`, `lead_timers`, `lead_cadence`, `lead_rules` | P1 |
| `lead_rate` (service role only) | P0 |
| `market_snapshots` | P2 |
| `ad_accounts`, `ad_campaigns`, `ad_spend_daily` | P3 |
| `lead_offers`, `lead_charges`, `lead_credits` | P4 |

**Column changes:**
- `leads` gains `contact_id`, `owner_id`, `score`, `score_reasons`, `quoted_at`, `bound_at`, `premium_cents`, `lines_bound`, `lost_reason` and `x_date`. Status adds `quoted` and `bound`, and `partner_id` gets an FK.
- `agency_profiles` gains `office_hours`.
- `approvals.subject_kind` adds `rule`.

**PII:** `outbox.data` for lead alerts keeps the name and lead id only. Phone and email are looked up at send time. Rows are purged after 30 days.

## 9. Env and costs

| Item | Env | Cost |
|---|---|---|
| Turnstile | `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | free |
| Partner link signing | `PARTNER_LINK_SECRET` (falls back to `CRON_SECRET`) | — |
| Twilio Lookup | existing `TWILIO_*` | $0.008 a lookup |
| TrustedForm | `TRUSTEDFORM_API_KEY` | about $0.15 a retained cert, $10/mo minimum |
| Census | `CENSUS_API_KEY` | free |
| Meta | existing app + `leads_retrieval`, `ads_management` review | free API |
| Google Ads | `GOOGLE_ADS_DEVELOPER_TOKEN` (Basic) | free API |
| AI receptionist | `VOICE_AGENT_*` | about $0.10–0.31/min |
| Kill switch | `LEAD_ENGINE_OFF` | — |

**Running cost at 100 leads a month per agency (P1):** about $0.81 for Twilio checks plus about $15 for TrustedForm certificates at the $10 minimum. That is roughly $16/agency/mo before ads.

## 10. Order and gates

1. **P0:** shipped 2026-11-03. Turnstile waits for its keys.
2. **P1:** after decisions 3 (approve P1/P2), 4 (standing rules) and 6 (credit window).
3. **P2:** alongside P1. Partner rewards stay off until counsel confirms the state caps (decision 7).
4. **P3:** only after GEICO's written lead and marketing rules (decision 1). One agency, $300 cap.
5. **P4:** after the pilot sets the real cost per qualified lead. The price follows (decision 5).

Each phase ships with its verify script on preview, screenshots at desktop and phone width, and a What's new entry.
