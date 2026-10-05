# Genesis Secure Solutions platform site

Next.js 16 on Vercel. Everything is noindexed while the platform is an internal preview.

| Route | What |
|---|---|
| `/` and `/film` | The Business in a Box commercial (live animated film + narration, MP4 fallback) |
| `/welcome/<token>` | A client's private welcome package: welcome film + five-step setup guide |
| `/api/progress/<token>` | GET/POST the client's setup progress (Vercel Blob, private) |
| `/welcome/<token>/social` | The client's social setup wizard: one step at a time, copy and assets to paste and download, and a live preview of their Facebook Page, Instagram and Google listing filling in |
| `/console/social/<slug>` | The same wizard for the Genesis operator on the setup call: talk track, our-side tasks, where the client is, lead mode, private call notes. Password protected |
| `/api/social/<token>`, `/api/console/social/<slug>` | One small change per POST (tick a step, answer, field, link, approval, lead, presence); GET returns the shared session |

## Add the next client
1. Copy `data/clients/mendez-hollis.json`, change the fields, and generate a new token:
   `node -e "console.log(require('crypto').randomBytes(16).toString('base64url'))"`
2. Set `social.plan` to the channels in their plan (ids from `lib/channels.ts`); every other channel shows as optional.
3. Put their film and poster in `public/w/<token>/` (use web encodes, about 12 MB).
4. Register the record in `lib/clients.ts`, commit, deploy.

Tokens and prices live only in server code. Never import `lib/clients.ts` from client code.
Anyone holding a client's link can view the guide and tick steps.

## Edit the pages
Edit `data/templates/welcome.html`, `social.html` or the shared `base.css`; `npm run build` bakes them into `lib/templates.ts`.

## Social channels
The wizard keeps three kinds of private Blob files per client: the shared session (version-checked writes, so two people editing at once never overwrite each other), one presence file per person, and operator notes that only the console API reads. Both screens poll every 2 seconds while the other person is active.

Profile copy and images for each client live in `data/kits/<slug>.json` and `public/w/<folder>/social/`. The client's approver signs off on the copy in the wizard's review step before the Page is created.

`lib/channels.ts` is the channel registry. Add a channel there with its access method; add steps only after checking the platform's own help pages. Optional channels with no steps show as "we walk you through it on a call".
Set `GSS_CONSOLE_PASSWORD` (the console password; the local copy is in the git-ignored `.console.local`), `GSS_META_BUSINESS_ID` and `GSS_GOOGLE_INVITE_EMAIL` in Vercel to show them in the guide (see `.env.example`).

## See a client's progress
`node --env-file=.env.local scripts/client-status.mjs mendez-hollis` prints their welcome checklist and social guide answers, including requested channels. Read-only.
